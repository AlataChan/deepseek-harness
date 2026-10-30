/** Single-user desktop composition of the durable IM delivery services. */
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { DingTalkTransport, type DingTalkTransportDependencies } from '@deepseek-ai/dsh-experimental-im-dingtalk'
import { IngressStorage, ingressDomainSpec, TenantReceiptStorage, tenantReceiptDomainSpec } from './storage.ts'
import { IngressService, type IngressConfig, type TenantIpcClientProvider } from './ingress.ts'
import { TenantRuntimeService } from './runtime-service.ts'
import { createTenantAgentSessionProvider } from './session-provider.ts'
import { DesktopImLease } from './desktop-lease.ts'
export { DesktopImLease } from './desktop-lease.ts'
export type { FeishuEventDispatcherLike } from './feishu-transport.ts'
import { FeishuTransport, type FeishuTransportDependencies } from './feishu-transport.ts'
import { FeishuReplySender, DingTalkReplySender } from './reply-senders.ts'
import { parseOperatorId, parseTargetTenantId } from './types.ts'
import type { IncomingImMessage } from './types.ts'

/** Fixed desktop operator identity; remote messages cannot select execution settings. */
export interface DesktopImRuntimeConfig {
  provider: 'feishu' | 'dingtalk'
  appId: string
  appSecret: string
  tenantId: string
  chatId: string
  senderId: string
  cwd: string
  modelSelection: { provider: string; model: string }
  stateDirectory: string
  dispatchIntervalMs: number
  shutdownTimeoutMs: number
  ingress: IngressConfig
  maxReconciliationEvents: number
}

/** Resource owner returned before platform connection starts. */
export interface DesktopImRuntime {
  /** Authenticate and connect; returns only after the channel verifies readiness. */
  start(): Promise<void>
  /** Read live transport connectivity, including SDK reconnection. */
  isConnected(): boolean
  /** Report retained failed or uncertain work requiring local operator attention. */
  hasDeliveryFailure(): boolean
  /** Close admission, cancel owned Agents and release storage after quiescence. */
  close(): Promise<void>
}

/** Channel test dependencies; production leaves both absent. */
export interface DesktopImTransportDependencies {
  feishu?: FeishuTransportDependencies
  dingtalk?: DingTalkTransportDependencies
}

/**
 * Compose one desktop-user connection, with exact operator authorization and durable replay protection.
 * @param ctx - Desktop Host with Agents, persistence and storage.
 * @param config - Locally selected execution settings and credential.
 * @param onFailure - Receives a redacted operational failure notification.
 * @param dependencies - Owner-local platform fixtures; omitted in production.
 * @returns Owned resources, including cleanup for a failed start.
 */
export async function createDesktopImRuntime(ctx: Context, config: DesktopImRuntimeConfig,
  onFailure: () => void, dependencies: DesktopImTransportDependencies = {}): Promise<DesktopImRuntime> {
  await mkdir(config.stateDirectory, { recursive: true, mode: 0o700 })
  const lease = DesktopImLease.acquire(config.stateDirectory)
  let sqlite: SqliteStorageBackend | undefined
  let facility: DomainFacility | undefined
  let unregister: (() => void) | undefined
  let ingress: IngressService | undefined
  let runtime: TenantRuntimeService | undefined
  let agentProvider: Awaited<ReturnType<typeof createTenantAgentSessionProvider>> | undefined
  let transport: FeishuTransport | DingTalkTransport | undefined
  let pump: Promise<void> | undefined
  const lifetime = new AbortController()
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (closing) return closing
    lifetime.abort()
    closing = (async () => {
      const results = await Promise.allSettled([
        transport?.close(), ingress?.close(), runtime?.handleClientDisconnected(), pump,
      ])
      const failed = results.find(result => result.status === 'rejected')
      // Retain database ownership if delivery work could still be writing.
      if (failed?.status === 'rejected') throw new Error('Desktop IM did not become quiescent', { cause: failed.reason })
      await agentProvider?.dispose()
      await facility?.closeAll()
      await sqlite?.close()
      unregister?.()
      lease.release()
    })()
    return closing
  }
  try {
    sqlite = new SqliteStorageBackend({ path: join(config.stateDirectory, 'delivery.sqlite'), journalMode: 'wal' })
    const backend = `sqlite:desktop-im:${config.provider}`
    unregister = ctx.storage.backend.register(backend, sqlite)
    facility = new DomainFacility(ctx, { backend, routes: {} })
    const inbox = new IngressStorage(await facility.open(ingressDomainSpec))
    const receipts = new TenantReceiptStorage(await facility.open(tenantReceiptDomainSpec))
    agentProvider = await createTenantAgentSessionProvider(ctx, facility, {
      cwd: config.cwd, modelSelection: config.modelSelection, maxReconciliationEvents: config.maxReconciliationEvents,
    })
    const tenantId = parseTargetTenantId(`desktop-${config.provider}`)
    const operatorId = parseOperatorId('desktop-operator')
    const ownedRuntime = new TenantRuntimeService({ tenantId, operatorIds: [operatorId],
      shutdownTimeoutMs: config.shutdownTimeoutMs, maxActiveDeliveries: 1 }, receipts, agentProvider)
    runtime = ownedRuntime
    const clientProvider: TenantIpcClientProvider = {
      getClient(target) {
        if (target !== tenantId) throw new Error('Foreign desktop IM runtime')
        return Promise.resolve({
          submitDelivery: params => ownedRuntime.handleSubmitDelivery({ ...params, id: randomUUID(), type: 'submit_delivery' }),
          getDelivery: (deliveryKey, sessionId) => ownedRuntime.handleGetDelivery({ id: randomUUID(), type: 'get_delivery', deliveryKey, sessionId }),
          cancelDelivery: deliveryKey => ownedRuntime.handleCancelDelivery({ id: randomUUID(), type: 'cancel_delivery', deliveryKey }),
        })
      },
    }
    const identity = [config.provider, config.appId, config.tenantId, config.chatId, config.senderId]
    for (const previous of inbox.listBindings()) {
      if (previous.bindingKey !== JSON.stringify(identity) && previous.revokedAt === null) await inbox.revokeBinding(previous.bindingKey)
    }
    await inbox.putBinding({ bindingKey: JSON.stringify(identity), operatorId, targetTenantId: tenantId,
      provider: config.provider, appId: config.appId, tenantId: config.tenantId, chatId: config.chatId,
      senderId: config.senderId, authorizedAt: new Date().toISOString(), revokedAt: null })
    const acceptor = { handleIncomingMessage: (event: IncomingImMessage) => {
      if (lifetime.signal.aborted || !ingress) return Promise.reject(new Error('Desktop IM is closed'))
      return ingress.handleIncomingMessage(event)
    } }
    if (config.provider === 'feishu') {
      const channel = new FeishuTransport({ appId: config.appId, appSecret: config.appSecret }, acceptor, undefined, dependencies.feishu)
      transport = channel
      ingress = new IngressService(config.ingress, inbox,
        clientProvider, new FeishuReplySender(channel))
    } else {
      const channel = new DingTalkTransport({ clientId: config.appId, clientSecret: config.appSecret,
        expectedCorpId: config.tenantId }, acceptor, dependencies.dingtalk)
      transport = channel
      ingress = new IngressService(config.ingress, inbox,
        clientProvider, new DingTalkReplySender(channel))
    }
    const ownedTransport = transport
    const ownedIngress = ingress
    return { close, isConnected: () => !lifetime.signal.aborted && ownedTransport.isConnected(),
      hasDeliveryFailure: () => inbox.listDeliveries().some(record =>
        record.status === 'failed' || record.status === 'unknown' || record.outboxStatus === 'failed' || record.outboxStatus === 'unknown'),
      async start() {
        lifetime.signal.throwIfAborted()
        await ownedTransport.start()
        lifetime.signal.throwIfAborted()
        pump = (async () => {
          while (!lifetime.signal.aborted) {
            await ownedIngress.dispatchPending()
            await delay(config.dispatchIntervalMs, undefined, { signal: lifetime.signal })
          }
        })().catch((error: unknown) => {
          if (!lifetime.signal.aborted) { lifetime.abort(error); onFailure() }
        })
        // The owner observes failures through its status and awaits the pump at close.
        void pump.catch(() => undefined)
      } }
  } catch (error) {
    try { await close() } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Desktop IM startup cleanup failed') }
    throw error
  }
}

/**
 * Connect only the official channel transport; incoming events are definitively rejected.
 * @param provider - Platform being configured.
 * @param appId - Application identifier.
 * @param appSecret - Credential resolved by the Host.
 * @param tenantId - Organization used by DingTalk's event filter.
 * @returns Probe resources that must be closed after start, including on failure.
 */
export function createDesktopImProbe(provider: 'feishu' | 'dingtalk', appId: string, appSecret: string,
  tenantId: string): DesktopImRuntime {
  const reject = { handleIncomingMessage: () => Promise.reject(new Error('Connection test does not admit messages')) }
  const transport = provider === 'feishu'
    ? new FeishuTransport({ appId, appSecret }, reject)
    : new DingTalkTransport({ clientId: appId, clientSecret: appSecret, expectedCorpId: tenantId }, reject)
  return { start: () => transport.start(), close: () => transport.close(),
    isConnected: () => transport.isConnected(), hasDeliveryFailure: () => false }
}
