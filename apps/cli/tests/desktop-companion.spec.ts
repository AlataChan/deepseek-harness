/** Published desktop companion entry over stdio NDJSON and the home lease. */

import { type ChildProcess, spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { VSCODE_CARRIER_PROTOCOL_VERSION } from '@deepseek-ai/dsh-client-connection-process/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireHomeLease } from '../src/home-lease.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const companionSource = fileURLToPath(new URL('../src/desktop-companion.ts', import.meta.url))
const cliManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  dsh?: { companions?: { desktop?: string } }
}

interface CompanionFixture {
  home: string
  workspaceRoot: string
}

const children = new Set<ChildProcess>()

afterEach(() => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  children.clear()
})

function stageFixture(holdStartup = false): CompanionFixture {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-companion-'))
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-workspace-'))
  const profileDir = join(home, 'profiles', 'desktop')
  const bundleDir = join(profileDir, 'node_modules', 'dsh-desktop-companion-fixture')
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(join(bundleDir, 'plugin.mjs'), [
    "export const name = 'desktop-companion-fixture'",
    'export function apply(ctx) {',
    "  ctx.provide('connection', { createSharedFetchHandler: () => ({ fetch: async () => new Response('{}') }) })",
    "  ctx.provide('typertGateway', { wireStream: { open: async () => (async function * () {})() } })",
    "  ctx.provide('clientModules', { graph: () => ({ rev: 'fixture', entries: [], batches: [] }), clientPath: () => undefined, onGraphChanged: () => () => {} })",
    '}',
    '',
  ].join('\n'))
  const barrier = join(bundleDir, 'startup-barrier.mjs')
  if (holdStartup) writeFileSync(barrier, [
    "import { writeFile } from 'node:fs/promises'",
    "import { existsSync } from 'node:fs'",
    "import { join } from 'node:path'",
    "export const name = 'startup-barrier'",
    'export async function apply(ctx) {',
    "  ctx.effect(() => async () => { await writeFile(join(process.env.DSH_HOME, 'disposal-complete'), 'done') })",
    "  await writeFile(join(process.env.DSH_HOME, 'startup-entered'), 'ready')",
    "  await new Promise(resolve => { const timer = setInterval(() => { if (existsSync(join(process.env.DSH_HOME, 'release-startup'))) { clearInterval(timer); resolve() } }, 10) })",
    '}',
  ].join('\n'))
  writeFileSync(join(bundleDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: fixture',
    `      name: ${pathToFileURL(join(bundleDir, 'plugin.mjs')).href}`,
    '    - id: connection-desktop',
    "      name: '@deepseek-ai/dsh-client-connection-desktop'",
    '      config:',
    '        workspaceRoot: !!js process.env.RAW_WORKSPACE_ROOT',
    ...(holdStartup ? ['    - id: startup-barrier', `      name: ${pathToFileURL(barrier).href}`] : []),
    '',
  ].join('\n'))
  writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
    name: 'dsh-desktop-companion-fixture',
    version: '0.0.0',
    type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, undefined, 2) + '\n')
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop-test',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['dsh-desktop-companion-fixture'] } },
  }, undefined, 2) + '\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  return { home, workspaceRoot }
}

function spawnDesktop(fixture: CompanionFixture): ChildProcess {
  const child = spawn(process.execPath, ['--import', 'tsx/esm', companionSource, '--workspace-root', fixture.workspaceRoot], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DSH_HOME: fixture.home,
      DSH_TELEMETRY_DISABLED: '1',
      RAW_WORKSPACE_ROOT: fixture.workspaceRoot,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.add(child)
  return child
}

function firstRecord(stdout: Readable | null): Promise<unknown> {
  if (stdout === null) return Promise.reject(new Error('desktop companion stdout is missing'))
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => { reject(new Error('timed out waiting for desktop companion stdout')) }, 20_000)
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      stdout.off('data', onData)
      clearTimeout(timer)
      try {
        const physical = JSON.parse(buffer.slice(0, newline)) as { type?: string; encoded?: string }
        if (physical.type === 'wire/message' && typeof physical.encoded === 'string') {
          resolve(JSON.parse(physical.encoded))
          return
        }
        resolve(physical)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    stdout.on('data', onData)
  })
}

function sendHello(stdin: NodeJS.WritableStream | null, workspaceRoot: string): void {
  if (stdin === null) throw new Error('desktop companion stdin is missing')
  const frame = {
    type: 'control/hello',
    protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
    extensionVersion: 'test',
    workspaceRoot,
    locale: 'en',
  }
  stdin.write(`${JSON.stringify({ type: 'wire/message', encoded: JSON.stringify(frame) })}\n`)
}

describe('the desktop companion entry', () => {
  it('declares the desktop companion entry', () => {
    expect(cliManifest.dsh?.companions?.desktop).toBe('./lib/desktop-companion.js')
  })

  it('does not emit ready before hello, then answers hello with ready', { timeout: 30_000 }, async () => {
    const fixture = stageFixture()
    const child = spawnDesktop(fixture)
    const first = firstRecord(child.stdout)
    sendHello(child.stdin, fixture.workspaceRoot)
    await expect(first).resolves.toMatchObject({ type: 'control/ready' })
    child.kill('SIGTERM')
  })

  it.each([false, true])('announces readiness after profile boot and disposes before parent-close exit (EOF: %s)', { timeout: 30_000 }, async (closeInput) => {
    const fixture = stageFixture(true)
    const child = spawnDesktop(fixture)
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
      child.once('exit', (code, signal) => { resolveExit({ code, signal }) })
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const ready = firstRecord(child.stdout)
      sendHello(child.stdin, fixture.workspaceRoot)
      let announced = false
      void ready.then(() => { announced = true }, () => {})
      const startupDeadline = Date.now() + 15_000
      while (!existsSync(join(fixture.home, 'startup-entered'))) {
        if (Date.now() >= startupDeadline) throw new Error('Startup barrier was not entered')
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(announced).toBe(false)
      writeFileSync(join(fixture.home, 'release-startup'), 'go')
      await expect(ready).resolves.toMatchObject({ type: 'control/ready' })
      child.stdout?.resume()
      child.stderr?.resume()
      expect(existsSync(join(fixture.home, 'disposal-complete'))).toBe(false)
      // Exercise both an open pipe and the Rust carrier's immediate EOF.
      child.stdin?.write(`${JSON.stringify({ type: 'wire/message', encoded: JSON.stringify({ type: 'control/shutdown' }) })}\n`)
      if (closeInput) child.stdin?.end()
      const result = await Promise.race([
        exited,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { reject(new Error('Parent disconnect left the booting companion alive')) }, 4_500)
        }),
      ])
      expect(result).toEqual({ code: 0, signal: null })
      expect(readFileSync(join(fixture.home, 'disposal-complete'), 'utf8')).toBe('done')
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exited
      children.delete(child)
      child.stdin?.destroy()
      child.stdout?.destroy()
      child.stderr?.destroy()
      rmSync(fixture.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      rmSync(fixture.workspaceRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('reports home-busy on stdout when the home is already leased', { timeout: 30_000 }, async () => {
    const fixture = stageFixture()
    const lease = acquireHomeLease(fixture.home, { surface: 'vscode' })
    const child = spawnDesktop(fixture)
    await expect(firstRecord(child.stdout)).resolves.toMatchObject({
      type: 'control/error', code: 'home-busy',
    })
    lease.release()
    child.kill('SIGTERM')
  })
})
