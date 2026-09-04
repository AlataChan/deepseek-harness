/** @vitest-environment jsdom */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ClientTransportHooks } from '@deepseek-ai/dsh-client-connection/client'
import { VSCODE_CARRIER_PROTOCOL_VERSION } from '@deepseek-ai/dsh-client-connection-process/protocol'
import {
  bootDesktopClient,
  resetDesktopBootstrapForTests,
} from '../src/bootstrap.ts'
import {
  parseCachedBundleState,
  parseCarrierOpenState,
  type DesktopShellPort,
} from '../src/harness-port.ts'
import { spawnCarrierHarness } from '../src/harness-spawn.ts'

const repoRoot = resolve('.')
const companionEntry = join(repoRoot, 'apps/cli/lib/desktop-companion.js')
const carrierHarnessBin = join(
  repoRoot,
  'apps/desktop/src-tauri/target/debug',
  platform() === 'win32' ? 'carrier-harness.exe' : 'carrier-harness',
)
const connectionProcessVersion = (
  JSON.parse(readFileSync(join(repoRoot, 'packages/client/connection-process/package.json'), 'utf8')) as { version: string }
).version
const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules'

const harnesses: Array<{ dispose: () => void }> = []

beforeAll(() => {
  if (!existsSync(companionEntry)) {
    execFileSync('pnpm', ['exec', 'tsc', '-b', 'apps/cli'], { cwd: repoRoot, stdio: 'inherit' })
    execFileSync('pnpm', ['exec', 'tsdown', '--config', 'apps/cli/tsdown.config.ts'], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
  }
  if (!existsSync(carrierHarnessBin)) {
    execFileSync('cargo', ['build', '--features', 'harness', '--bin', 'carrier-harness'], {
      cwd: join(repoRoot, 'apps/desktop/src-tauri'),
      stdio: 'inherit',
    })
  }
}, 180_000)

afterEach(() => {
  resetDesktopBootstrapForTests()
  for (const harness of harnesses) harness.dispose()
  harnesses.length = 0
})

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stageWorld(): {
  home: string
  workspaceRoot: string
  configDir: string
  cacheDir: string
  cliPath: string
  modulesSource: string
} {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-handshake-home-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-handshake-ws-'))
  const configDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-handshake-config-'))
  const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-handshake-cache-'))
  const modulesSource = join(workspaceRoot, 'modules.js')
  writeFileSync(modulesSource, 'export const modules = true\n')
  const profileDir = join(home, 'profiles', 'desktop')
  const bundleDir = join(profileDir, 'node_modules', 'dsh-desktop-handshake-fixture')
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(join(bundleDir, 'plugin.mjs'), [
    `const modules = ${JSON.stringify(CLIENT_MODULES_ID)}`,
    `const modulesPath = ${JSON.stringify(modulesSource)}`,
    'export const name = "desktop-handshake-fixture"',
    'export function apply(ctx) {',
    '  const graph = {',
    "    rev: 'graph-1',",
    '    entries: [',
    "      { id: modules, url: 'pending', rev: '1' },",
    '    ],',
    '    batches: [',
    "      { phase: 'bootstrap', url: 'pending-modules', rev: '1', entries: [modules] },",
    '    ],',
    '  }',
    '  ctx.provide(\'connection\', {',
    '    createSharedFetchHandler: () => ({ fetch: async () => new Response(\'{}\') }),',
    '  })',
    '  ctx.provide(\'typertGateway\', { wireStream: { open: async () => (async function * () {})() } })',
    '  ctx.provide(\'clientModules\', {',
    '    graph: () => graph,',
    '    clientPath: (id) => id === modules ? modulesPath : undefined,',
    '  })',
    '}',
    '',
  ].join('\n'))
  writeFileSync(join(bundleDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: fixture',
    `      name: ${pathToFileURL(join(bundleDir, 'plugin.mjs')).href}`,
    '    - id: connection-desktop',
    "      name: '@deepseek-ai/dsh-client-connection-desktop'",
    '      config:',
    '        workspaceRoot: !!js process.env.RAW_WORKSPACE_ROOT',
    '',
  ].join('\n'))
  writeFileSync(join(bundleDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-desktop-handshake-fixture',
    version: '0.0.0',
    type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-desktop-handshake',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['dsh-desktop-handshake-fixture'] } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  const cliPath = join(home, 'installed-runtime-cli.mjs')
  writeFileSync(cliPath, [
    'const out = {',
    '  nodePath: process.execPath,',
    `  packageRoot: ${JSON.stringify(home)},`,
    `  companionEntry: ${JSON.stringify(companionEntry)},`,
    `  runtimeVersion: ${JSON.stringify(connectionProcessVersion)},`,
    '  discoveryPath: process.execPath,',
    '}',
    'process.stdout.write(JSON.stringify(out) + "\\n")',
    '',
  ].join('\n'))
  return { home, workspaceRoot, configDir, cacheDir, cliPath, modulesSource }
}

function startHarness(world: ReturnType<typeof stageWorld>): DesktopShellPort {
  const harness = spawnCarrierHarness({
    bin: carrierHarnessBin,
    cwd: repoRoot,
    home: world.home,
    configDir: world.configDir,
    cacheDir: world.cacheDir,
    cliPath: world.cliPath,
    extraEnv: {
      DSH_HOME: world.home,
      DSH_TELEMETRY_DISABLED: '1',
      RAW_WORKSPACE_ROOT: world.workspaceRoot,
    },
  })
  harnesses.push(harness)
  return harness.port
}

describe('assembled desktop handshake', () => {
  it('boots the WebView bootstrap through the Rust carrier-harness', async () => {
    const world = stageWorld()
    const port = startHarness(world)
    await port.invoke('runtime_configure', { workspaceRoot: world.workspaceRoot })
    const sends: string[] = []
    const wrapped: DesktopShellPort = {
      createChannel: onEvent => port.createChannel(onEvent),
      async invoke(cmd, args) {
        if (cmd === 'carrier_send') {
          sends.push(typeof args?.line === 'string' ? args.line : '')
        }
        return port.invoke(cmd, args)
      },
    }
    let published: ClientTransportHooks | undefined
    const result = await bootDesktopClient({
      port: wrapped,
      root: document.createElement('div'),
      extensionVersion: '0.1.2-rc.1',
      handshakeTimeoutMs: 30_000,
      loadBundle: async () => {},
      createAppEntry: () => ({
        async run() {
          published = (globalThis as { __DSH_TRANSPORT__?: ClientTransportHooks }).__DSH_TRANSPORT__
        },
      }),
    })
    expect(result, result.status === 'home' ? result.reason : undefined).toMatchObject({ status: 'ready' })
    const first = JSON.parse(sends[0] ?? 'null') as { type?: string; encoded?: string }
    expect(first.type).toBe('wire/message')
    expect(JSON.parse(first.encoded ?? '{}')).toMatchObject({
      type: 'control/hello',
      protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
      workspaceRoot: world.workspaceRoot,
    })
    if (result.status !== 'ready') throw new Error('expected ready')
    expect(result.ready.runtimeVersion).toBe(connectionProcessVersion)
    const generation = join(world.cacheDir, 'bundle-cache', sha256Text('graph-1'))
    expect(existsSync(generation)).toBe(true)
    const cached = parseCachedBundleState(await port.invoke('cache_bundle', {
      sourcePath: world.modulesSource,
      sha256: sha256Text(readFileSync(world.modulesSource, 'utf8')),
      graphRev: 'graph-1',
      index: 0,
      id: CLIENT_MODULES_ID,
    }))
    expect(cached.allowed).toEqual([generation])
    expect(published?.ownsHost).toBe(true)
    expect(typeof published?.fetch).toBe('function')
  }, 60_000)

  it('reopens the carrier against the same home only after the first child exits', async () => {
    const world = stageWorld()
    const port = startHarness(world)
    await port.invoke('runtime_configure', { workspaceRoot: world.workspaceRoot })
    await port.invoke('runtime_resolve')
    const first = parseCarrierOpenState(await port.invoke('carrier_open'))
    const second = parseCarrierOpenState(await port.invoke('carrier_open'))
    expect(second.generationId).not.toBe(first.generationId)
  }, 60_000)
})
