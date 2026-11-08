import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Socket } from 'node:net'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentReachRunner } from '../src/runner.ts'

const python = process.env.AGENT_REACH_TEST_PYTHON
const backend = process.env.AGENT_REACH_TEST_YTDLP
const fixture = fileURLToPath(new URL('./fixtures/run-pinned-backend.py', import.meta.url))
const qualified = process.platform === 'darwin' && process.arch === 'arm64' && python !== undefined && backend !== undefined
  && fs.existsSync(python) && fs.existsSync(backend)
const reason = 'requires macOS arm64 and AGENT_REACH_TEST_PYTHON / AGENT_REACH_TEST_YTDLP; qualification INCOMPLETE otherwise'

interface Identity { pid: number; parent: number; group: number; command: string }
function processes(): Identity[] {
  return execFileSync('/bin/ps', ['-ax', '-o', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' })
    .trim().split('\n').flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line)
      return match ? [{ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), command: match[4]! }] : []
    })
}
function alive(identity: Identity): boolean {
  return processes().some(row => row.pid === identity.pid && row.command === identity.command)
}
async function exited(identity: Identity): Promise<void> {
  await expect.poll(() => alive(identity)).toBe(false)
}

describe.skipIf(!qualified)(`real upstream transient containment (${reason})`, () => {
  let ctx: Context
  let server: http.Server
  let port: number
  let directory: string
  let readyFile: string
  const watchers = new Set<fs.FSWatcher>()
  const sockets = new Set<Socket>()
  const owned: Identity[] = []

  beforeEach(async () => {
    // Qualification checks actual installed tools, not presence of arbitrary executable paths.
    const sourceIdentity = execFileSync(python!, ['-c',
      'import agent_reach,hashlib,inspect; from pathlib import Path; from agent_reach.runtime.run import run_cmd; print(agent_reach.__version__); print(hashlib.sha256(Path(inspect.getsourcefile(run_cmd)).read_bytes()).hexdigest())',
    ], { encoding: 'utf8' }).trim().split('\n')
    expect(sourceIdentity).toEqual(['1.6.1', 'd6a52e6280af149e4813a2971acc0b757e6b65b34b4f356344222747fbdb870e'])
    expect(execFileSync(backend!, ['--ignore-config', '--version'], { encoding: 'utf8' }).trim()).toBe('2026.08.19')
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-real-backend-'))
    readyFile = path.join(directory, 'ready.json')
    ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    server = http.createServer()
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.once('close', () => { sockets.delete(socket) })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    port = address.port
  })

  afterEach(async () => {
    await ctx?.fiber.dispose()
    for (const watcher of watchers) watcher.close()
    watchers.clear()
    if (fs.existsSync(readyFile)) {
      const rows = processes()
      for (const row of rows.filter(row => row.command.includes(readyFile)
        || (row.command.includes(` http://127.0.0.1:${port}/`) && row.command.includes(` ${backend} `)))) {
        if (!owned.some(identity => identity.pid === row.pid)) owned.push(row)
      }
    }
    for (const identity of owned.splice(0)) {
      if (alive(identity)) {
        try { process.kill(identity.pid, 'SIGKILL') } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH' && !alive(identity))) throw error
        }
      }
      await exited(identity)
    }
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    if (server) await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
    fs.rmSync(directory, { recursive: true, force: true })
  })

  async function ready(url: string): Promise<Identity> {
    await new Promise<void>((resolve) => {
      const observe = (): void => { if (fs.existsSync(readyFile)) resolve() }
      const watcher = fs.watch(directory, observe)
      watchers.add(watcher)
      observe()
    })
    const record: unknown = JSON.parse(fs.readFileSync(readyFile, 'utf8'))
    if (typeof record !== 'object' || record === null || !('pid' in record) || typeof record.pid !== 'number'
      || !('helper' in record) || typeof record.helper !== 'number') throw new Error('Malformed backend readiness')
    const rows = processes()
    const identity = rows.find(row => row.pid === record.pid && row.command.includes(` ${backend} `)
      && row.command.includes(url) && !row.command.includes(fixture))
    const helper = rows.find(row => row.pid === record.helper && row.command.includes(fixture) && row.command.includes('--backend-child'))
    if (!identity || !helper) throw new Error('Ready file does not identify the actual backend and helper')
    expect(identity.parent).toBe(helper.pid)
    owned.push(identity, helper)
    return identity
  }

  for (const kind of ['cancel', 'deadline', 'upstream-timeout', 'unload'] as const) {
    it(`terminates the actual backend and settles the runner on ${kind}`, async () => {
      let runner: AgentReachRunner | undefined
      const fiber = ctx.plugin({ inject: ['subprocess'], apply(scope: Context) {
        runner = new AgentReachRunner(scope, { runtimeOverride: python!, terminateGraceMs: 100 })
      } })
      await fiber
      if (!runner) throw new Error('Runner not mounted')
      const url = `http://127.0.0.1:${port}/${kind}.mp4`
      const readiness = ready(url)
      const controller = new AbortController()
      const result = runner.spawnCli([fixture, '--ytdlp', backend!, '--url', url,
        '--ready-file', readyFile, '--timeout', kind === 'upstream-timeout' ? '2' : '30'], {
        signal: controller.signal, timeoutMs: kind === 'deadline' ? 3000 : 15000,
      })
      const identity = await Promise.race([readiness, result.then((completion) => {
        if (fs.existsSync(readyFile)) return readiness
        throw new Error(`Execution ended before backend start: ${JSON.stringify(completion)}`)
      })])
      const wrapper = processes().find(row => row.pid === identity.parent)
      expect(identity.group).toBe(wrapper?.group)
      if (kind === 'cancel') controller.abort()
      if (kind === 'unload') await fiber.dispose()
      const completion = await result
      expect(completion.ok).toBe(false)
      if (kind === 'deadline') expect(completion.error?.code).toBe('TIMEOUT')
      if (kind === 'cancel') expect(completion.error?.code).toBe('EXECUTION_CANCELLED')
      if (kind === 'upstream-timeout') {
        expect(completion.error).toBeUndefined()
        expect(completion.exitCode).toBe(1)
        expect(completion.stderr).toContain('did not finish within 2s')
      }
      await exited(identity)
    })
  }

  it('observes the default-mode child survive wrapper termination and cleans the exact child', async () => {
    const url = `http://127.0.0.1:${port}/escape.mp4`
    const readiness = ready(url)
    const env: NodeJS.ProcessEnv = { ...process.env, NO_PROXY: '*', no_proxy: '*' }
    delete env.REACH_API_SUPERVISED
    const wrapper = spawn(python!, [fixture, '--ytdlp', backend!, '--url', url, '--ready-file', readyFile, '--timeout', '30'], { env })
    const wrapperExit = once(wrapper, 'exit')
    try {
      const identity = await readiness
      const helper = processes().find(row => row.pid === identity.parent)
      expect(identity.group).toBe(helper?.pid)
      expect(helper?.parent).toBe(wrapper.pid)
      wrapper.kill('SIGTERM')
      await wrapperExit
      expect(alive(identity)).toBe(true)
      process.kill(identity.pid, 'SIGKILL')
      await exited(identity)
    } finally {
      if (wrapper.exitCode === null && wrapper.signalCode === null) wrapper.kill('SIGKILL')
      await wrapperExit
    }
  })
})
