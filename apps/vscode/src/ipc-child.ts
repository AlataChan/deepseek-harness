/** Shell-free Node fork adapter for one verified Harness companion. */

import { fork as nodeFork, type ChildProcess, type ForkOptions } from 'node:child_process'
import type { VsCodeWireRecord } from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import type { ResolvedInstalledRuntime } from './runtime-resolver.ts'

/** Child lifecycle and physical-record port consumed by {@link RuntimeManager}. */
export interface RuntimeChild {
  /** Whether Node's IPC channel remains connected. */
  readonly connected: boolean
  /** Send one validated physical record with callback backpressure. */
  send(record: VsCodeWireRecord): Promise<void>
  /** Subscribe to untrusted values received from the companion. */
  subscribe(listener: (value: unknown) => void): () => void
  /** Subscribe to child exit. */
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void
  /** Terminate a child that missed its graceful shutdown deadline. */
  forceKill(): void
  /** Release adapter listeners and disconnect the parent IPC side. */
  dispose(): void
}

/** Injectable process launch and redacted output ports. */
export interface IpcChildPorts {
  /** Node's shell-free fork primitive. */
  fork?: (modulePath: string, args: string[], options: ForkOptions) => ChildProcess
  /** Redacted stdout line sink. */
  onStdout?: (chunk: string) => void
  /** Redacted stderr line sink. */
  onStderr?: (chunk: string) => void
}

class NodeRuntimeChild implements RuntimeChild {
  private readonly disposers: (() => void)[] = []
  private disposed = false

  /** @returns whether the child IPC channel remains connected. */
  get connected(): boolean { return this.child.connected }

  constructor(private readonly child: ChildProcess, ports: IpcChildPorts) {
    const stdout = (chunk: Buffer | string): void => { ports.onStdout?.(String(chunk)) }
    const stderr = (chunk: Buffer | string): void => { ports.onStderr?.(String(chunk)) }
    child.stdout?.on('data', stdout)
    child.stderr?.on('data', stderr)
    this.disposers.push(() => { child.stdout?.off('data', stdout) })
    this.disposers.push(() => { child.stderr?.off('data', stderr) })
  }

  /** @inheritdoc */
  send(record: VsCodeWireRecord): Promise<void> {
    if (!this.child.connected) {
      return Promise.reject(new Error('Harness companion IPC channel is disconnected'))
    }
    return new Promise((resolve, reject) => {
      this.child.send(record, (error) => {
        if (error === null) resolve()
        else reject(error)
      })
    })
  }

  /** @inheritdoc */
  subscribe(listener: (value: unknown) => void): () => void {
    const onMessage = (value: unknown): void => { listener(value) }
    this.child.on('message', onMessage)
    let active = true
    const dispose = (): void => {
      if (!active) return
      active = false
      this.child.off('message', onMessage)
    }
    this.disposers.push(dispose)
    return dispose
  }

  /** @inheritdoc */
  onExit(listener: (code: number | null, signal: NodeJS.Signals | null) => void): () => void {
    this.child.on('exit', listener)
    let active = true
    const dispose = (): void => {
      if (!active) return
      active = false
      this.child.off('exit', listener)
    }
    this.disposers.push(dispose)
    return dispose
  }

  /** @inheritdoc */
  forceKill(): void { this.child.kill('SIGKILL') }

  /** @inheritdoc */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const dispose of this.disposers.splice(0)) dispose()
    if (this.child.connected) this.child.disconnect()
  }
}

/**
 * Fork the manifest-declared JavaScript companion with a separately resolved Node binary.
 * @param runtime - verified package and executable paths.
 * @param workspaceRoot - selected absolute root passed as separated argv.
 * @param ports - injectable fork and redacted output sinks.
 * @returns the child physical-record adapter.
 */
export function launchIpcChild(
  runtime: ResolvedInstalledRuntime,
  workspaceRoot: string,
  ports: IpcChildPorts = {},
): RuntimeChild {
  const child = (ports.fork ?? nodeFork)(
    runtime.companionEntry,
    ['--workspace-root', workspaceRoot],
    {
      cwd: workspaceRoot,
      execPath: runtime.nodePath,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  )
  return new NodeRuntimeChild(child, ports)
}
