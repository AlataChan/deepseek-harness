/** Tool-free IM ingress process: durable admission, authenticated tenant IPC and platform replies. */
import { realpathSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cmdline'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { DingTalkTransport, dingTalkTransportConfigSchema,
  type DingTalkTransportDependencies } from '@deepseek-ai/dsh-experimental-im-dingtalk'
import { IngressStorage, ingressDomainSpec, operatorBindingSchema } from './storage.ts'
import { IngressService, type TenantIpcClientProvider, type ImReplySender } from './ingress.ts'
import { TenantIpcClient } from './ipc.ts'
import { ImWriterLease } from './writer-lease.ts'
import { FeishuTransport, feishuTransportConfigSchema, type FeishuTransportDependencies } from './feishu-transport.ts'
import { FeishuReplySender, DingTalkReplySender } from './reply-senders.ts'
import type { IngressDurableAcceptor, TargetTenantId } from './types.ts'
import { InteractionIngress, interactionIngressConfigSchema, publishedInteractionDomain } from './interaction-ingress.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { imIngress: IngressService }
}

export const name = 'im-ingress'
export const inject = ['storage']

/** Feishu transport settings resolved by the platform owner, with explicit channel selection. */
export const feishuChannelConfigSchema = feishuTransportConfigSchema.extend({ kind: z.literal('feishu') }).strict()
/** DingTalk transport settings resolved by the platform owner, with explicit channel selection. */
export const dingTalkChannelConfigSchema = dingTalkTransportConfigSchema.extend({ kind: z.literal('dingtalk') }).strict()
/** Supported production channels; each has a concrete current consumer. */
export const imChannelConfigSchema = z.discriminatedUnion('kind', [feishuChannelConfigSchema, dingTalkChannelConfigSchema])
/** Resolved platform selection and limits. */
export type ImChannelConfig = z.output<typeof imChannelConfigSchema>

/** Fixed tenant endpoint identity and deployment-resolved transport limits. */
export const tenantConnectionConfigSchema = z.object({
  socketPath: z.string().min(1), systemdSocketRoot: z.string().min(1).optional(),
  trustedUid: z.number().int().nonnegative().optional(), trustedGid: z.number().int().nonnegative().optional(),
  workspaceId: z.string().min(1).optional(),
  connectTimeoutMs: z.number().int().positive().default(5000),
  handshakeTimeoutMs: z.number().int().positive().default(5000),
  requestTimeoutMs: z.number().int().positive().default(30000),
  maxPendingRequests: z.number().int().positive().default(128),
  maxFrameBytes: z.number().int().positive().default(1048576),
}).strict()
/** Resolved endpoint configuration; tests must explicitly supply their local client factory. */
export type TenantConnectionConfig = z.output<typeof tenantConnectionConfigSchema>
/** Explicit ingress process identity, channel, retained-work limits and shutdown deadline. */
export const ingressPluginConfigSchema = z.object({
  ingressId: z.string().min(1).default('im-ingress'), stateDirectory: z.string().min(1),
  tenants: z.record(z.string().min(1), tenantConnectionConfigSchema), channel: imChannelConfigSchema.optional(),
  operatorBindings: z.array(operatorBindingSchema).optional(),
  interactions: interactionIngressConfigSchema.optional(),
  maxStoredDeliveries: z.number().int().positive().default(10000),
  maxPendingAdmissions: z.number().int().positive().default(128),
  maxPromptBytes: z.number().int().positive().default(65536), maxReplyBytes: z.number().int().positive().default(65536),
  maxEventAgeMs: z.number().int().positive().default(300000), maxFutureSkewMs: z.number().int().nonnegative().default(60000),
  maxOutboxAttempts: z.number().int().positive().default(5),
  dispatchIntervalMs: z.number().int().nonnegative().default(1000),
  shutdownTimeoutMs: z.number().int().positive().max(2147483647).default(15000),
}).strict()
/** Raw plugin settings before explicit default resolution. */
export type IngressPluginRawConfig = z.input<typeof ingressPluginConfigSchema>
/** Validated deployment settings. */
export type IngressPluginConfig = z.output<typeof ingressPluginConfigSchema>
/**
 * Explicit test-only endpoint adapter.
 * @param targetTenantId - Administrator-selected tenant identity.
 * @param config - Resolved endpoint settings.
 * @returns A real client owned by this ingress lifetime.
 */
export type TenantIpcClientFactory = (targetTenantId: string, config: TenantConnectionConfig) => TenantIpcClient
/** Direct owner tests may inject transport dependencies; production never falls back to logging replies. */
export interface IngressPluginDependencies {
  readonly replySender?: ImReplySender | undefined
  readonly clientFactory?: TenantIpcClientFactory | undefined
  readonly feishu?: FeishuTransportDependencies | undefined
  readonly dingtalk?: DingTalkTransportDependencies | undefined
}

/**
 * Mount an ingress process with one writer lease and one owned cleanup operation.
 * @param ctx - Tool-free Cordis context; production requires the launcher's exit and readiness services.
 * @param rawConfig - Raw deployment settings, resolved once before opening storage.
 * @param depsOrSender - Explicit owner-test dependencies or reply sender.
 */
export async function apply(ctx: Context, rawConfig: IngressPluginRawConfig,
  depsOrSender?: ImReplySender | IngressPluginDependencies): Promise<void> {
  const config = ingressPluginConfigSchema.parse(rawConfig)
  const deps: IngressPluginDependencies = depsOrSender && 'sendReply' in depsOrSender
    ? { replySender: depsOrSender } : (depsOrSender ?? {})
  if (config.interactions && config.channel?.kind !== 'feishu') throw new Error('Interactive cards require the Feishu channel')
  if (!config.channel && !deps.replySender) throw new Error('Ingress requires an explicit channel or owner-test reply sender')
  if (config.channel && config.dispatchIntervalMs === 0) throw new Error('Production channel requires a positive dispatch interval')
  const appExit = ctx.get('appExit')
  const appReady = ctx.get('appReady')
  if ((config.channel || config.dispatchIntervalMs > 0) && (!appExit || !appReady)) {
    throw new Error('IM ingress requires launcher appExit and appReady services')
  }
  for (const endpoint of Object.values(config.tenants)) {
    if (deps.clientFactory) continue
    if (endpoint.trustedUid !== 0 || endpoint.trustedGid === undefined || !endpoint.workspaceId || !endpoint.systemdSocketRoot) {
      throw new Error('Production tenant requires trustedUid: 0, trustedGid, workspaceId and systemdSocketRoot')
    }
    if (!isAbsolute(endpoint.socketPath) || !isAbsolute(endpoint.systemdSocketRoot)
      || realpathSync(endpoint.systemdSocketRoot) !== resolve(endpoint.systemdSocketRoot)) {
      throw new Error('Production tenant socket and root must be absolute; root must be canonical')
    }
  }
  for (const binding of config.operatorBindings ?? []) {
    if (!config.tenants[binding.targetTenantId]) throw new Error('Operator binding references an unconfigured tenant')
  }

  const lease = await ImWriterLease.acquire(config.stateDirectory)
  let transport: FeishuTransport | DingTalkTransport | undefined
  let ingress: IngressService | undefined
  let interactions: InteractionIngress | undefined
  let feishuChannel: FeishuTransport | undefined
  let sqlite: SqliteStorageBackend | undefined
  let unregisterBackend: (() => void) | undefined
  const clients = new Set<TenantIpcClient>()
  const readyClients = new Map<string, TenantIpcClient>()
  const connecting = new Map<string, Promise<TenantIpcClient>>()
  const abort = new AbortController()
  let pump: Promise<void> | undefined
  let cancelReady: (() => void) | undefined
  let closing: Promise<void> | undefined
  let closed = false
  const assertAccepting = () => { if (closed) throw new Error('IM ingress is closed') }

  const cleanup = (): Promise<void> => {
    if (closing) return closing
    closed = true
    abort.abort()
    closing = Promise.resolve().then(async () => {
      const registrationErrors: unknown[] = []
      try { cancelReady?.() } catch (error) { registrationErrors.push(error) }
      const drain = async () => {
        const work: Promise<unknown>[] = [...connecting.values()]
        if (transport) work.push(transport.close())
        if (interactions) work.push(interactions.close())
        if (ingress) work.push(ingress.close())
        if (pump) work.push(pump)
        const results = await Promise.allSettled(work)
        const clientResults = await Promise.allSettled(Array.from(clients, client => client.close()))
        const errors: unknown[] = [...registrationErrors]
        for (const result of [...results, ...clientResults]) if (result.status === 'rejected') errors.push(result.reason)
        if (errors.length) throw new AggregateError(errors, 'IM ingress work did not drain')
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([drain(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { reject(new Error('IM ingress shutdown deadline exceeded')) }, config.shutdownTimeoutMs)
        })])
      } finally { clearTimeout(timer) }
      await sqlite?.close()
      unregisterBackend?.()
      await lease.release()
    })
    return closing
  }
  ctx.effect(() => cleanup, 'IM ingress ownership')

  try {
    sqlite = new SqliteStorageBackend({ path: join(config.stateDirectory, 'ingress.sqlite'), journalMode: 'wal' })
    const backendKey = `sqlite:im-ingress:${config.ingressId}`
    unregisterBackend = ctx.storage.backend.register(backendKey, sqlite)
    const facility = new DomainFacility(ctx, { backend: backendKey, routes: {} })
    const storage = new IngressStorage(await facility.open(ingressDomainSpec))
    for (const binding of config.operatorBindings ?? []) {
      if (!storage.getBinding(binding.bindingKey)) await storage.putBinding(binding)
    }

    const provider = {
      getClient(targetTenantId: TargetTenantId): Promise<TenantIpcClient> {
        if (closed) return Promise.reject(new Error('IM ingress is closed'))
        const cached = readyClients.get(targetTenantId)
        if (cached?.isConnected()) return Promise.resolve(cached)
        const pending = connecting.get(targetTenantId)
        if (pending) return pending
        const endpoint = config.tenants[targetTenantId]
        if (!endpoint) return Promise.reject(new Error('Unconfigured tenant'))
        const connection = Promise.resolve().then(async () => {
          if (closed) throw new Error('IM ingress is closed')
          if (cached) {
            await cached.close()
            clients.delete(cached)
            readyClients.delete(targetTenantId)
          }
          const client = deps.clientFactory ? deps.clientFactory(targetTenantId, endpoint)
            : new TenantIpcClient({ ...endpoint, ingressId: config.ingressId, targetTenantId })
          clients.add(client)
          try {
            await client.connect()
            assertAccepting()
            readyClients.set(targetTenantId, client)
            return client
          } catch (error) {
            try { await client.close() } catch (closeError) {
              throw new AggregateError([error, closeError], 'Tenant connection cleanup failed')
            }
            clients.delete(client)
            throw error
          }
        }).finally(() => { connecting.delete(targetTenantId) })
        connecting.set(targetTenantId, connection)
        return connection
      },
    } satisfies TenantIpcClientProvider
    const acceptor: IngressDurableAcceptor = {
      handleIncomingMessage(message) {
        if (!ingress || closed) return Promise.reject(new Error('IM ingress is not accepting messages'))
        return ingress.handleIncomingMessage(message)
      },
    }
    let sender = deps.replySender
    if (config.channel?.kind === 'feishu') {
      const { kind: _kind, ...settings } = config.channel
      const cardAcceptor = config.interactions ? {
        handleCardAction: (action: Parameters<InteractionIngress['handleCardAction']>[0]) => {
          if (!interactions || closed) return Promise.reject(new Error('IM interactions are not accepting callbacks'))
          return interactions.handleCardAction(action)
        },
      } : undefined
      const channel = new FeishuTransport(settings, acceptor, cardAcceptor, deps.feishu)
      feishuChannel = channel
      transport = channel
      sender ??= new FeishuReplySender(channel)
    } else if (config.channel?.kind === 'dingtalk') {
      const { kind: _kind, ...settings } = config.channel
      const channel = new DingTalkTransport(settings, acceptor, deps.dingtalk)
      transport = channel
      sender ??= new DingTalkReplySender(channel)
    }
    if (!sender) throw new Error('No configured platform reply sender')
    ingress = new IngressService({
      maxStoredDeliveries: config.maxStoredDeliveries, maxPendingAdmissions: config.maxPendingAdmissions,
      maxPromptBytes: config.maxPromptBytes, maxReplyBytes: config.maxReplyBytes,
      maxEventAgeMs: config.maxEventAgeMs, maxFutureSkewMs: config.maxFutureSkewMs,
      maxOutboxAttempts: config.maxOutboxAttempts,
    }, storage, provider, sender)
    if (config.interactions) {
      if (!feishuChannel) throw new Error('Interactive card publisher is unavailable')
      const publisher = feishuChannel
      interactions = new InteractionIngress(await facility.open(publishedInteractionDomain), config.interactions,
        storage, ingress, tenant => provider.getClient(tenant), (chatId, card) => publisher.sendInteractiveCard(chatId, card))
    }
    ctx.provide('imIngress', ingress)
    await transport?.start()
    const service = ingress
    if (config.dispatchIntervalMs > 0 && appReady && appExit) {
      cancelReady = appReady.onReady(() => {
        if (closed || pump) return
        pump = (async () => {
          while (!abort.signal.aborted) {
            await service.dispatchPending()
            await interactions?.pollPending()
            try { await delay(config.dispatchIntervalMs, undefined, { signal: abort.signal }) }
            catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) throw error }
          }
        })()
        void pump.catch((error: unknown) => {
          if (closed) return
          ctx.logger.error('IM ingress dispatch failed', error)
          appExit(1)
        })
      })
    }
  } catch (error) {
    try { await cleanup() } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'IM ingress startup failed') }
    throw error
  }
}
