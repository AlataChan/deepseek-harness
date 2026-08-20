/** Real companion subprocess driver for the assembled VS Code snapshot. */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VsCodeApiClient, type VsCodeBridgePort } from '@deepseek-ai/dsh-client-connection-vscode/client'
import { sendVsCodeFrame, VsCodeWireDecoder } from '@deepseek-ai/dsh-client-connection-vscode/codec'
import {
  VSCODE_CARRIER_PROTOCOL_VERSION,
  vsCodeWireRecordSchema,
  type ControlReadyFrame,
  type VsCodeWireRecord,
} from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import { resolveExampleLaunch, resolveExampleMode } from '@deepseek-ai/dsh-loader-smoke'

const companionSource = fileURLToPath(new URL('../../../../apps/cli/src/vscode-companion.ts', import.meta.url))
const companionBuilt = fileURLToPath(new URL('../../../../apps/cli/lib/vscode-companion.js', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const replayPackageRoot = fileURLToPath(new URL('../../../../packages/test-support/llm-replay', import.meta.url))
const STARTUP_TIMEOUT_MS = 30_000
const SHUTDOWN_TIMEOUT_MS = 10_000

/** Options for one isolated real companion launch. */
export interface VsCodeIpcLaunchOptions {
  /** Selected workspace passed to the shipped companion entry. */
  workspaceRoot: string
  /** Isolated Harness home that owns profile patches, sessions, and the lease. */
  dshHome: string
  /** Snapshot overlay copied into the home-level profile patch. */
  patchFile: string | URL
  /** Recorded JSONL consumed by the replay model. */
  fixtureFile: string | URL
}

/** A startup failure reported through the carrier before the Client API exists. */
export class VsCodeIpcStartupError extends Error {
  /** @param code - stable companion startup code. */
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`)
  }
}

/** Running companion, decoded ready frame, real API client, and physical-record evidence. */
export interface LaunchedVsCodeIpc {
  /** Companion handshake with the assembled Client graph and bundle records. */
  readonly ready: ControlReadyFrame
  /** Existing ApiProxy client carried over the child IPC channel. */
  readonly api: VsCodeApiClient
  /** Physical records sent by the test client, including fragmented requests. */
  readonly outboundRecords: readonly VsCodeWireRecord[]
  /** Physical records received from the companion. */
  readonly inboundRecords: readonly VsCodeWireRecord[]
  /** Captured companion diagnostics. */
  stderr(): string
  /** Gracefully shut down the gateway and prove process exit. */
  close(): Promise<void>
}

function pathOf(value: string | URL): string {
  return value instanceof URL ? fileURLToPath(value) : value
}

/** Expose the test-only replay provider to the isolated installed profile. */
async function stageLibReplayPackage(dshHome: string): Promise<void> {
  if (resolveExampleMode() !== 'lib') return
  const scopeDir = join(dshHome, 'profiles', 'vscode', 'node_modules', '@deepseek-ai')
  await mkdir(scopeDir, { recursive: true })
  const replayLink = join(scopeDir, 'dsh-llm-replay')
  if (existsSync(replayLink)) return
  await symlink(
    replayPackageRoot,
    replayLink,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
}

function timeout(milliseconds: number, message: string): { promise: Promise<never>; cancel(): void } {
  let handle: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(() => { reject(new Error(message)) }, milliseconds)
  })
  return { promise, cancel: () => { if (handle !== undefined) clearTimeout(handle) } }
}

function sendRecord(child: ChildProcess, record: VsCodeWireRecord): Promise<void> {
  if (!child.connected) return Promise.reject(new Error('VS Code companion IPC channel is disconnected'))
  return new Promise((resolve, reject) => {
    child.send(record, (error) => {
      if (error === null) resolve()
      else reject(error)
    })
  })
}

class ChildBridge implements VsCodeBridgePort {
  private readonly listeners = new Set<(value: unknown) => void>()
  private readonly onMessage = (value: unknown): void => {
    const record = vsCodeWireRecordSchema.parse(value)
    this.inbound.push(record)
    for (const listener of [...this.listeners]) listener(record)
  }

  constructor(
    private readonly child: ChildProcess,
    readonly maxLogicalRpcBytes: number,
    private readonly outbound: VsCodeWireRecord[],
    private readonly inbound: VsCodeWireRecord[],
  ) {
    child.on('message', this.onMessage)
  }

  /** Send and retain one parsed physical record. */
  async send(record: VsCodeWireRecord): Promise<void> {
    const parsed = vsCodeWireRecordSchema.parse(record)
    this.outbound.push(parsed)
    await sendRecord(this.child, parsed)
  }

  /** Subscribe to companion physical records. */
  subscribe(listener: (value: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Release all driver-side listeners. */
  dispose(): void {
    this.child.off('message', this.onMessage)
    this.listeners.clear()
  }
}

async function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode }
  }
  return new Promise(resolve => child.once('exit', (code, signal) => { resolve({ code, signal }) }))
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  await waitForExit(child)
}

/**
 * Boot the shipped vscode profile through the real companion entry and complete its handshake.
 * @param options - isolated workspace, home, replay patch, and replay fixture.
 * @returns running carrier and API client.
 */
export async function launchVsCodeIpc(options: VsCodeIpcLaunchOptions): Promise<LaunchedVsCodeIpc> {
  await mkdir(options.dshHome, { recursive: true })
  await stageLibReplayPackage(options.dshHome)
  const homePatch = join(options.dshHome, 'cordis.patch.yml')
  if (!existsSync(homePatch)) await copyFile(options.patchFile, homePatch)
  const launch = resolveExampleLaunch({
    srcBin: companionSource,
    libBin: companionBuilt,
    configArgs: ['--workspace-root', options.workspaceRoot],
    tsconfigPath: repoTsconfig,
    env: {
      DSH_HOME: options.dshHome,
      DSH_AGENTS_HOME: join(options.dshHome, 'agents'),
      DSH_SNAPSHOT_FILE: pathOf(options.fixtureFile),
      DSH_PERMISSION_MODE: 'danger-full-access',
      DSH_TELEMETRY_DISABLED: '1',
    },
  })
  const child = spawn(launch.command, launch.args, {
    cwd: options.workspaceRoot,
    env: { ...process.env, ...launch.env },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const stderr: string[] = []
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => { stderr.push(chunk) })
  const outboundRecords: VsCodeWireRecord[] = []
  const inboundRecords: VsCodeWireRecord[] = []
  const decoder = new VsCodeWireDecoder()
  const ready = Promise.withResolvers<ControlReadyFrame>()
  let inboundTail = Promise.resolve()
  const onMessage = (value: unknown): void => {
    let record: VsCodeWireRecord
    try {
      record = vsCodeWireRecordSchema.parse(value)
      inboundRecords.push(record)
    } catch (error) {
      ready.reject(error)
      return
    }
    const operation = inboundTail.then(async () => {
      const frame = await decoder.accept(record)
      if (frame === undefined) return
      if (frame.type === 'control/ready') {
        ready.resolve(frame)
        return
      }
      if (frame.type === 'control/error') {
        ready.reject(new VsCodeIpcStartupError(frame.code, frame.message))
        return
      }
      ready.reject(new Error(`VS Code companion sent ${frame.type} before ready`))
    })
    inboundTail = operation.catch((error: unknown) => { ready.reject(error) })
  }
  child.on('message', onMessage)
  child.once('error', (error) => { ready.reject(error) })
  child.once('exit', (code, signal) => {
    ready.reject(new Error(
      `VS Code companion exited before ready (code ${String(code)}, signal ${String(signal)}): ${stderr.join('')}`,
    ))
  })
  const startupDeadline = timeout(STARTUP_TIMEOUT_MS, 'VS Code companion handshake timed out')
  try {
    await sendVsCodeFrame({
      type: 'control/hello',
      protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
      extensionVersion: 'snapshot-test',
      workspaceRoot: options.workspaceRoot,
      locale: 'en',
    }, async (record) => {
      outboundRecords.push(record)
      await sendRecord(child, record)
    })
    const handshake = await Promise.race([ready.promise, startupDeadline.promise])
    startupDeadline.cancel()
    child.off('message', onMessage)
    decoder.dispose()
    const bridge = new ChildBridge(
      child,
      handshake.maxLogicalRpcBytes,
      outboundRecords,
      inboundRecords,
    )
    const api = new VsCodeApiClient(bridge)
    let closed = false
    return {
      ready: handshake,
      api,
      outboundRecords,
      inboundRecords,
      stderr: () => stderr.join(''),
      async close(): Promise<void> {
        if (closed) return
        closed = true
        api.dispose()
        const shutdownDecoder = new VsCodeWireDecoder({ maxLogicalRpcBytes: handshake.maxLogicalRpcBytes })
        const completed = Promise.withResolvers<undefined>()
        const onShutdownMessage = (value: unknown): void => {
          const operation = shutdownDecoder.accept(value).then((frame) => {
            if (frame?.type === 'control/shutdown-complete') completed.resolve(undefined)
          })
          void operation.catch((error: unknown) => { completed.reject(error) })
        }
        child.on('message', onShutdownMessage)
        const shutdownDeadline = timeout(SHUTDOWN_TIMEOUT_MS, 'VS Code companion shutdown timed out')
        try {
          await sendVsCodeFrame({ type: 'control/shutdown' }, record => bridge.send(record), {
            maxLogicalRpcBytes: handshake.maxLogicalRpcBytes,
          })
          await Promise.race([completed.promise, shutdownDeadline.promise])
          const exitDeadline = timeout(SHUTDOWN_TIMEOUT_MS, 'VS Code companion did not exit after shutdown')
          const result = await Promise.race([waitForExit(child), exitDeadline.promise])
          exitDeadline.cancel()
          if (result.code !== 0) {
            throw new Error(
              `VS Code companion exited ${String(result.code)} (${String(result.signal)}): ${stderr.join('')}`,
            )
          }
        } finally {
          shutdownDeadline.cancel()
          shutdownDecoder.dispose()
          child.off('message', onShutdownMessage)
          bridge.dispose()
          await terminate(child)
        }
      },
    }
  } catch (error) {
    startupDeadline.cancel()
    child.off('message', onMessage)
    decoder.dispose()
    await terminate(child)
    throw error
  }
}
