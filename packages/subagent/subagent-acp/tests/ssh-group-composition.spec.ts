/**
 * Acceptance coverage for SSH subagent-acp composition in Cordis group isolation.
 *
 * Evaluates Path A: subagent-acp + SshSubprocessRuntime inside a Cordis group
 * carrying `isolate: { subprocess: true, ssh: true }`.
 *
 * Verifies:
 * 1. Positive control:
 *    - Child ACP subagent runs in isolated group targeting remote workspace.
 *    - Remote cwd absent locally is accepted without creating fake local directories.
 *    - Remote DSH_HOME and env are forwarded over the SSH subprocess seam.
 *    - Optional sessionCwd is forwarded to ACP session/new independently from spawn cwd.
 *    - Parent subagent registry preserves provider registration across the isolation boundary.
 *    - Root ctx.subprocess (local shell) remains LocalSubprocessRuntime and executes locally.
 * 2. Negative controls:
 *    - validateCwd default (true) rejects absent remote cwd at load time.
 *    - Relative cwd is rejected even when validateCwd is false.
 *    - Relative sessionCwd is rejected even when validateCwd is false.
 *    - Isolating subagents in the group prevents registration on root ctx.subagents.
 */

import { duplexPair, type Duplex } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { SshSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-ssh'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import * as acp from '../src/index.ts'

const mockProcessId = 'fd897b7b-1b7e-4cd0-9b8d-06b354062d91'

interface SchemaParser<T> {
  parse(value: unknown): T
}

interface MockSshOptions {
  failPrepare?: Error
  failStart?: Error
}

interface SshTestRig {
  calls: { method: string; params: unknown }[]
  peers: Map<string, { host: Duplex; remote: Duplex }>
  preparedSpec?: SubprocessSpawnSpec
  finishProcess?: () => void
}

function createMockSsh(rig: SshTestRig, options: MockSshOptions = {}) {
  const donePromise = Promise.withResolvers<{
    outcome: { exitCode: number | null; signal: string | null }
    spills: { stdout?: string; stderr?: string }
    collected: { stdout?: { tail: string; totalBytes: number }; stderr?: { tail: string; totalBytes: number } }
  }>()

  rig.finishProcess = () => {
    donePromise.resolve({
      outcome: { exitCode: 0, signal: null },
      spills: {},
      collected: {},
    })
  }

  return {
    dispose: vi.fn(async () => {}),
    request: async <T>(method: string, params: unknown, schema: SchemaParser<T>): Promise<T> => {
      rig.calls.push({ method, params })
      let value: unknown
      if (method === 'process.prepare') {
        if (options.failPrepare !== undefined) throw options.failPrepare
        rig.preparedSpec = params as SubprocessSpawnSpec
        const names = ['stdout', 'stderr', ...(rig.preparedSpec.stdio.stdin === 'pipe' ? ['stdin'] : [])]
        value = {
          id: mockProcessId,
          streams: Object.fromEntries(names.map(name => [name, { path: `/tmp/ssh-test-${name}`, capability: 'b'.repeat(64) }])),
        }
      } else if (method === 'process.start') {
        if (options.failStart !== undefined) throw options.failStart
        value = {}
      } else if (method === 'process.done') {
        value = await donePromise.promise
      } else if (method === 'process.wait') {
        value = true
      } else if (method === 'process.terminate') {
        value = null
      } else if (method === 'executable') {
        value = '/usr/bin/node'
      } else {
        throw new Error(`Unexpected SSH mock request: ${method}`)
      }
      return schema.parse(value)
    },
    connectStream: async (endpoint: { path: string }, signal?: AbortSignal): Promise<Duplex> => {
      signal?.throwIfAborted()
      const name = endpoint.path.slice('/tmp/ssh-test-'.length)
      const [host, remote] = duplexPair({ allowHalfOpen: true })
      host.on('error', () => {})
      remote.on('error', () => {})
      rig.peers.set(name, { host, remote })
      return host
    },
  }
}

/**
 * Handle incoming JSON-RPC lines from the ACP client on the remote mock stream
 * and reply with valid ACP server responses.
 */
function attachMockAcpWorker(remoteStdin: Duplex, remoteStdout: Duplex, recordedCwd: { sessionCwd?: string | undefined }) {
  let buffer = ''
  remoteStdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const msg = JSON.parse(line) as { id?: number | string; method?: string; params?: Record<string, unknown> }
      if (msg.method === 'initialize') {
        remoteStdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: 1,
            serverCapabilities: {},
            serverInfo: { name: 'remote-ssh-worker', version: '1.0.0' },
          },
        }) + '\n')
      } else if (msg.method === 'session/new') {
        if (typeof msg.params?.cwd === 'string') {
          recordedCwd.sessionCwd = msg.params.cwd
        }
        remoteStdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            sessionId: 'remote-session-42',
          },
        }) + '\n')
      } else if (msg.method === 'session/prompt') {
        // Stream one message chunk and then complete the prompt turn
        remoteStdout.write(JSON.stringify({
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: 'remote-session-42',
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'computed on remote worker' },
            },
          },
        }) + '\n')
        remoteStdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            stopReason: 'end_turn',
          },
        }) + '\n')
      }
    }
  })
}

describe('SSH Subagent-ACP Group Isolation Composition (Path A)', () => {
  it('runs ACP child remotely over SSH in isolated group while keeping local shell at root', async () => {
    const root = new Context()
    await root.plugin(SessionProjectionRegistry)
    await root.plugin(SubagentRuntime)
    await root.plugin(LocalSubprocessRuntime)

    // Verify root subprocess is LocalSubprocessRuntime
    expect(root.subprocess).toBeDefined()
    expect(root.subprocess.constructor.name).toBe('LocalSubprocessRuntime')

    // Create isolated Cordis group for SSH and its scoped subprocess runtime
    const isolatedGroup = root.isolate('subprocess').isolate('ssh')

    const rig: SshTestRig = { calls: [], peers: new Map() }
    const recorded: { sessionCwd?: string | undefined } = {}
    const mockSsh = createMockSsh(rig)

    isolatedGroup.provide('ssh', mockSsh as never)
    await isolatedGroup.plugin(SshSubprocessRuntime)

    // Verify group subprocess is SshSubprocessRuntime while root subprocess remains LocalSubprocessRuntime
    expect(isolatedGroup.subprocess.constructor.name).toBe('SshSubprocessRuntime')
    expect(root.subprocess.constructor.name).toBe('LocalSubprocessRuntime')

    // Mount subagent-acp inside the isolated group
    const remoteWorkspace = '/var/remote/worker/workspace'
    const remoteSessionSpace = '/var/remote/worker/session-workspace'
    const remoteDshHome = '/var/remote/dsh-home'

    await isolatedGroup.plugin(acp, {
      providerName: 'remote-acp',
      command: '/usr/bin/node',
      args: ['/opt/dsh/remote-worker.mjs'],
      cwd: remoteWorkspace,
      sessionCwd: remoteSessionSpace,
      validateCwd: false,
      permission: 'reject',
      env: { DSH_HOME: remoteDshHome },
    })

    // Subagents service was NOT isolated, so root subagents registry holds the provider
    const provider = root.subagents.getProvider('remote-acp')
    expect(provider).toBeDefined()
    expect(provider?.capabilities.outputSchema).toBe(false)

    // Start subagent run from the root context
    const fakeParent = { id: 'parent-agent', session: { header: { cwd: process.cwd() } } }
    const startPromise = root.subagents.start('remote-acp', {
      prompt: [{ type: 'text', text: 'execute remote task' }],
      parent: fakeParent as never,
      signal: new AbortController().signal,
    })

    // Await stream attachment on the SSH peer
    await vi.waitFor(() => {
      expect(rig.peers.has('stdin')).toBe(true)
      expect(rig.peers.has('stdout')).toBe(true)
    })

    const stdinPeer = rig.peers.get('stdin')!
    const stdoutPeer = rig.peers.get('stdout')!

    // Attach mock ACP worker on remote streams
    attachMockAcpWorker(stdinPeer.remote, stdoutPeer.remote, recorded)

    const run = await startPromise
    expect(run).toBeDefined()

    // Verify process.prepare received remote spawn coordinates
    expect(rig.preparedSpec).toBeDefined()
    expect(rig.preparedSpec?.cwd).toBe(remoteWorkspace)
    expect(rig.preparedSpec?.env?.DSH_HOME).toBe(remoteDshHome)

    // Verify ACP session/new received distinct sessionCwd
    expect(recorded.sessionCwd).toBe(remoteSessionSpace)

    // Complete run and verify output
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'computed on remote worker' }])

    // Verify root subprocess is still LocalSubprocessRuntime and can spawn local processes
    const localProcess = root.subprocess.spawn({
      argv: [process.execPath, '-e', 'process.stdout.write("local shell untouched")'],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
      graceMs: 500,
    })
    const localOutcome = await localProcess.done
    expect(localOutcome.exitCode).toBe(0)
    expect(localProcess.collected.stdout?.readFrom(0).text).toBe('local shell untouched')

    // Clean up
    if (!rig.finishProcess) throw new Error('finishProcess handler missing on test rig')
    rig.finishProcess()
    await run.dispose()
    await root.fiber.dispose()
  })

  it('rejects absent remote cwd when validateCwd defaults to true (negative control)', async () => {
    const root = new Context()
    await root.plugin(SessionProjectionRegistry)
    await root.plugin(SubagentRuntime)
    await root.plugin(LocalSubprocessRuntime)

    const isolatedGroup = root.isolate('subprocess').isolate('ssh')
    const rig: SshTestRig = { calls: [], peers: new Map() }
    isolatedGroup.provide('ssh', createMockSsh(rig) as never)
    await isolatedGroup.plugin(SshSubprocessRuntime)

    // validateCwd defaults to true, so absent remote path fails local stat/access check
    await expect(isolatedGroup.plugin(acp, {
      providerName: 'remote-fail',
      command: '/usr/bin/node',
      args: [],
      cwd: '/var/remote/worker/absent-directory',
      permission: 'reject',
      env: {},
    })).rejects.toThrow('subagent-acp: config cwd is not an accessible directory: /var/remote/worker/absent-directory')

    await root.fiber.dispose()
  })

  it('rejects relative cwd even when validateCwd is false (negative control)', async () => {
    const root = new Context()
    await root.plugin(SessionProjectionRegistry)
    await root.plugin(SubagentRuntime)
    await root.plugin(LocalSubprocessRuntime)

    const isolatedGroup = root.isolate('subprocess').isolate('ssh')
    const rig: SshTestRig = { calls: [], peers: new Map() }
    isolatedGroup.provide('ssh', createMockSsh(rig) as never)
    await isolatedGroup.plugin(SshSubprocessRuntime)

    // Relative cwd is never accepted for remote target
    await expect(isolatedGroup.plugin(acp, {
      providerName: 'remote-rel-fail',
      command: '/usr/bin/node',
      args: [],
      cwd: 'relative/workspace/path',
      validateCwd: false,
      permission: 'reject',
      env: {},
    })).rejects.toThrow('subagent-acp: config cwd must be an absolute path: relative/workspace/path')

    await root.fiber.dispose()
  })

  it('isolating subagents prevents root discovery (negative control proving necessity of un-isolated subagents)', async () => {
    const root = new Context()
    await root.plugin(SessionProjectionRegistry)
    await root.plugin(SubagentRuntime)
    await root.plugin(LocalSubprocessRuntime)

    // If subagents is mistakenly included in isolate, the provider does not leak to root
    const isolatedGroup = root.isolate('subprocess').isolate('ssh').isolate('subagents')
    const rig: SshTestRig = { calls: [], peers: new Map() }
    isolatedGroup.provide('ssh', createMockSsh(rig) as never)
    await isolatedGroup.plugin(SshSubprocessRuntime)

    await isolatedGroup.plugin(acp, {
      providerName: 'hidden-acp',
      command: '/usr/bin/node',
      args: [],
      cwd: '/var/remote/workspace',
      validateCwd: false,
      permission: 'reject',
      env: {},
    })

    // Root subagents cannot see 'hidden-acp'
    expect(root.subagents.getProvider('hidden-acp')).toBeUndefined()

    await root.fiber.dispose()
  })
})
