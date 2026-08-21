/** Assembled TUI snapshots over the shipped profile, Loader, replay provider, and POSIX PTY. */

import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeSessionLog, scrubRequestHeaders } from '@deepseek-ai/dsh-acp-snapshot'
import { resolveExampleMode } from '@deepseek-ai/dsh-loader-smoke'
import {
  normalizeTerminalOutput,
  resolveTuiTerminalLaunch,
  runTuiTerminal,
  type TerminalAction,
} from './fixtures/terminal-driver.ts'

const testsDir = dirname(fileURLToPath(import.meta.url))
const snapshotsDir = join(testsDir, 'snapshots')
const dshSource = fileURLToPath(new URL('../../../apps/cli/src/bin.ts', import.meta.url))
const dshBuilt = fileURLToPath(new URL('../../../apps/cli/lib/bin.js', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const patchPath = fileURLToPath(new URL('../cordis.snapshot.yml', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

interface ScenarioOptions {
  readonly name: string
  readonly args?: readonly string[]
  readonly actions: readonly TerminalAction[]
  readonly env?: NodeJS.ProcessEnv
  readonly override?: string
  readonly assertOutput: (output: string) => void
}

async function promptOf(scenarioDir: string): Promise<string> {
  const input = JSON.parse(await readFile(join(scenarioDir, 'input.json'), 'utf8')) as {
    steps?: Array<{ op?: string; text?: string }>
  }
  const prompt = input.steps?.find(step => step.op === 'prompt')?.text
  if (prompt === undefined) throw new Error(`${scenarioDir} has no prompt step`)
  return prompt
}

async function persistedSession(root: string): Promise<string> {
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.jsonl'))
  if (files.length !== 1 || files[0] === undefined) {
    throw new Error(`expected one TUI session log, found ${String(files.length)}`)
  }
  return readFile(join(root, files[0]), 'utf8')
}

async function compareOrRefresh(path: string, content: string): Promise<void> {
  if (refreshing) {
    await writeFile(path, content)
    return
  }
  if (!existsSync(path)) throw new Error(`missing expected snapshot ${path}`)
  expect(content).toBe(await readFile(path, 'utf8'))
}

async function runScenario(options: ScenarioOptions): Promise<void> {
  const scenarioDir = join(snapshotsDir, options.name)
  const cwd = await mkdtemp(join(tmpdir(), `dsh-${options.name}-`))
  const dshHome = join(cwd, '.dsh')
  try {
    const fixture = join(scenarioDir, 'session.jsonl')
    const additionalPatchPaths: string[] = []
    if (options.name === 'tui-interactions') {
      const interactionPatch = join(cwd, 'interaction.patch.yml')
      const pluginUrl = pathToFileURL(join(testsDir, 'fixtures', 'interaction-fixture.ts')).href
      await writeFile(interactionPatch, `- insert:\n    - id: tui-interaction-fixture\n      name: '${pluginUrl}'\n`)
      additionalPatchPaths.push(interactionPatch)
    }
    const launch = resolveTuiTerminalLaunch({
      mode: resolveExampleMode(), dshSource, dshBuilt, tsconfigPath, patchPath,
      cwd, dshHome, additionalPatchPaths,
      ...(options.args === undefined ? {} : { args: options.args }),
      env: {
        DSH_SNAPSHOT: 'replay',
        DSH_SNAPSHOT_FILE: fixture,
        DSH_PERMISSION_MODE: 'danger-full-access',
        ...(options.override === undefined ? {} : { DSH_SNAPSHOT_OVERRIDE: join(scenarioDir, options.override) }),
        ...options.env,
      },
    })
    const result = await runTuiTerminal({ cwd, launch, actions: options.actions, timeoutMs: 45_000 })
    expect(result.exitCode).toBe(0)
    expect(result.rawModeRestored).toBe(true)
    options.assertOutput(result.output)

    const rawSession = await persistedSession(join(dshHome, 'sessions'))
    const header = JSON.parse(rawSession.split('\n')[0] ?? '{}') as { id?: unknown }
    if (typeof header.id !== 'string') throw new Error('persisted TUI session has no id')
    const normalizedSession = scrubRequestHeaders(normalizeSessionLog(rawSession, {
      sessionIds: [header.id],
      cwd,
    }))
    const normalizedTerminal = normalizeTerminalOutput(result.output).replaceAll(cwd, '{{cwd}}')
    await compareOrRefresh(join(scenarioDir, 'session.expected.jsonl'), normalizedSession)
    await compareOrRefresh(join(scenarioDir, 'terminal.expected.txt'), normalizedTerminal)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === 'win32')('tui assembled snapshots', () => {
  it('tui assembled transcript', async () => {
    const scenarioDir = join(snapshotsDir, 'tui-transcript')
    const prompt = await promptOf(scenarioDir)
    await runScenario({
      name: 'tui-transcript',
      args: [prompt],
      actions: [
        { waitFor: 'Status: working' },
        { waitFor: '$ echo SNAPSHOT_OK' },
        { waitFor: 'Status: ready', text: '/exit' },
        { key: 'return' },
      ],
      assertOutput(output) {
        expect(output).toContain('SNAPSHOT_OK')
        expect(output).toContain('DONE')
        expect(output).toContain('$ echo SNAPSHOT_OK')
      },
    })
  })

  it('tui assembled interactions', async () => {
    await runScenario({
      name: 'tui-interactions',
      env: { DSH_TUI_INTERACTION_FIXTURE: '1', DSH_PERMISSION_MODE: 'workspace-write' },
      actions: [
        { waitFor: 'Choose target', text: 'Code;ship it' },
        { key: 'return' },
        { waitFor: 'Approval required · fixture-tool', text: 'y' },
        { waitForFile: '.tui-interactions-complete', text: '/help' },
        { key: 'return' },
        { waitFor: '/exit — Exit after saving the current session', text: '/exit' },
        { key: 'return' },
      ],
      assertOutput(output) {
        expect(output).toContain('Questions')
        expect(output).toContain('Approval required · fixture-tool')
        expect(output).toContain('/help — Show available commands')
      },
    })
  })

  it('tui assembled lifecycle', async () => {
    const scenarioDir = join(snapshotsDir, 'tui-lifecycle')
    const prompt = await promptOf(scenarioDir)
    await runScenario({
      name: 'tui-lifecycle',
      args: [prompt],
      override: 'replay.override.json',
      actions: [
        { waitForFile: '.dsh-snapshot-stream-ready', key: 'ctrl-c' },
        { waitFor: 'Status: ready', key: 'ctrl-c' },
      ],
      assertOutput(output) {
        expect(output).toContain('Status: working')
        expect(output).toContain('Assistant\r\npartial')
      },
    })
  })
})
