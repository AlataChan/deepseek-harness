/**
 * A linked out-of-tree bundle joins one profile: `dsh plugin add link:` adds
 * the package as a profile layer, its patch rows compose, and a boot of that
 * profile sees the preset it installs — while the package stays absent from
 * the harness installation closure.
 */

import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'
import {
  composeEntries, readProfileManifest, resolveBundleDir, writeProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { runPlugin } from '../src/plugin.ts'
import { prepareProfile, INSTALL_ANCHOR } from '../src/profile-boot.ts'

const PACKAGE = '@deepseek-ai/dsh-experimental-commerce-mode'
const PROFILE = 'commerce-link'
const SPAWN_TIMEOUT_MS = 180_000
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const commerceModeDir = join(repositoryRoot, 'packages', 'experimental', 'commerce-mode')
const dshSrcBin = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const tsconfigPath = join(repositoryRoot, 'tsconfig.json')

const homes: string[] = []
const previousHome = process.env.DSH_HOME

afterEach(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

/** Report the composed roster and one preset's tools, then end the run. */
const PROBE_PLUGIN = [
  "export const name = 'commerce-probe'",
  'export function apply(ctx) {',
  '  // A profile with no app row settles and exits; the interval holds the',
  '  // loop open until the report lands.',
  '  const keepAlive = setInterval(() => {}, 1_000)',
  "  ctx.inject(['agentPresets', 'agents', 'tools', 'commerce'], (scope) => {",
  '    void (async () => {',
  '      const fs = await import("node:fs/promises")',
  '      const report = { presets: [], tools: [], services: {}, entries: [] }',
  '      for (const key of [\'commerce\', \'fs\', \'approval\', \'sandboxPolicy\', \'tools\', \'agentPresets\']) {',
  '        report.services[key] = ctx.get(key) !== undefined',
  '      }',
  '      for (const entry of ctx.loader.entries()) {',
  '        report.entries.push({ name: String(entry.options.name ?? entry.options.id), state: entry.fiber?.state ?? null })',
  '      }',
  '      try {',
  '        // The preset row installs the packaged preset during its own',
  '        // activation, so wait for the roster to carry it.',
  '        // The preset row installs the preset and only then mounts the',
  '        // scoped tools, so wait for that row to finish activating.',
  '        const deadline = Date.now() + 60_000',
  '        for (;;) {',
  '          report.presets = (await scope.agentPresets.list()).map(preset => preset.id)',
  '          const row = [...ctx.loader.entries()].find(entry =>',
  "            String(entry.options.name) === '@deepseek-ai/dsh-experimental-commerce-mode/preset')",
  '          report.presetRowState = row?.fiber?.state ?? null',
  '          // 2 is FiberState.ACTIVE; a plain .mjs fixture cannot import the enum.',
  "          const ready = report.presets.includes('commerce') && row?.fiber?.state === 2",
  '          if (ready || Date.now() > deadline) break',
  '          await new Promise(resolve => setTimeout(resolve, 50))',
  '        }',
  '        const created = await scope.agents.create({',
  "          sessionId: 'commerce-probe-session',",
  "          meta: { cwd: process.cwd(), agentPreset: 'commerce' },",
  "          agentOptions: { provider: 'probe', model: 'probe' },",
  "          setup: agentCtx => scope.agentPresets.mount(agentCtx, 'commerce').then(() => undefined),",
  '        })',
  '        report.tools = scope.tools.schemas(created.agent).map(tool => tool.name)',
  '        await created.dispose()',
  '      } catch (error) {',
  '        report.failure = error instanceof Error ? error.message : String(error)',
  '      }',
  '      await fs.writeFile(process.env.DSH_COMMERCE_PROBE_OUT, JSON.stringify(report))',
  '      clearInterval(keepAlive)',
  "      if (process.platform === 'win32') process.emit('SIGTERM')",
  "      else process.kill(process.pid, 'SIGTERM')",
  '    })()',
  '  })',
  '}',
  '',
].join('\n')

async function linkedProfile(): Promise<{ home: string; profileDir: string }> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-commerce-link-'))
  homes.push(home)
  process.env.DSH_HOME = home
  const code = runPlugin(PROFILE, ['add', `link:${commerceModeDir}`])
  expect(code).toBe(0)
  const profileDir = join(home, 'profiles', PROFILE)
  // One deterministic mount: a custom profile defaults to live patch reload,
  // which re-applies the tree when the watcher starts.
  const manifest = readProfileManifest('test', profileDir)
  writeProfileManifest(profileDir, {
    ...manifest,
    dsh: { ...manifest.dsh, profile: { ...manifest.dsh?.profile, patchReload: 'startup' } },
  })
  return { home, profileDir }
}

describe('linked commerce profile bundle', () => {
  it('stays out of the shipped installation closure', () => {
    const manifest = JSON.parse(readFileSync(INSTALL_ANCHOR, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.[PACKAGE]).toBeUndefined()
    expect(manifest.devDependencies?.[PACKAGE]).toBeUndefined()
    // No shipped bundle carries it either: a deployment reaches the package
    // only by adding it to one profile. (The repository root keeps a
    // devDependency so snapshot patches resolve the bare name from source.)
    const bundles = globSync('packages/bundle/*/package.json', { cwd: repositoryRoot })
      .map(file => JSON.parse(readFileSync(join(repositoryRoot, file), 'utf8')) as {
        dependencies?: Record<string, string>
      })
    expect(bundles.filter(bundle => bundle.dependencies?.[PACKAGE] !== undefined)).toEqual([])
  })

  it('joins the profile layer stack and composes its patch rows', { timeout: SPAWN_TIMEOUT_MS }, async () => {
    const { profileDir } = await linkedProfile()
    const manifest = readProfileManifest('test', profileDir)
    expect(manifest.dependencies?.[PACKAGE]).toBeDefined()
    expect(manifest.dsh?.profile?.bundles).toContain(PACKAGE)

    const profile = prepareProfile(PROFILE)
    const layer = profile.layers.find(entry => entry.packageName === PACKAGE)
    expect(layer, 'the linked package must be a profile layer').toBeDefined()
    // Bundle resolution finds it through the profile, never through the app.
    expect(resolveBundleDir('test', PACKAGE, INSTALL_ANCHOR, profileDir)).toBe(layer?.packageDir)
    const rows = composeEntries([profile.layers.flatMap(entry => entry.patches), profile.patches])
    const commerceRows = rows.filter(row => typeof row.name === 'string' && row.name.startsWith(PACKAGE))
    expect(commerceRows.map(row => row.name)).toEqual([PACKAGE, `${PACKAGE}/preset`])
  })

  it('boots the profile with the commerce preset and its tools', { timeout: SPAWN_TIMEOUT_MS }, async () => {
    const { home, profileDir } = await linkedProfile()
    const probeFile = join(profileDir, 'commerce-probe.mjs')
    const report = join(home, 'probe.json')
    await writeFile(probeFile, PROBE_PLUGIN)
    await writeFile(join(profileDir, 'cordis.patch.yml'), [
      '- id: llm-deepseek',
      '  disabled: true',
      '- insert:',
      '    - id: agent-presets',
      "      name: '@deepseek-ai/dsh-agent-presets'",
      '      config: { default: standard, includeShippedRoot: true, includeUserRoot: true, roots: [] }',
      `    - name: '${pathToFileURL(probeFile).href}'`,
      '',
    ].join('\n'))

    const launch = resolveExampleLaunch({
      mode: 'src',
      srcBin: dshSrcBin,
      tsconfigPath,
      configArgs: ['--profile', PROFILE],
      env: { DSH_HOME: home, DSH_COMMERCE_PROBE_OUT: report, DSH_TELEMETRY_DISABLED: '1' },
    })
    const result = await execa(launch.command, launch.args, {
      cwd: home,
      input: '',
      timeout: SPAWN_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      reject: false,
      env: launch.env,
    })
    const probed = await readFile(report, 'utf8').catch((error: unknown) => `<unreadable: ${String(error)}>`)
    const diagnostic = `exit=${String(result.exitCode)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    expect(probed, `probe wrote no report. ${diagnostic}`).not.toBe('')
    const probeReport = JSON.parse(probed) as {
      presets: string[]
      tools: string[]
      services: Record<string, boolean>
      presetRowState: number | null
      entries: { name: string; state: number | null }[]
      failure?: string
    }
    const detail = `${diagnostic}\nservices: ${JSON.stringify(probeReport.services)}\npreset row state: ${String(probeReport.presetRowState)}\ncommerce entries: ${
      JSON.stringify(probeReport.entries.filter(entry => entry.name.includes('commerce')))}`
    expect(probeReport.failure, detail).toBeUndefined()
    expect(probeReport.presets).toContain('commerce')
    expect(probeReport.tools, detail).toContain('commerce_load_sample')
    expect(probeReport.tools).toContain('commerce_export_changes')
  })
})
