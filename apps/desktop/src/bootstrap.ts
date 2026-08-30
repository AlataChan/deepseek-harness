/** Desktop WebView hello owner, bundle cache driver, and Client tree boot. */

import type { ClientTransportHooks } from '@deepseek-ai/dsh-client-connection/client'
import {
  ProcessTransport,
  type ProcessBridgePort,
} from '@deepseek-ai/dsh-client-connection-process/client'
import {
  sendVsCodeFrame,
  VsCodeWireDecoder,
} from '@deepseek-ai/dsh-client-connection-process/codec'
import {
  VSCODE_CARRIER_PROTOCOL_VERSION,
  type ControlReadyFrame,
  type VsCodeCarrierFrame,
  type VsCodeWireRecord,
} from '@deepseek-ai/dsh-client-connection-process/protocol'
import type {
  ClientBundleRegistration,
  ClientModuleCreateOptions,
  ClientModuleLoaderTarget,
  ClientModuleSystem,
  DshWindow,
  WebBootGraph,
} from '@deepseek-ai/dsh-client-modules/client'

type WebBootBatchPhase = WebBootGraph['batches'][number]['phase']
import { AppWebEntry, type BootSeams } from '@deepseek-ai/dsh-client-web'
import {
  parseCachedBundleState,
  parseCarrierOpenState,
  parseResolvedRuntimeState,
  parseRuntimeConfigFields,
  type DesktopDownlinkEvent,
  type DesktopShellPort,
} from './harness-port.ts'
import { renderHome } from './home.ts'
import { attachSettingsButton, renderSettings, type RuntimeConfigFields } from './settings.ts'
import './desktop.css'

const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules'

let bootstrapStarted = false
let carrierOpened = false
let transport: ProcessTransport | undefined

interface ResolvedRuntimeState {
  nodePath: string
  packageRoot: string
  companionEntry: string
  runtimeVersion: string
  discoveryPath: string
}

/** Outcome of {@link bootDesktopClient}. */
export type DesktopBootResult =
  | { status: 'home'; reason: string }
  | { status: 'ready'; ready: ControlReadyFrame; generationId: string }

/** Injectable seams for tests. */
export interface BootDesktopOptions {
  /** Tauri or harness command port. */
  port: DesktopShellPort
  /** Application mount point. */
  root: HTMLElement
  /** `control/hello.extensionVersion` (the Tauri application version). */
  extensionVersion: string
  /** Hello locale. */
  locale?: string
  /** Handshake deadline. */
  handshakeTimeoutMs?: number
  /**
   * Construct the Client tree. Tests inject a spy; the product uses {@link AppWebEntry}.
   * @param root - mount point.
   * @param seams - loadBundle replacement.
   */
  createAppEntry?: (root: HTMLElement, seams: BootSeams) => { run(): Promise<void> }
  /**
   * Load one rewritten bundle URL.
   * @param url - cache `convertFileSrc` URL.
   */
  loadBundle?: (url: string) => Promise<void>
}

/**
 * Reset one-shot flags. Product code must reload the document instead.
 */
export function resetDesktopBootstrapForTests(): void {
  bootstrapStarted = false
  carrierOpened = false
  transport?.dispose()
  transport = undefined
  const win = globalThis as DshWindow & { __DSH_TRANSPORT__?: ClientTransportHooks }
  delete win.__ModuleLoader__
  delete win.__DSH_BOOT__
  delete win.__DSH_TRANSPORT__
}

function installModuleLoaderQueue(): void {
  const win = globalThis as DshWindow
  if (win.__ModuleLoader__ !== undefined) {
    throw new Error('desktop bootstrap: window.__ModuleLoader__ is already installed; reload the WebView')
  }
  const pendingQueue: ClientBundleRegistration[] = []
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue,
    load(registration) { pendingQueue.push(registration) },
    create(options) {
      if (target.mode !== 'queue') {
        throw new Error('client-modules: window.__ModuleLoader__.create called after module-system boot')
      }
      const index = pendingQueue.findIndex(registration => registration.id === CLIENT_MODULES_ID)
      const registration = pendingQueue[index]
      if (registration === undefined) {
        throw new Error(`client-modules: HTML did not preload ${CLIENT_MODULES_ID}/client.js`)
      }
      pendingQueue.splice(index, 1)
      const exports = registration.factory((specifier) => {
        throw new Error(
          `client-modules: ${CLIENT_MODULES_ID}/client.js requested external "${specifier}" before the module system existed`,
        )
      })
      const create = (exports as {
        createClientModuleSystem?: (
          next: ClientModuleLoaderTarget,
          loaded: { id: string; exports: Record<string, unknown> },
          createOptions: ClientModuleCreateOptions,
        ) => ClientModuleSystem
        apply?: unknown
      }).createClientModuleSystem
      if (typeof create !== 'function' || typeof (exports as { apply?: unknown }).apply !== 'function') {
        throw new Error(`client-modules: ${CLIENT_MODULES_ID}/client.js did not export the bootstrap module face`)
      }
      return create(target, { id: registration.id, exports }, options)
    },
  }
  win.__ModuleLoader__ = target
}

function installBootGraph(graph: WebBootGraph): void {
  ;(globalThis as DshWindow).__DSH_BOOT__ = graph
}

function createVerifiedBundleLoader(graph: WebBootGraph): (url: string) => Promise<void> {
  const allowed = new Set([
    ...graph.entries.map(entry => entry.url),
    ...graph.batches.map(batch => batch.url),
  ])
  return async (url: string): Promise<void> => {
    if (!allowed.has(url)) throw new Error(`desktop WebView refused undeclared bundle URL ${url}`)
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.async = true
      script.src = url
      script.addEventListener('load', () => { script.remove(); resolve() }, { once: true })
      script.addEventListener('error', () => {
        script.remove()
        reject(new Error(`desktop WebView bundle ${url} failed to load`))
      }, { once: true })
      document.head.append(script)
    })
  }
}

function rewriteCachedGraph(
  ready: ControlReadyFrame,
  srcById: Map<string, string>,
): WebBootGraph {
  const phaseById = new Map<string, WebBootBatchPhase>()
  for (const batch of ready.graph.batches) {
    for (const id of batch.entries) phaseById.set(id, batch.phase)
  }
  const entries = ready.graph.entries.map((entry) => {
    const url = srcById.get(entry.id)
    if (url === undefined) throw new Error(`ready graph is missing a cached URL for ${entry.id}`)
    return { ...entry, url }
  })
  return {
    rev: ready.graph.rev,
    entries,
    batches: entries.map(entry => ({
      phase: phaseById.get(entry.id) ?? 'application',
      url: entry.url,
      rev: entry.rev,
      entries: [entry.id],
    })),
  }
}

/**
 * Reject after `milliseconds` unless {@link cancel} runs first.
 * @param milliseconds - deadline.
 * @param message - rejection text.
 */
function delayReject(milliseconds: number, message: string): {
  promise: Promise<never>
  cancel(): void
} {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(message)) }, milliseconds)
  })
  return {
    promise,
    cancel() {
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}

function createFrameWaiter(): {
  fail(error: Error): void
  push(frame: VsCodeCarrierFrame): void
  next(): Promise<VsCodeCarrierFrame>
} {
  const pending: VsCodeCarrierFrame[] = []
  const waiters: Array<{
    resolve: (frame: VsCodeCarrierFrame) => void
    reject: (error: Error) => void
  }> = []
  let failure: Error | undefined
  return {
    fail(error) {
      failure = error
      const waiter = waiters.shift()
      if (waiter !== undefined) waiter.reject(error)
    },
    push(frame) {
      const waiter = waiters.shift()
      if (waiter !== undefined) waiter.resolve(frame)
      else pending.push(frame)
    },
    next() {
      if (failure !== undefined) return Promise.reject(failure)
      const frame = pending.shift()
      if (frame !== undefined) return Promise.resolve(frame)
      return new Promise((resolve, reject) => { waiters.push({ resolve, reject }) })
    },
  }
}

function showHome(
  options: BootDesktopOptions,
  config: RuntimeConfigFields,
  reason: string,
): DesktopBootResult {
  const retry = async (): Promise<void> => {
    resetDesktopBootstrapForTests()
    await bootDesktopClient(options)
  }
  const openSettings = (next: RuntimeConfigFields, nextReason: string): void => {
    renderSettings(options.root, {
      port: options.port,
      reason: nextReason,
      config: next,
      onRetry: retry,
    })
  }
  renderHome(options.root, {
    reason,
    onStart: async () => {
      resetDesktopBootstrapForTests()
      const result = await bootDesktopClient(options)
      if (result.status === 'home') {
        const latest = parseRuntimeConfigFields(await options.port.invoke('runtime_get_config'))
        openSettings(latest, result.reason)
      }
    },
    onOpenSettings: () => { openSettings(config, reason) },
  })
  return { status: 'home', reason }
}

/**
 * Resolve the runtime, open one carrier, send hello, cache bundles, and mount the Client.
 * A failed resolve leaves the product home mounted instead of a setup form.
 * @param options - port, mount, and injectable seams.
 * @returns home when resolve is deferred; ready after the Client tree is constructed.
 */
export async function bootDesktopClient(options: BootDesktopOptions): Promise<DesktopBootResult> {
  if (bootstrapStarted) {
    throw new Error('desktop bootstrap is one-shot; reload the WebView to replace the carrier')
  }
  bootstrapStarted = true
  const locale = options.locale ?? 'en'
  let config: RuntimeConfigFields
  try {
    config = parseRuntimeConfigFields(await options.port.invoke('runtime_get_config'))
  } catch (error) {
    return showHome(options, {}, error instanceof Error ? error.message : String(error))
  }
  let resolved: ResolvedRuntimeState
  try {
    resolved = parseResolvedRuntimeState(await options.port.invoke('runtime_resolve'))
  } catch (error) {
    return showHome(options, config, error instanceof Error ? error.message : String(error))
  }
  const workspaceRoot = config.workspaceRoot
  if (workspaceRoot === undefined || workspaceRoot === '') {
    return showHome(options, config, 'workspaceRoot is not configured')
  }
  try {
    return await finishDesktopClient(options, { ...config, workspaceRoot }, resolved, locale)
  } catch (error) {
    return showHome(options, config, error instanceof Error ? error.message : String(error))
  }
}

/**
 * Open the carrier and mount the Client after resolve has already succeeded.
 * @param options - port, mount, and injectable seams.
 * @param config - persisted settings used for hello and Settings.
 * @param resolved - Node and companion paths from `runtime_resolve`.
 * @param locale - hello locale.
 * @returns ready after the Client tree is constructed.
 */
async function finishDesktopClient(
  options: BootDesktopOptions,
  config: RuntimeConfigFields & { workspaceRoot: string },
  resolved: ResolvedRuntimeState,
  locale: string,
): Promise<DesktopBootResult> {
  if (carrierOpened) {
    throw new Error('desktop bootstrap already opened a carrier in this document')
  }

  const decoder = new VsCodeWireDecoder()
  const handshake = createFrameWaiter()
  const recordListeners = new Set<(value: unknown) => void>()
  let handshaking = true
  const downlink = options.port.createChannel((event: DesktopDownlinkEvent) => {
    if (event.event === 'closed') {
      handshake.fail(new Error(event.data.reason))
      return
    }
    if (event.event === 'child-exit') {
      handshake.fail(new Error(`companion exited before ready (code ${String(event.data.code)})`))
      return
    }
    let record: unknown
    try {
      record = JSON.parse(event.data.line)
    } catch (error) {
      handshake.fail(error instanceof Error ? error : new Error(String(error)))
      return
    }
    for (const listener of recordListeners) listener(record)
    if (!handshaking) return
    void decoder.accept(record).then((frame) => {
      if (frame !== undefined) handshake.push(frame)
    }).catch((error: unknown) => {
      handshake.fail(error instanceof Error ? error : new Error(String(error)))
    })
  })
  const opened = parseCarrierOpenState(await options.port.invoke('carrier_open', { downlink }))
  carrierOpened = true

  const sendRecord = async (record: VsCodeWireRecord): Promise<void> => {
    await options.port.invoke('carrier_send', { line: JSON.stringify(record) })
  }
  await sendVsCodeFrame({
    type: 'control/hello',
    protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
    extensionVersion: options.extensionVersion,
    workspaceRoot: config.workspaceRoot,
    locale,
  }, sendRecord)

  const timeout = delayReject(
    options.handshakeTimeoutMs ?? 15_000,
    'desktop companion handshake timed out',
  )
  const ready = await Promise.race([handshake.next(), timeout.promise]).finally(() => {
    timeout.cancel()
  })
  if (ready.type === 'control/error') {
    throw new Error(`${ready.code}: ${ready.message}`)
  }
  if (ready.type !== 'control/ready') {
    throw new Error(`Harness companion sent ${ready.type} before ready`)
  }
  if (ready.protocolVersion !== VSCODE_CARRIER_PROTOCOL_VERSION) {
    throw new Error(
      `Harness carrier protocol mismatch: extension ${String(VSCODE_CARRIER_PROTOCOL_VERSION)}, runtime ${String(ready.protocolVersion)}`,
    )
  }
  if (ready.runtimeVersion !== resolved.runtimeVersion) {
    throw new Error(
      `Harness runtime version mismatch: manifest ${resolved.runtimeVersion}, companion ${ready.runtimeVersion}`,
    )
  }
  handshaking = false
  decoder.dispose()

  const srcById = new Map<string, string>()
  for (const [index, location] of ready.bundles.entries()) {
    const cached = parseCachedBundleState(await options.port.invoke('cache_bundle', {
      sourcePath: location.sourcePath,
      sha256: location.sha256,
      graphRev: ready.graph.rev,
      index,
      id: location.id,
    }))
    srcById.set(location.id, cached.src)
  }
  const graph = rewriteCachedGraph(ready, srcById)
  installModuleLoaderQueue()
  installBootGraph(graph)
  const loadBundle = options.loadBundle ?? createVerifiedBundleLoader(graph)
  const bootstrap = graph.entries.find(entry => entry.id === CLIENT_MODULES_ID)
  if (bootstrap === undefined) throw new Error(`desktop boot graph is missing ${CLIENT_MODULES_ID}`)
  await loadBundle(bootstrap.url)

  const port: ProcessBridgePort = {
    maxLogicalRpcBytes: ready.maxLogicalRpcBytes,
    send: sendRecord,
    subscribe(listener) {
      recordListeners.add(listener)
      return () => { recordListeners.delete(listener) }
    },
  }
  const processTransport = new ProcessTransport(port)
  transport = processTransport
  const hooks: ClientTransportHooks = {
    fetch: (input, init) => processTransport.fetch(input, init),
    openStream: (endpoint, payload, signal) => processTransport.openStream(endpoint, payload, signal),
    loadBundle,
    ownsHost: true,
  }
  ;(globalThis as { __DSH_TRANSPORT__?: ClientTransportHooks }).__DSH_TRANSPORT__ = hooks
  const seams: BootSeams = { loadBundle }
  options.root.replaceChildren()
  const createAppEntry = options.createAppEntry
    ?? ((root, next) => new AppWebEntry(root, next))
  const entry = createAppEntry(options.root, seams)
  await entry.run()
  attachSettingsButton(options.root, { port: options.port, config })
  return { status: 'ready', ready, generationId: opened.generationId }
}
