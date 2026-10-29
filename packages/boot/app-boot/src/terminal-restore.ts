/**
 * Terminal restoration registry and controller across process lifecycles.
 * Terminal frontends register synchronous restore callbacks here so the
 * launcher and fail-loud crash reporting can reset the terminal before
 * diagnostic printing and on OS signals.
 *
 * @module @deepseek-ai/dsh-app-boot/terminal-restore
 */

import type {} from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Launcher-owned terminal restore registry. Terminal-mode frontends register
     * synchronous callbacks that run before fatal error reporting and on process
     * interrupts.
     */
    terminalRestore?: TerminalRestoreController
  }
}

/** Controller for terminal restoration hooks. */
export interface TerminalRestoreController {
  /**
   * Register one synchronous terminal restore callback.
   * Returns an unregister disposer function.
   * @param restore - Synchronous callback to restore terminal state.
   * @returns Unregister disposer function.
   */
  register(restore: () => void): () => void

  /**
   * Synchronously invoke all registered restore callbacks in reverse registration order.
   * Each callback is exception-contained so a failure in one does not stop others.
   */
  restoreNow(): void

  /** Number of active restore hooks. */
  readonly activeCount: number

  /** Optional listener called whenever activeCount changes. */
  onChange?: (count: number) => void
}

/**
 * Create a new terminal restore controller.
 * @returns A new TerminalRestoreController instance.
 */
export function createTerminalRestore(): TerminalRestoreController {
  const hooks = new Set<() => void>()
  const controller: TerminalRestoreController = {
    get activeCount(): number {
      return hooks.size
    },
    register(restore: () => void): () => void {
      hooks.add(restore)
      controller.onChange?.(hooks.size)
      let unregistered = false
      return () => {
        if (unregistered) return
        unregistered = true
        hooks.delete(restore)
        controller.onChange?.(hooks.size)
      }
    },
    restoreNow(): void {
      for (const hook of [...hooks].reverse()) {
        try {
          hook()
        } catch {
          // Contained: terminal restoration failures must not throw or halt remaining hooks.
        }
      }
    },
  }
  return controller
}
