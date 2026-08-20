/** Published VS Code companion entry over real Node fork IPC and home lease. */

import { type ChildProcess, fork } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  sendVsCodeFrame,
  VsCodeWireDecoder,
  VSCODE_CARRIER_PROTOCOL_VERSION,
  type VsCodeCarrierFrame,
  type VsCodeWireRecord,
} from '@deepseek-ai/dsh-client-connection-vscode'
import { afterEach, describe, expect, it } from 'vitest'
import { VSCODE_HOME_LEASE_RELATIVE_PATH } from '../src/vscode-home-lease.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const cliManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  dsh?: { companions?: { vscode?: string } }
}
const publishedCompanion = join(
  repoRoot,
  'apps/cli',
  cliManifest.dsh?.companions?.vscode ?? 'missing-vscode-companion',
)

interface CompanionFixture {
  home: string
  workspaceRoot: string
  bootCount: string
  disposed: string
}

const children = new Set<ChildProcess>()

afterEach(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  children.clear()
})

/** Stage a minimal vscode profile around the real process-IPC gateway. */
function stageFixture(): CompanionFixture {
  const home = mkdtempSync(join(tmpdir(), 'dsh-vscode-companion-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'dsh-vscode-workspace-'))
  const bootCount = join(home, 'boot-count')
  const disposed = join(home, 'disposed')
  const profileDir = join(home, 'profiles', 'vscode')
  const bundleDir = join(profileDir, 'node_modules', 'dsh-vscode-companion-fixture')
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(join(bundleDir, 'plugin.mjs'), [
    "import { appendFileSync, writeFileSync } from 'node:fs'",
    "export const name = 'vscode-companion-fixture'",
    'export function apply(ctx) {',
    "  appendFileSync(process.env.RAW_BOOT_COUNT, 'boot\\n')",
    "  ctx.provide('apiProxy', {})",
    "  ctx.provide('clientModules', { graph: () => ({ rev: 'fixture', entries: [] }), bundleRecords: () => [] })",
    '  ctx.effect(() => () => {',
    "    writeFileSync(process.env.RAW_DISPOSED, 'disposed')",
    '  })',
    '}',
    '',
  ].join('\n'))
  writeFileSync(join(bundleDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: fixture',
    `      name: ${pathToFileURL(join(bundleDir, 'plugin.mjs')).href}`,
    '    - id: connection-vscode',
    "      name: '@deepseek-ai/dsh-client-connection-vscode'",
    '      config:',
    '        workspaceRoot: !!js process.env.RAW_WORKSPACE_ROOT',
    '',
  ].join('\n'))
  writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
    name: 'dsh-vscode-companion-fixture',
    version: '0.0.0',
    type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2) + '\n')
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-vscode-test',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['dsh-vscode-companion-fixture'] } },
  }, undefined, 2) + '\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  return { home, workspaceRoot, bootCount, disposed }
}

/** Fork the exact module path published for extension discovery. */
function startCompanion(fixture: CompanionFixture): ChildProcess {
  const child = fork(publishedCompanion, ['--workspace-root', fixture.workspaceRoot], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DSH_HOME: fixture.home,
      DSH_TELEMETRY_DISABLED: '1',
      RAW_BOOT_COUNT: fixture.bootCount,
      RAW_DISPOSED: fixture.disposed,
      RAW_WORKSPACE_ROOT: fixture.workspaceRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  children.add(child)
  return child
}

/** Ordered logical-frame receiver over child-process message events. */
class FrameReceiver {
  private readonly decoder = new VsCodeWireDecoder()
  private readonly frames: VsCodeCarrierFrame[] = []
  private readonly waiters: ((frame: VsCodeCarrierFrame) => void)[] = []
  private tail = Promise.resolve()

  constructor(child: ChildProcess) {
    child.on('message', (value) => {
      this.tail = this.tail.then(async () => {
        const frame = await this.decoder.accept(value)
        if (frame === undefined) return
        const waiter = this.waiters.shift()
        if (waiter === undefined) this.frames.push(frame)
        else waiter(frame)
      })
    })
  }

  /** Await the next complete logical frame. */
  next(): Promise<VsCodeCarrierFrame> {
    const frame = this.frames.shift()
    if (frame !== undefined) return Promise.resolve(frame)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('timed out waiting for companion frame')) }, 20_000)
      this.waiters.push((value) => {
        clearTimeout(timer)
        resolve(value)
      })
    })
  }
}

/** Send one bounded logical frame through the parent side of fork IPC. */
function sendFrame(child: ChildProcess, frame: VsCodeCarrierFrame): Promise<void> {
  return sendVsCodeFrame(frame, (record: VsCodeWireRecord) => new Promise((resolve, reject) => {
    child.send(record, (error) => {
      if (error === null || error === undefined) resolve()
      else reject(error)
    })
  }))
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`companion marker did not appear: ${path}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

function waitForExit(child: ChildProcess): Promise<number> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolve) => {
    child.once('exit', (code) => { resolve(code ?? -1) })
  })
}

describe('VS Code companion process', () => {
  it('publishes a second built entry and rejects a second writer before profile boot', { timeout: 30_000 }, async () => {
    expect(cliManifest.dsh?.companions?.vscode).toBe('./lib/vscode-companion.js')
    const fixture = stageFixture()
    const first = startCompanion(fixture)
    const firstFrames = new FrameReceiver(first)
    await waitForFile(fixture.bootCount)
    await sendFrame(first, {
      type: 'control/hello',
      protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
      extensionVersion: 'test',
      workspaceRoot: fixture.workspaceRoot,
      locale: 'zh-cn',
    })
    const ready = await firstFrames.next()
    if (ready.type === 'control/error') throw new Error(`${ready.code}: ${ready.message}`)
    expect(ready).toMatchObject({
      type: 'control/ready',
      protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
      graph: { rev: 'fixture', entries: [] },
    })

    const second = startCompanion(fixture)
    const secondFrames = new FrameReceiver(second)
    expect(await secondFrames.next()).toMatchObject({ type: 'control/error', code: 'home-busy' })
    expect(await waitForExit(second)).toBe(1)
    expect(readFileSync(fixture.bootCount, 'utf8')).toBe('boot\n')

    await sendFrame(first, { type: 'control/shutdown' })
    expect(await firstFrames.next()).toEqual({ type: 'control/shutdown-complete' })
    expect(await waitForExit(first)).toBe(0)
    expect(existsSync(join(fixture.home, VSCODE_HOME_LEASE_RELATIVE_PATH))).toBe(false)
    expect(readFileSync(fixture.disposed, 'utf8')).toBe('disposed')
  })
})
