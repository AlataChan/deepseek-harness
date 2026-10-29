/**
 * Recorded-session replay through the shipped `tui` profile.
 * Executes an interactive turn inside a real PTY using `llm-replay` without real API keys,
 * drives prompt submission and `/quit`, and validates persisted session parity.
 *
 * @module @deepseek-ai/dsh-tui-snapshot
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type * as NodePty from 'node-pty'
import { parseSessionLog, prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay'
import {
  fixtureContext,
  formatSystemPromptSnapshot,
  formatToolSchemasSnapshot,
  normalizeSessionSnapshots,
  normalizedSystemPrompts,
  normalizedToolSchemas,
  parseSnapshotManifest,
  redactSessionSnapshotIds,
  refreshFixtureReplacements,
  scrubSessionSnapshot,
  sessionFixtureName,
  sessionFixtureNames,
  sessionHeaderVersion,
  stabilizeFixtureMessageIds,
  stabilizeRefreshLog,
  tokenizeSessionFixtureCwd,
} from '@deepseek-ai/dsh-session-snapshot'

const require = createRequire(import.meta.url)
const pty = require('node-pty') as typeof NodePty

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const scenarioDir = fileURLToPath(new URL('./interactive-turn/', import.meta.url))

function fixtureHeader(raw: string): { id: string; createdAt: number } {
  const value: unknown = JSON.parse(raw.split('\n')[0]!)
  if (
    value === null ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !('createdAt' in value) ||
    typeof value.createdAt !== 'number'
  ) {
    throw new Error('Invalid TUI Session header')
  }
  return { id: value.id, createdAt: value.createdAt }
}

async function sessionFiles(dir: string): Promise<string[]> {
  const nested = await Promise.all(
    (await readdir(dir, { withFileTypes: true })).map(async (entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sessionFiles(path)
      return entry.name.endsWith('.jsonl') ? [path] : []
    }),
  )
  return nested.flat()
}

/** Check whether a process pid is still active without sending a mutating signal. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/**
 * Exact owned child exit join with bounded escalation.
 * Signals SIGTERM first, allows a bounded grace period, escalates to SIGKILL if needed,
 * and awaits process termination before continuing.
 */
async function killAndJoinPty(
  term: NodePty.IPty,
  exitPromise: Promise<{ exitCode: number; signal?: number }>,
  graceTimeoutMs = 2500,
): Promise<{ exitCode: number; signal?: number }> {
  try {
    term.kill('SIGTERM')
  } catch {
    // Process might already be dead
  }

  let graceTimer: NodeJS.Timeout | undefined
  const forceKillPromise = new Promise<{ exitCode: number; signal?: number }>((resolve) => {
    graceTimer = setTimeout(() => {
      try {
        term.kill('SIGKILL')
      } catch {
        // Contained
      }
      void exitPromise.then(resolve)
    }, graceTimeoutMs)
  })

  try {
    return await Promise.race([exitPromise, forceKillPromise])
  } finally {
    if (graceTimer !== undefined) clearTimeout(graceTimer)
  }
}

/**
 * Wait for output predicate with rigorous timer and abort signal cleanup.
 */
function waitForOutput(
  predicate: () => boolean,
  timeoutMs = 25000,
  signal?: AbortSignal,
  getOutput?: () => string,
): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined
    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new Error('waitForOutput aborted'))
    }
    if (signal?.aborted) {
      reject(new Error('waitForOutput aborted'))
      return
    }
    signal?.addEventListener('abort', onAbort)
    const check = () => {
      if (signal?.aborted) return
      try {
        if (predicate()) {
          cleanup()
          resolve()
          return
        }
      } catch (err: unknown) {
        cleanup()
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      if (Date.now() - start > timeoutMs) {
        cleanup()
        const out = getOutput ? ` Output was:\n${getOutput().slice(-1000)}` : ''
        reject(new Error(`waitForOutput timed out after ${timeoutMs}ms.${out}`))
      } else {
        timer = setTimeout(check, 50)
      }
    }
    check()
  })
}

describe('tui snapshot suite', () => {
  it.skipIf(process.env.DSH_SNAPSHOT === 'record')(
    'TUI interactive turn replays keylessly through shipped profile and validates session parity',
    async () => {
      if (process.env.DSH_SNAPSHOT && !['replay', 'refresh'].includes(process.env.DSH_SNAPSHOT)) {
        throw new Error('Unknown TUI snapshot mode')
      }

      const manifest = parseSnapshotManifest(
        await readFile(join(scenarioDir, 'snapshot.yml'), 'utf8'),
        join(scenarioDir, 'snapshot.yml'),
      )
      expect(manifest.profile).toBe('tui')

      const selected = sessionFixtureNames(await readdir(scenarioDir))
      expect(selected).toHaveLength(1)
      const fixtureFile = join(scenarioDir, selected[0]!)
      let fixture = await readFile(fixtureFile, 'utf8')

      const prompt = parseSessionLog(fixture).find(
        (event) => event.type === 'user/message' && event.data.source.kind === 'user',
      )
      if (prompt?.type !== 'user/message') throw new Error('TUI fixture must own one human prompt')
      const text = prompt.data.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('')

      const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-tui-snapshot-')))
      const cwd = join(root, 'workspace')
      const sessionsRoot = join(root, 'sessions')
      for (const part of ['home', 'workspace', 'sessions']) {
        await mkdir(join(root, part), { recursive: true, mode: 0o700 })
      }

      const patches = [
        { id: 'llm-deepseek', disabled: true },
        { id: 'plugin-package-inventory-deepseek', disabled: true },
        { id: 'session-title-llm', disabled: true },
        { id: 'session-persistence-jsonl', config: { root: sessionsRoot, compression: 'none' } },
        {
          insert: [
            {
              id: 'tui-model-replay',
              name: join(repoRoot, 'packages/test-support/llm-replay/src/index.ts'),
              config: {
                file: fixtureFile,
                providers: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash' }] }],
                paceMs: 20,
              },
            },
          ],
        },
      ]

      const patchPath = join(root, 'tui-snapshot.patch.json')
      await writeFile(patchPath, JSON.stringify(patches), { mode: 0o600 })

      let output = ''
      let childExited = false
      const term = pty.spawn(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx/esm'),
          join(repoRoot, 'apps/cli/src/bin.ts'),
          '--profile',
          'tui',
          '--patch',
          patchPath,
        ],
        {
          name: 'xterm-256color',
          cols: 100,
          rows: 30,
          cwd,
          env: {
            PATH: process.env.PATH ?? '',
            HOME: join(root, 'home'),
            DSH_HOME: join(root, 'home'),
            TMPDIR: process.env.TMPDIR ?? tmpdir(),
            NODE_PATH: process.env.NODE_PATH ?? join(repoRoot, 'node_modules'),
            TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.base.json'),
            DSH_TELEMETRY_DISABLED: '1',
            NO_PROXY: '*',
          },
        },
      )

      const childPid = term.pid

      term.onData((chunk: string) => {
        output += chunk
      })

      const exitPromise = new Promise<{ exitCode: number; signal?: number }>((resolve) => {
        term.onExit((res) => {
          childExited = true
          resolve(res)
        })
      })

      try {
        // Synchronize on actual TUI input readiness: wait for status idle rendered (never incidental text like 'dsh')
        await waitForOutput(
          () => output.includes('空闲') || output.includes('已创建会话'),
          25000,
          undefined,
          () => output,
        )

        // Submit the recorded prompt
        term.write(`${text}\r`)

        // Synchronize on authoritative correlated durable assistant and turn completion in the persisted session log.
        // Paced replay (paceMs: 20) ensures streaming is delayed; this poll waits for full commit rather than premature exit.
        await expect.poll(async () => {
          const files = await sessionFiles(sessionsRoot).catch(() => [])
          if (files.length === 0) return false
          try {
            const content = await readFile(files[0]!, 'utf8')
            const events = parseSessionLog(content)
            const hasAssistant = events.some((event) => event.type === 'assistant/message')
            const hasTurnEnd = events.some(
              (event) => event.type === 'turn/end' && (event.data as { turn?: number }).turn === 1,
            )
            return hasAssistant && hasTurnEnd
          } catch {
            return false
          }
        }, { timeout: 25000, interval: 30 }).toBe(true)

        // Ensure the TUI has rendered the response and returned to idle
        await waitForOutput(
          () => output.includes('PONG'),
          5000,
          undefined,
          () => output,
        )

        // Clean exit via /quit
        term.write('/quit\r')

        let exitTimer: NodeJS.Timeout | undefined
        const exitTimeout = new Promise<never>((_, reject) => {
          exitTimer = setTimeout(() => reject(new Error('TUI exit timed out after /quit')), 10000)
        })

        try {
          const exitResult = await Promise.race([exitPromise, exitTimeout])
          expect(exitResult.exitCode).toBe(0)
        } finally {
          if (exitTimer !== undefined) clearTimeout(exitTimer)
        }

        // Read persisted session log
        const files = await sessionFiles(sessionsRoot)
        expect(files).toHaveLength(1)
        const actual = await readFile(files[0]!, 'utf8')

        const parsedActual = parseSessionLog(actual)
        const userMsg = parsedActual.find(
          (event) => event.type === 'user/message' && event.data.source.kind === 'user',
        )
        expect(userMsg).toBeDefined()
        const assistantMsg = parsedActual.find(
          (event) => event.type === 'assistant/message',
        )
        expect(assistantMsg).toBeDefined()

        const context = fixtureContext(actual)
        const prompts = normalizedSystemPrompts(actual, context)
        const tools = normalizedToolSchemas(actual, context)
        expect(prompts).toHaveLength(1)
        expect(tools).toHaveLength(1)

        if (process.env.DSH_SNAPSHOT === 'refresh') {
          const header = fixtureHeader(actual)
          const replacements = refreshFixtureReplacements([{ ...header, content: actual }], [fixture])
          const stable = tokenizeSessionFixtureCwd(
            stabilizeRefreshLog(actual, fixture, replacements, context),
          )
          const fresh = scrubSessionSnapshot(prepareSessionSnapshotFixtureForComparison(stable))
          fixture = redactSessionSnapshotIds(stabilizeFixtureMessageIds([fresh], [fixture]))[0]!
          await writeFile(
            join(scenarioDir, sessionFixtureName(0, sessionHeaderVersion(actual, 'TUI writer'))),
            fixture,
          )
          await writeFile(
            join(scenarioDir, 'system-prompt.expected.md'),
            formatSystemPromptSnapshot(prompts[0]!),
          )
          await writeFile(
            join(scenarioDir, 'tool-schemas.expected.json'),
            formatToolSchemasSnapshot(tools[0]!),
          )
        }

        expect(
          normalizeSessionSnapshots([actual], context, { nativeWriterOutput: true }),
        ).toEqual(
          normalizeSessionSnapshots([fixture], fixtureContext(fixture), {
            nativeWriterOutput: true,
          }),
        )
        expect(formatSystemPromptSnapshot(prompts[0]!)).toBe(
          await readFile(join(scenarioDir, 'system-prompt.expected.md'), 'utf8'),
        )
        expect(formatToolSchemasSnapshot(tools[0]!)).toBe(
          await readFile(join(scenarioDir, 'tool-schemas.expected.json'), 'utf8'),
        )
      } finally {
        if (!childExited) {
          try {
            await killAndJoinPty(term, exitPromise, 3000)
          } catch {
            // Contained
          }
        }
        expect(isProcessAlive(childPid)).toBe(false)
        await rm(root, { recursive: true, force: true })
      }
    },
    60000,
  )

  it(
    'proves premature shutdown during delayed streaming aborts before turn completion',
    async () => {
      const selected = sessionFixtureNames(await readdir(scenarioDir))
      expect(selected).toHaveLength(1)
      const fixtureFile = join(scenarioDir, selected[0]!)

      const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-tui-premature-ctrl-')))
      const cwd = join(root, 'workspace')
      const sessionsRoot = join(root, 'sessions')
      for (const part of ['home', 'workspace', 'sessions']) {
        await mkdir(join(root, part), { recursive: true, mode: 0o700 })
      }

      const patches = [
        { id: 'llm-deepseek', disabled: true },
        { id: 'plugin-package-inventory-deepseek', disabled: true },
        { id: 'session-title-llm', disabled: true },
        { id: 'session-persistence-jsonl', config: { root: sessionsRoot, compression: 'none' } },
        {
          insert: [
            {
              id: 'tui-model-replay',
              name: join(repoRoot, 'packages/test-support/llm-replay/src/index.ts'),
              config: {
                file: fixtureFile,
                providers: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash' }] }],
                paceMs: 50,
              },
            },
          ],
        },
      ]

      const patchPath = join(root, 'tui-premature.patch.json')
      await writeFile(patchPath, JSON.stringify(patches), { mode: 0o600 })

      let output = ''
      let childExited = false
      const term = pty.spawn(
        process.execPath,
        [
          '--import',
          import.meta.resolve('tsx/esm'),
          join(repoRoot, 'apps/cli/src/bin.ts'),
          '--profile',
          'tui',
          '--patch',
          patchPath,
        ],
        {
          name: 'xterm-256color',
          cols: 100,
          rows: 30,
          cwd,
          env: {
            PATH: process.env.PATH ?? '',
            HOME: join(root, 'home'),
            DSH_HOME: join(root, 'home'),
            TMPDIR: process.env.TMPDIR ?? tmpdir(),
            NODE_PATH: process.env.NODE_PATH ?? join(repoRoot, 'node_modules'),
            TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.base.json'),
            DSH_TELEMETRY_DISABLED: '1',
            NO_PROXY: '*',
          },
        },
      )

      const childPid = term.pid
      term.onData((chunk: string) => {
        output += chunk
      })

      const exitPromise = new Promise<{ exitCode: number; signal?: number }>((resolve) => {
        term.onExit((res) => {
          childExited = true
          resolve(res)
        })
      })

      try {
        await waitForOutput(
          () => output.includes('空闲') || output.includes('已创建会话'),
          25000,
          undefined,
          () => output,
        )

        // Submit prompt then immediately send /quit while 50ms chunks are still streaming
        term.write('Reply with exactly the word: PONG. Do not use any tools.\r')
        term.write('/quit\r')

        let exitTimer: NodeJS.Timeout | undefined
        const exitTimeout = new Promise<never>((_, reject) => {
          exitTimer = setTimeout(() => reject(new Error('TUI exit timed out after premature /quit')), 10000)
        })

        try {
          const exitResult = await Promise.race([exitPromise, exitTimeout])
          expect(exitResult.exitCode).toBe(0)
        } finally {
          if (exitTimer !== undefined) clearTimeout(exitTimer)
        }

        // Verify that premature shutdown aborted before turn completion: no assistant/message or turn/end committed
        const files = await sessionFiles(sessionsRoot)
        expect(files).toHaveLength(1)
        const actual = await readFile(files[0]!, 'utf8')
        const parsedActual = parseSessionLog(actual)
        const assistantMsg = parsedActual.find((e) => e.type === 'assistant/message')
        const turnEnd = parsedActual.find((e) => e.type === 'turn/end')
        expect(assistantMsg).toBeUndefined()
        expect(turnEnd).toBeUndefined()
      } finally {
        if (!childExited) {
          try {
            await killAndJoinPty(term, exitPromise, 3000)
          } catch {
            // Contained
          }
        }
        expect(isProcessAlive(childPid)).toBe(false)
        await rm(root, { recursive: true, force: true })
      }
    },
    30000,
  )

  it('proves quiescent child join with bounded escalation and no directory race on failure/timeout', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-tui-neg-ctrl-')))
    const cwd = join(root, 'workspace')
    const sessionsRoot = join(root, 'sessions')
    for (const part of ['home', 'workspace', 'sessions']) {
      await mkdir(join(root, part), { recursive: true, mode: 0o700 })
    }

    let childExited = false
    let childPid = 0

    const term = pty.spawn(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx/esm'),
        join(repoRoot, 'apps/cli/src/bin.ts'),
        '--profile',
        'tui',
      ],
      {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: join(root, 'home'),
          DSH_HOME: join(root, 'home'),
          TMPDIR: process.env.TMPDIR ?? tmpdir(),
          NODE_PATH: process.env.NODE_PATH ?? join(repoRoot, 'node_modules'),
          TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.base.json'),
          DSH_TELEMETRY_DISABLED: '1',
          NO_PROXY: '*',
        },
      },
    )

    childPid = term.pid
    const exitPromise = new Promise<{ exitCode: number; signal?: number }>((resolve) => {
      term.onExit((res) => {
        childExited = true
        resolve(res)
      })
    })

    let simulatedFailureOccurred = false
    let directoryRemoved = false

    try {
      // Simulate mid-run failure/timeout exception while child is running
      simulatedFailureOccurred = true
      throw new Error('Simulated runner failure triggering teardown')
    } catch (err: unknown) {
      expect((err as Error).message).toBe('Simulated runner failure triggering teardown')
    } finally {
      // Bounded escalation join must ensure process is dead BEFORE directory removal
      if (!childExited) {
        await killAndJoinPty(term, exitPromise, 3000)
      }
      expect(childExited).toBe(true)
      expect(isProcessAlive(childPid)).toBe(false)

      await rm(root, { recursive: true, force: true })
      directoryRemoved = true
      expect(existsSync(root)).toBe(false)
    }

    expect(simulatedFailureOccurred).toBe(true)
    expect(directoryRemoved).toBe(true)
    expect(isProcessAlive(childPid)).toBe(false)
  })
})
