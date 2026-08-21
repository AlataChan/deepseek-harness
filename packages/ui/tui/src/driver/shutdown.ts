/** Ordered terminal shutdown coordination. @module @deepseek-ai/dsh-tui/driver/shutdown */

/** Whether cleanup was requested by the user or the owning Cordis fiber. */
export type TuiShutdownOrigin = 'user' | 'owner'

/** Ordered effects supplied by the composed runtime. */
export interface TuiShutdownOptions {
  readonly rejectInput: () => void
  readonly settleInteractions: () => void | Promise<void>
  readonly cancelAgent: () => void
  readonly whenIdle: () => Promise<void>
  readonly flushSession: () => Promise<void>
  readonly unmount: () => void | Promise<void>
  readonly restoreRawMode: () => void
  readonly disposeOwned: () => Promise<void>
  readonly requestExit: (code: number) => void
}

/** Idempotent shutdown face. */
export interface TuiShutdown {
  /** Start cleanup once and return the exact shared Promise thereafter. */
  shutdown(origin: TuiShutdownOrigin): Promise<void>
}

/**
 * Create one deterministic shutdown coordinator.
 * @param options - effects in their required execution order.
 * @returns an idempotent coordinator that never owns process signals.
 */
export function createTuiShutdown(options: TuiShutdownOptions): TuiShutdown {
  let running: Promise<void> | undefined
  return {
    shutdown(origin) {
      if (running !== undefined) return running
      running = (async () => {
        let failure: unknown
        const attempt = async (operation: () => void | Promise<void>): Promise<void> => {
          try {
            await operation()
          } catch (error: unknown) {
            failure ??= error
          }
        }
        await attempt(options.rejectInput)
        await attempt(options.settleInteractions)
        await attempt(options.cancelAgent)
        await attempt(options.whenIdle)
        await attempt(options.flushSession)
        await attempt(options.unmount)
        await attempt(options.restoreRawMode)
        await attempt(options.disposeOwned)
        if (origin === 'user') options.requestExit(failure === undefined ? 0 : 1)
        if (failure !== undefined) {
          throw failure instanceof Error ? failure : new Error('tui shutdown failed', { cause: failure })
        }
      })()
      return running
    },
  }
}
