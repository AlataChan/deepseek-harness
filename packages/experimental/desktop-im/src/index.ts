/** Fork-owned desktop IM settings and single-user connection supervisor. */
import { mkdir, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { createDesktopImRuntime, createDesktopImProbe, DesktopImLease } from '@deepseek-ai/dsh-experimental-im-feishu/desktop'
import { ImConnectionController } from './controller.ts'
import { channelSchema, type ImChannel, type ConnectionConfig, type ImSnapshot } from './schema.ts'

/** Resolve the dedicated IM credential reference.
 * @param channel - Platform whose app secret is stored.
 * @returns Reference independent of model-provider keys.
 */
export function imSecretRef(channel: ImChannel): ReturnType<typeof credentialRef> {
  return credentialRef(`OCTOPUS_IM_${channel.toUpperCase()}_APP_SECRET`)
}

declare module '@deepseek-ai/cordis' {
  interface Context { desktopIm: DesktopIm }
}

/** Deployment limits for the desktop-owned message queues and connection teardown. */
export interface Config {
  /** Absolute settings directory override; empty selects the desktop profile home. */
  settingsDirectory: string
  /** Interval between durable delivery dispatch passes in milliseconds. */
  dispatchIntervalMs: number
  /** Maximum wait for owned Agent shutdown in milliseconds. */
  shutdownTimeoutMs: number
  /** Maximum Session events read when reconciling a delivery. */
  maxReconciliationEvents: number
  /** Retained work and message admission limits. */
  ingress: {
    /** Maximum retained inbox records before new deliveries are refused. */
    maxStoredDeliveries: number
    /** Maximum simultaneous inbound admission operations. */
    maxPendingAdmissions: number
    /** Maximum UTF-8 prompt size accepted per delivery. */
    maxPromptBytes: number
    /** Maximum UTF-8 final reply size sent to a platform. */
    maxReplyBytes: number
    /** Oldest platform event admitted, in milliseconds. */
    maxEventAgeMs: number
    /** Maximum accepted future timestamp skew in milliseconds. */
    maxFutureSkewMs: number
    /** Maximum confirmed-safe reply attempts. */
    maxOutboxAttempts: number
  }
}

/** Remote service with two independently owned channel controllers. */
export default class DesktopIm extends TypertRemoteService {
  static inject = ['credentials', 'agents', 'sessions', 'sessionPersistence', 'storage', 'llm']
  static Config = Schema.object({
    settingsDirectory: Schema.string().default(''),
    dispatchIntervalMs: Schema.number().min(10).default(1000),
    shutdownTimeoutMs: Schema.number().min(1).max(2147483647).default(15000),
    maxReconciliationEvents: Schema.natural().min(1).default(1000),
    ingress: Schema.object({
      maxStoredDeliveries: Schema.natural().min(1).default(10000),
      maxPendingAdmissions: Schema.natural().min(1).default(64),
      maxPromptBytes: Schema.natural().min(1).default(32768),
      maxReplyBytes: Schema.natural().min(1).default(32768),
      maxEventAgeMs: Schema.natural().min(1).default(300000),
      maxFutureSkewMs: Schema.natural().default(30000),
      maxOutboxAttempts: Schema.natural().min(1).default(3),
    }),
  })
  private readonly controllers = new Map<ImChannel, ImConnectionController>()
  private readonly ready: Promise<void>
  private closed = false

  /** @param ctx - Desktop Host services; no platform calls before an explicit saved enable. */
  constructor(ctx: Context, deployment: Config) {
    super(ctx, 'desktopIm')
    const directory = deployment.settingsDirectory || dshHomePath('profiles', 'desktop', 'im')
    if (!isAbsolute(directory)) throw new Error('Desktop IM settings directory must be absolute')
    for (const channel of channelSchema.options) {
      const controller = new ImConnectionController(channel, directory, {
        hasSecret: async selected => (await ctx.credentials.describe(imSecretRef(selected))).configured,
        setSecret: async (selected, secret) => { await ctx.credentials.set(imSecretRef(selected), secret) },
        validate: async (config) => {
          if (!isAbsolute(config.cwd)) throw new Error('Select an absolute workspace directory')
          const cwd = await realpath(config.cwd)
          const info = await stat(cwd)
          if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid())) {
            throw new Error('Select a workspace owned by this desktop user')
          }
          if (!ctx.llm.listProviders().some(provider => provider.id === config.provider)) throw new Error('Configure the selected model provider first')
          return { ...config, cwd }
        },
        create: async (selected, config, failure, test) => {
          if (this.closed) throw new Error('Desktop IM is closing')
          const secret = await ctx.credentials.resolve(imSecretRef(selected))
          if (!secret) throw new Error('IM app secret is missing')
          if (test) return createDesktopImProbe(selected, config.appId, secret.value, config.tenantId)
          return createDesktopImRuntime(ctx, { ...config, provider: selected, appSecret: secret.value,
            modelSelection: { provider: config.provider, model: config.model },
            stateDirectory: join(directory, selected, createHash('sha256')
              .update(JSON.stringify([config.appId, config.tenantId, config.chatId, config.senderId, config.cwd])).digest('hex')),
            dispatchIntervalMs: deployment.dispatchIntervalMs,
            shutdownTimeoutMs: deployment.shutdownTimeoutMs,
            ingress: deployment.ingress, maxReconciliationEvents: deployment.maxReconciliationEvents }, failure)
        },
      })
      this.controllers.set(channel, controller)
    }
    let lease: DesktopImLease | undefined
    ctx.effect(() => async () => {
      this.closed = true
      const results = await Promise.allSettled([...this.controllers.values()].map(controller => controller.close()))
      await this.ready.catch(() => undefined)
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
      lease?.release()
    }, 'desktop-im: owned connections')
    this.ready = (async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      lease = DesktopImLease.acquire(directory)
      if (this.closed) return
      await Promise.all([...this.controllers.values()].map(controller => controller.load().catch(() => {
        ctx.logger.error('Desktop IM channel settings could not be loaded')
      })))
    })()
    void this.ready.catch(() =>{  ctx.logger.error('Desktop IM settings ownership could not be acquired') })
  }

  /** Read both channel configurations and live status.
   * @returns Non-secret configuration and connection status for both platforms.
   */
  @Remote
  async list(): Promise<ImSnapshot[]> {
    await this.ready
    return Promise.all([...this.controllers.values()].map(controller => controller.snapshot()))
  }

  /**
   * Save a connection without enabling it.
   * @param channel - Selected platform.
   * @param config - Non-secret form settings.
   * @param secret - Replacement secret or blank to retain.
   * @returns Saved OFF status.
   */
  @Remote
  async save(channel: ImChannel, config: ConnectionConfig, secret: string): Promise<ImSnapshot> {
    await this.ready
    return this.controller(channel).save(config, secret)
  }

  /** Apply the operator's enabled choice and await its outcome.
   * @param channel - Selected platform.
   * @param enabled - Explicit ON/OFF choice.
   * @returns Settled lifecycle status.
   */
  @Remote
  async setEnabled(channel: ImChannel, enabled: boolean): Promise<ImSnapshot> {
    await this.ready
    return this.controller(channel).setEnabled(enabled)
  }

  /**
   * Authenticate a saved connection without executing tasks.
   * @param channel - Saved platform connection.
   * @returns Probe completion; no message admission or model invocation.
   */
  @Remote
  async test(channel: ImChannel): Promise<ImSnapshot> {
    await this.ready
    return this.controller(channel).test()
  }

  private controller(channel: ImChannel): ImConnectionController {
    if (this.closed) throw new Error('Desktop IM is closed')
    const controller = this.controllers.get(channelSchema.parse(channel))
    if (!controller) throw new Error('Unsupported IM channel')
    return controller
  }
}
