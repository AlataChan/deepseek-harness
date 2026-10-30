/** Serialized per-channel settings transactions and owned platform lifetimes. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { channelSchema, connectionConfigSchema, type ImChannel, type ConnectionConfig, type ImSnapshot } from './schema.ts'

/** Runtime resources owned by one saved desktop connection. */
export interface ImConnection {
  start(): Promise<void>
  isConnected(): boolean
  hasDeliveryFailure(): boolean
  close(): Promise<void>
}
/** Secret storage and runtime composition supplied by the Host. */
export interface ImControllerOwner {
  hasSecret(this: void, channel: ImChannel): Promise<boolean>
  setSecret(this: void, channel: ImChannel, secret: string): Promise<void>
  create(this: void, channel: ImChannel, config: ConnectionConfig, onFailure: () => void, test: boolean): Promise<ImConnection>
  validate(this: void, config: ConnectionConfig): Promise<ConnectionConfig>
}
const storedSchema = z.object({ schemaVersion: z.literal(1), config: connectionConfigSchema, enabled: z.boolean() }).strict()

/** One channel's serialized mutations; secrets never enter its JSON or returned snapshots. */
export class ImConnectionController {
  private config: ConnectionConfig | null = null
  private enabled = false
  private phase: ImSnapshot['phase'] = 'off'
  private error: ImSnapshot['error'] = null
  private connection: ImConnection | undefined
  private tail: Promise<unknown> = Promise.resolve()
  private disposed = false

  /**
   * @param channel - Concrete platform.
   * @param directory - Private settings home.
   * @param owner - Credential and runtime owner.
   */
  constructor(readonly channel: ImChannel, private readonly directory: string, private readonly owner: ImControllerOwner) {}

  /** Restore the saved configuration and enabled choice.
   * @returns Completion after restoration; corrupt files fail loudly.
   */
  load(): Promise<void> {
    return this.mutate(async () => {
      try { await this.loadSaved() }
      catch (error) { this.phase = 'error'; this.error = 'storage'; throw error }
    })
  }

  private async loadSaved(): Promise<void> {
    channelSchema.parse(this.channel)
    let text: string
    try { text = await readFile(this.file(), 'utf8') }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return; throw error }
    const saved = storedSchema.parse(JSON.parse(text))
    this.config = saved.config
    this.enabled = saved.enabled
    if (this.enabled) {
      try { await this.connect(false) } catch (_error) { this.phase = 'error'; this.error = 'startup' }
    }
  }

  /** Read the current connection state without exposing credentials.
   * @returns Redacted status and saved settings.
   */
  async snapshot(): Promise<ImSnapshot> {
    const deliveryFailure = this.connection?.hasDeliveryFailure() === true
    const phase = deliveryFailure ? 'error'
      : this.phase === 'connected' && this.connection && !this.connection.isConnected() ? 'connecting' : this.phase
    return { channel: this.channel, config: this.config ? { ...this.config } : null, enabled: this.enabled,
      secretConfigured: await this.owner.hasSecret(this.channel), phase, error: this.error ?? (deliveryFailure ? 'delivery' : null) }
  }

  /**
   * Stop the channel and save its new authorization and execution settings.
   * @param input - Untrusted form settings.
   * @param secret - Optional replacement; blank retains existing secret.
   * @returns Saved, disabled status.
   */
  save(input: ConnectionConfig, secret: string): Promise<ImSnapshot> {
    return this.mutate(async () => {
      const config = await this.owner.validate(connectionConfigSchema.parse(input))
      const replacement = z.string().max(8192).parse(secret).trim()
      await this.disable()
      if (replacement) await this.owner.setSecret(this.channel, replacement)
      try { await this.persist(config, false) }
      catch (_error) { this.phase = 'error'; this.error = 'storage'; throw new Error('IM settings could not be saved') }
      this.config = config
      this.error = null
      return this.snapshot()
    })
  }

  /**
   * Apply the enabled choice after queued settings mutations finish.
   * @param enabled - Explicit operator choice.
   * @returns Status only after connection or shutdown settles.
   */
  setEnabled(enabled: boolean): Promise<ImSnapshot> {
    return this.mutate(async () => {
      z.boolean().parse(enabled)
      if (!enabled) await this.disable()
      else {
        if (!this.config) throw new Error('Save IM settings first')
        await this.disable()
        await this.connect(false)
        try { await this.persist(this.config, true) }
        catch (_error) {
          const stopped = await Promise.allSettled([this.stop()])
          this.phase = 'error'; this.error = stopped[0].status === 'rejected' ? 'shutdown' : 'storage'
          throw new Error('IM enabled choice could not be saved')
        }
        this.enabled = true
      }
      return this.snapshot()
    })
  }

  /** Probe the saved credentials without admitting tasks.
   * @returns Completion after the authenticated probe is closed.
   */
  test(): Promise<ImSnapshot> {
    return this.mutate(async () => {
      if (this.connection) throw new Error('Turn off IM before testing its connection')
      await this.connect(true)
      await this.stop()
      return this.snapshot()
    })
  }

  /** Stop new transactions before awaiting queued work and runtime disposal.
   * @returns Quiescence of queued mutations and the owned connection.
   */
  async close(): Promise<void> {
    this.disposed = true
    const stopping = this.connection ? this.stop() : Promise.resolve()
    const results = await Promise.allSettled([this.tail, stopping])
    if (results[1].status === 'rejected') throw new Error('IM shutdown failed')
    await this.stop()
  }

  private file(): string { return join(this.directory, `${this.channel}.json`) }
  private async persist(config: ConnectionConfig, enabled: boolean): Promise<void> {
    await writeFileAtomic(this.file(), JSON.stringify({ schemaVersion: 1, config, enabled }) + '\n',
      { mode: 0o600, dirMode: 0o700 })
  }
  private async disable(): Promise<void> {
    this.enabled = false
    // Stopping admission must not depend on a writable settings file.
    const results = await Promise.allSettled([
      this.stop(), this.config ? this.persist(this.config, false) : Promise.resolve(),
    ])
    if (results[0].status === 'rejected' || results[1].status === 'rejected') {
      this.phase = 'error'; this.error = results[0].status === 'rejected' ? 'shutdown' : 'storage'
      throw new Error(this.error === 'shutdown' ? 'IM shutdown failed' : 'IM disabled choice could not be saved')
    }
  }
  private async connect(test: boolean): Promise<void> {
    if (!this.config || !await this.owner.hasSecret(this.channel)) throw new Error('IM credentials are not configured')
    this.phase = 'connecting'; this.error = null
    let candidate: ImConnection | undefined
    try {
      const config = await this.owner.validate(this.config)
      candidate = await this.owner.create(this.channel, config, () => { this.phase = 'error'; this.error = 'delivery' }, test)
      this.connection = candidate
      if (this.disposed) throw new Error('IM settings are closing')
      await candidate.start()
      this.phase = 'connected'
    } catch (_error) {
      this.phase = 'error'; this.error = 'startup'
      if (candidate) {
        try { await candidate.close(); this.connection = undefined }
        catch (_cleanupError) { this.error = 'shutdown' }
      }
      // SDK failures can include request headers; never return their raw diagnostics to the page.
      throw new Error('IM connection failed; check app credentials, permissions and network')
    }
  }
  private async stop(): Promise<void> {
    const connection = this.connection
    if (connection) {
      try { await connection.close() }
      catch (_error) { this.phase = 'error'; this.error = 'shutdown'; throw new Error('IM shutdown failed') }
      this.connection = undefined
    }
    this.phase = 'off'; this.error = null
  }
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('IM settings are closed'))
    const result = this.tail.then(() => { if (this.disposed) throw new Error('IM settings are closed'); return operation() })
    this.tail = result.catch(() => undefined)
    return result
  }
}
