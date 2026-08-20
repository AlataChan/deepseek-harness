/** Stable extension-owned companion lifecycle with handshake and bounded restart. */

import {
  sendVsCodeFrame,
  VsCodeWireDecoder,
} from '@deepseek-ai/dsh-client-connection-vscode/codec'
import {
  VSCODE_CARRIER_PROTOCOL_VERSION,
  vsCodeCarrierFrameSchema,
  vsCodeWireRecordSchema,
  type ControlReadyFrame,
  type VsCodeWireRecord,
} from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import { launchIpcChild, type RuntimeChild } from './ipc-child.ts'
import {
  resolveInstalledRuntime,
  type ResolvedInstalledRuntime,
} from './runtime-resolver.ts'

export type { RuntimeChild } from './ipc-child.ts'

/** Observable runtime lifecycle states. */
export type RuntimeManagerState = 'idle' | 'starting' | 'ready' | 'restarting' | 'stopping' | 'failed'

/** One selected-root launch request. */
export interface RuntimeStartOptions {
  /** Absolute root also repeated in the versioned handshake. */
  workspaceRoot: string
  /** Normalized VS Code display locale sent to the companion. */
  locale: string
}

/** Injectable resolution, launch, version, and lifecycle limits. */
export interface RuntimeManagerOptions {
  /** Resolve verified direct-fork inputs lazily. */
  resolveRuntime?: () => Promise<ResolvedInstalledRuntime>
  /** Launch one verified child generation. */
  launchChild?: (runtime: ResolvedInstalledRuntime, workspaceRoot: string) => RuntimeChild
  /** Installed extension version sent in `control/hello`. */
  extensionVersion: string
  /** Unexpected-exit restart budget. */
  restartAttempts?: number
  /** Graceful shutdown deadline before SIGKILL. */
  shutdownTimeoutMs?: number
  /** Startup handshake deadline. */
  handshakeTimeoutMs?: number
}

const DEFAULT_RESTART_ATTEMPTS = 2
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 15_000

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer`)
  return value
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
  return value
}

function delayReject(milliseconds: number, message: string): { promise: Promise<never>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(message)) }, milliseconds)
  })
  return { promise, cancel: () => { if (timer !== undefined) clearTimeout(timer) } }
}

function isInlineShutdownComplete(record: VsCodeWireRecord): boolean {
  if (record.type !== 'wire/message') return false
  try {
    const value = JSON.parse(record.encoded) as { type?: unknown }
    return value.type === 'control/shutdown-complete'
      && vsCodeCarrierFrameSchema.safeParse(value).success
  } catch {
    return false
  }
}

/** Startup error preserving a carrier-provided stable code. */
export class RuntimeStartupError extends Error {
  /** @param code - stable companion or extension startup code. */
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`)
  }
}

/**
 * One stable record port across bounded child generations. The manager owns
 * extension/companion handshake frames; subscribers receive only post-ready
 * physical records.
 */
export class RuntimeManager {
  private readonly resolveRuntime: () => Promise<ResolvedInstalledRuntime>
  private readonly launchChild: (runtime: ResolvedInstalledRuntime, workspaceRoot: string) => RuntimeChild
  private readonly extensionVersion: string
  private readonly restartAttempts: number
  private readonly shutdownTimeoutMs: number
  private readonly handshakeTimeoutMs: number
  private readonly stateListeners = new Set<(state: RuntimeManagerState) => void>()
  private readonly recordListeners = new Set<(value: unknown) => void>()
  private current: RuntimeChild | undefined
  private currentDisposers: (() => void)[] = []
  private shutdownComplete: (() => void) | undefined
  private startOptions: RuntimeStartOptions | undefined
  private restartCount = 0
  private generation = 0
  private stopping: Promise<void> | undefined
  private _state: RuntimeManagerState = 'idle'
  private _failureMessage: string | undefined

  /** @returns current lifecycle state. */
  get state(): RuntimeManagerState { return this._state }

  /** @returns most recent startup failure message, or undefined after a successful start. */
  get failureMessage(): string | undefined { return this._failureMessage }

  /** @param options - injectable runtime resolution, launch, version, and limits. */
  constructor(options: RuntimeManagerOptions) {
    this.resolveRuntime = options.resolveRuntime ?? (() => resolveInstalledRuntime())
    this.launchChild = options.launchChild ?? ((runtime, root) => launchIpcChild(runtime, root))
    this.extensionVersion = options.extensionVersion
    this.restartAttempts = nonnegativeInteger(
      options.restartAttempts ?? DEFAULT_RESTART_ATTEMPTS, 'restartAttempts',
    )
    this.shutdownTimeoutMs = positiveInteger(
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS, 'shutdownTimeoutMs',
    )
    this.handshakeTimeoutMs = positiveInteger(
      options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS, 'handshakeTimeoutMs',
    )
  }

  /** Subscribe to lifecycle status changes. */
  subscribeState(listener: (state: RuntimeManagerState) => void): () => void {
    this.stateListeners.add(listener)
    return () => { this.stateListeners.delete(listener) }
  }

  /** Subscribe to companion physical records after the extension handshake. */
  subscribe(listener: (value: unknown) => void): () => void {
    this.recordListeners.add(listener)
    return () => { this.recordListeners.delete(listener) }
  }

  /**
   * Resolve and start the first child generation lazily.
   * @param options - selected workspace and VS Code locale.
   * @returns verified companion ready facts.
   */
  async start(options: RuntimeStartOptions): Promise<ControlReadyFrame> {
    if (this._state !== 'idle' && this._state !== 'failed') {
      throw new Error(`Harness runtime cannot start while ${this._state}`)
    }
    this.startOptions = { ...options }
    this.restartCount = 0
    return this.boot(false)
  }

  /** Send one parsed physical record to the current ready generation. */
  async send(record: VsCodeWireRecord): Promise<void> {
    const parsed = vsCodeWireRecordSchema.parse(record)
    if (this._state !== 'ready' || this.current === undefined) {
      throw new Error('Harness runtime is not ready')
    }
    await this.current.send(parsed)
  }

  /** Stop the current generation gracefully, then force it at the deadline. */
  stop(): Promise<void> {
    if (this.stopping !== undefined) return this.stopping
    this.stopping = this.stopCurrent().finally(() => { this.stopping = undefined })
    return this.stopping
  }

  /** Stop and start a fresh generation for the last selected root. */
  async restart(): Promise<ControlReadyFrame> {
    const options = this.startOptions
    if (options === undefined) throw new Error('Harness runtime has no selected workspace')
    await this.stop()
    this.restartCount = 0
    return this.boot(false)
  }

  private publishState(state: RuntimeManagerState): void {
    if (this._state === state) return
    this._state = state
    for (const listener of this.stateListeners) listener(state)
  }

  private async boot(restarting: boolean): Promise<ControlReadyFrame> {
    const options = this.startOptions
    if (options === undefined) throw new Error('Harness runtime has no selected workspace')
    this.publishState(restarting ? 'restarting' : 'starting')
    this._failureMessage = undefined
    const generation = ++this.generation
    let child: RuntimeChild | undefined
    try {
      const runtime = await this.resolveRuntime()
      if (generation !== this.generation) throw new Error('Harness runtime start was superseded')
      child = this.launchChild(runtime, options.workspaceRoot)
      this.current = child
      const ready = await this.handshake(child, runtime, options, generation)
      if (generation !== this.generation) throw new Error('Harness runtime start was superseded')
      this.publishState('ready')
      return ready
    } catch (error) {
      if (child?.connected === true) child.forceKill()
      this.clearCurrent(child)
      if (generation === this.generation && this._state !== 'stopping') {
        this._failureMessage = error instanceof Error ? error.message : String(error)
        this.publishState('failed')
      }
      throw error
    }
  }

  private handshake(
    child: RuntimeChild,
    runtime: ResolvedInstalledRuntime,
    options: RuntimeStartOptions,
    generation: number,
  ): Promise<ControlReadyFrame> {
    const decoder = new VsCodeWireDecoder()
    const ready = Promise.withResolvers<ControlReadyFrame>()
    const exited = Promise.withResolvers<void>()
    let settled = false
    let handshaking = true
    let tail = Promise.resolve()
    const settleFailure = (error: unknown): void => {
      if (settled) return
      settled = true
      ready.reject(error instanceof Error ? error : new Error(String(error)))
    }
    const unsubscribeMessage = child.subscribe((value) => {
      let record: VsCodeWireRecord
      try {
        record = vsCodeWireRecordSchema.parse(value)
      } catch (error) {
        settleFailure(new Error('Harness companion sent an invalid wire record', { cause: error }))
        return
      }
      const operation = tail.then(async () => {
        if (!handshaking) {
          if (isInlineShutdownComplete(record)) this.shutdownComplete?.()
          else for (const listener of this.recordListeners) listener(record)
          return
        }
        const frame = await decoder.accept(record)
        if (frame === undefined) return
        if (frame.type === 'control/error') {
          settleFailure(new RuntimeStartupError(frame.code, frame.message))
          return
        }
        if (frame.type !== 'control/ready') {
          settleFailure(new Error(`Harness companion sent ${frame.type} before ready`))
          return
        }
        if (frame.protocolVersion !== VSCODE_CARRIER_PROTOCOL_VERSION) {
          settleFailure(new Error(
            `Harness carrier protocol mismatch: extension ${String(VSCODE_CARRIER_PROTOCOL_VERSION)}, runtime ${String(frame.protocolVersion)}`,
          ))
          return
        }
        if (frame.runtimeVersion !== runtime.runtimeVersion) {
          settleFailure(new Error(
            `Harness runtime version mismatch: manifest ${runtime.runtimeVersion}, companion ${frame.runtimeVersion}`,
          ))
          return
        }
        handshaking = false
        decoder.dispose()
        settled = true
        ready.resolve(frame)
      })
      tail = operation.catch((error: unknown) => { settleFailure(error) })
    })
    const unsubscribeExit = child.onExit((code, signal) => {
      exited.resolve()
      if (handshaking) {
        settleFailure(new Error(
          `Harness companion exited before ready (code ${String(code)}, signal ${String(signal)})`,
        ))
        return
      }
      if (generation === this.generation && this._state !== 'stopping') {
        void this.handleUnexpectedExit(generation)
      }
    })
    this.currentDisposers = [unsubscribeMessage, unsubscribeExit, () => { decoder.dispose() }]
    const timeout = delayReject(this.handshakeTimeoutMs, 'Harness companion handshake timed out')
    void sendVsCodeFrame({
      type: 'control/hello',
      protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
      extensionVersion: this.extensionVersion,
      workspaceRoot: options.workspaceRoot,
      locale: options.locale,
    }, record => child.send(record)).catch(settleFailure)
    return Promise.race([ready.promise, timeout.promise]).finally(() => {
      timeout.cancel()
      void exited.promise.catch(() => {})
    })
  }

  private async handleUnexpectedExit(generation: number): Promise<void> {
    if (generation !== this.generation) return
    this.clearCurrent(this.current)
    if (this.restartCount >= this.restartAttempts) {
      this.publishState('failed')
      return
    }
    this.restartCount++
    try {
      await this.boot(true)
    } catch {
      if (this.restartCount >= this.restartAttempts) {
        this.publishState('failed')
        return
      }
      await this.handleUnexpectedExit(this.generation)
    }
  }

  private async stopCurrent(): Promise<void> {
    ++this.generation
    const child = this.current
    if (child === undefined) {
      this.publishState('idle')
      return
    }
    this.publishState('stopping')
    const completed = Promise.withResolvers<void>()
    this.shutdownComplete = completed.resolve
    const exited = Promise.withResolvers<void>()
    const unsubscribeExit = child.onExit(() => { exited.resolve() })
    const forceAndWait = async (): Promise<void> => {
      child.forceKill()
      await exited.promise
    }
    try {
      if (child.connected) {
        try {
          await sendVsCodeFrame({ type: 'control/shutdown' }, record => child.send(record))
        } catch {
          // A failed IPC send leaves no graceful path; forced exit is the complete shutdown result.
          await forceAndWait()
          return
        }
        const timeout = delayReject(this.shutdownTimeoutMs, 'Harness companion shutdown timed out')
        try {
          await Promise.race([completed.promise, exited.promise, timeout.promise])
        } catch {
          await forceAndWait()
        } finally {
          timeout.cancel()
        }
      }
    } finally {
      unsubscribeExit()
      this.shutdownComplete = undefined
      this.clearCurrent(child)
      this.publishState('idle')
    }
  }

  private clearCurrent(child: RuntimeChild | undefined): void {
    if (child === undefined || this.current !== child) return
    for (const dispose of this.currentDisposers.splice(0)) dispose()
    child.dispose()
    this.current = undefined
  }
}
