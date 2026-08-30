/** Published desktop companion entry over stdio NDJSON and the home lease. */

import { type ChildProcess, spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

function stageFixture(): CompanionFixture {
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
    "  ctx.provide('clientModules', { graph: () => ({ rev: 'fixture', entries: [], batches: [] }), clientPath: () => undefined })",
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
