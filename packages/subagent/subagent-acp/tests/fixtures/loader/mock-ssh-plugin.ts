import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer, createConnection, type Server, type Socket } from 'node:net'
import { rm } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

interface SchemaParser<T> {
  parse(value: unknown): T
}

interface ProcessRecord {
  spec: SubprocessSpawnSpec
  child?: ChildProcess
  donePromise: Promise<{
    outcome: { exitCode: number | null; signal: string | null }
    spills: object
    collected: object
  }>
  resolveDone: (result: { outcome: { exitCode: number | null; signal: string | null }; spills: object; collected: object }) => void
  servers: Map<string, Server>
  sockets: Set<Socket>
  socketPaths: string[]
  inbound: PassThrough
  outbound: PassThrough
  errbound: PassThrough
}

/**
 * Mock SSH transport plugin for local source-plane composition tests.
 * Implements the ctx.ssh capability expected by SshSubprocessRuntime
 * without requiring a live remote network host.
 */
export class MockSshTransport extends Service {
  readonly ready = Promise.resolve({
    workspace: '/mock/remote/workspace',
    node: process.execPath,
    root: '/mock/remote',
    hash: '0'.repeat(64),
  })

  private readonly processes = new Map<string, ProcessRecord>()
  private disposed = false

  constructor(ctx: Context) {
    super(ctx, 'ssh')
    ctx.effect(() => () => { void this.dispose() })
  }

  async request<T>(method: string, params: unknown, schema: SchemaParser<T>): Promise<T> {
    if (this.disposed) throw new Error('MockSshTransport is disposed')

    if (method === 'process.prepare') {
      const spec = params as SubprocessSpawnSpec
      const id = randomUUID()
      const servers = new Map<string, Server>()
      const sockets = new Set<Socket>()
      const socketPaths: string[] = []

      const inbound = new PassThrough()
      const outbound = new PassThrough()
      const errbound = new PassThrough()

      const channels = ['stdout', 'stderr', ...(spec.stdio.stdin === 'pipe' ? ['stdin'] : [])]
      const serverReadyPromises: Promise<void>[] = []

      for (const name of channels) {
        const sockPath = `/tmp/mock-ssh-${id}-${name}.sock`
        socketPaths.push(sockPath)
        const server = createServer({ allowHalfOpen: true }, (clientSocket) => {
          sockets.add(clientSocket)
          clientSocket.once('close', () => {
            sockets.delete(clientSocket)
          })

          if (name === 'stdin') {
            clientSocket.pipe(inbound)
          } else if (name === 'stdout') {
            outbound.pipe(clientSocket)
          } else if (name === 'stderr') {
            errbound.pipe(clientSocket)
          }
        })
        servers.set(name, server)

        const ready = new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen(sockPath, () => {
            server.off('error', reject)
            resolve()
          })
        })
        serverReadyPromises.push(ready)
      }

      await Promise.all(serverReadyPromises)

      let resolveDone!: (result: { outcome: { exitCode: number | null; signal: string | null }; spills: object; collected: object }) => void
      const donePromise = new Promise<{
        outcome: { exitCode: number | null; signal: string | null }
        spills: object
        collected: object
      }>((resolve) => {
        resolveDone = resolve
      })

      this.processes.set(id, {
        spec,
        donePromise,
        resolveDone,
        servers,
        sockets,
        socketPaths,
        inbound,
        outbound,
        errbound,
      })

      const value = {
        id,
        streams: Object.fromEntries(
          channels.map(name => [name, { path: `/tmp/mock-ssh-${id}-${name}`, capability: 'b'.repeat(64) }]),
        ),
      }
      return schema.parse(value)
    }

    if (method === 'process.start') {
      const { id } = params as { id: string }
      const record = this.processes.get(id)
      if (!record) throw new Error(`Unknown process id: ${id}`)

      // Spawn child ACP process on start
      const child = spawn(process.execPath, record.spec.argv.slice(1), {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...record.spec.env,
          MOCK_ECHO_CWD: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      record.child = child

      if (child.stdin) {
        record.inbound.pipe(child.stdin)
      }
      if (child.stdout) {
        child.stdout.pipe(record.outbound)
      }
      if (child.stderr) {
        child.stderr.pipe(record.errbound)
      }

      child.once('close', (exitCode, signal) => {
        record.resolveDone({
          outcome: { exitCode, signal },
          spills: {},
          collected: {},
        })
      })

      return schema.parse({})
    }

    if (method === 'process.done') {
      const { id } = params as { id: string }
      const record = this.processes.get(id)
      if (!record) throw new Error(`Unknown process id: ${id}`)
      const result = await record.donePromise
      return schema.parse(result)
    }

    if (method === 'process.wait') {
      return schema.parse(true)
    }

    if (method === 'process.terminate') {
      const { id } = params as { id: string }
      const record = this.processes.get(id)
      record?.child?.kill('SIGTERM')
      return schema.parse(null)
    }

    if (method === 'executable') {
      return schema.parse(process.execPath)
    }

    throw new Error(`Unhandled mock SSH method: ${method}`)
  }

  async connectStream(endpoint: { path: string }, signal?: AbortSignal): Promise<Socket> {
    signal?.throwIfAborted()
    const match = /^\/tmp\/mock-ssh-(.+)-(stdin|stdout|stderr)$/.exec(endpoint.path)
    if (!match) throw new Error(`Invalid mock endpoint path: ${endpoint.path}`)
    const [, id, channel] = match
    const record = this.processes.get(id!)
    if (!record) throw new Error(`Unknown process id: ${id}`)
    const sockPath = `/tmp/mock-ssh-${id}-${channel}.sock`

    const socket = createConnection({ path: sockPath, allowHalfOpen: true })
    record.sockets.add(socket)
    socket.once('close', () => {
      record.sockets.delete(socket)
    })

    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        signal?.removeEventListener('abort', aborted)
        socket.off('connect', connected)
        socket.off('error', failed)
      }
      const connected = (): void => {
        cleanup()
        resolve()
      }
      const failed = (err: Error): void => {
        cleanup()
        reject(err)
      }
      const aborted = (): void => {
        socket.destroy(new Error('connectStream aborted'))
      }

      socket.once('connect', connected)
      socket.once('error', failed)
      signal?.addEventListener('abort', aborted, { once: true })
    })

    return socket
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true

    const cleanups: Promise<void>[] = []
    for (const record of this.processes.values()) {
      for (const socket of record.sockets) {
        socket.destroy()
      }
      for (const server of record.servers.values()) {
        server.close()
      }
      for (const path of record.socketPaths) {
        cleanups.push(rm(path, { force: true }).catch(() => {}))
      }
      if (record.child && !record.child.killed && record.child.exitCode === null) {
        const childProc = record.child
        const exitPromise = new Promise<void>((resolve) => {
          childProc.once('close', () => {
            resolve()
          })
        })
        childProc.kill('SIGTERM')
        const forceKill = setTimeout(() => {
          if (childProc.exitCode === null) childProc.kill('SIGKILL')
        }, 1000)
        cleanups.push(exitPromise.finally(() => {
          clearTimeout(forceKill)
        }))
      }
    }

    await Promise.all(cleanups)
    this.processes.clear()
  }
}

export const name = 'mock-ssh'

/**
 * Plugin entry applying MockSshTransport to the context.
 * @param ctx - plugin Context
 */
export function apply(ctx: Context): void {
  ctx.plugin(MockSshTransport)
}
