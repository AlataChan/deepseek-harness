/** Slash-command routing for one terminal controller. @module @deepseek-ai/dsh-tui/driver/commands */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import type { TuiStore } from '../state/store.ts'

/** Whether a submitted draft was consumed or must remain in the composer. */
export type TuiCommandRoute = 'accepted' | 'preserve'

/** Dependencies kept outside the command router's private confirmation state. */
export interface TuiCommandRouterOptions {
  /** Return the exact currently owned Agent. */
  readonly agent: () => Agent | undefined
  /** Store receiving local help and failure rows. */
  readonly store: TuiStore
  /** Send confirmed non-command input to the model. */
  readonly submitModel: (line: string) => void
  /** Replace the idle composer with the resume selector. */
  readonly openResume: () => Promise<void>
  /** Begin normal user-requested shutdown. */
  readonly requestShutdown: () => Promise<void>
}

/** Stateful command router owned by one TUI controller. */
export interface TuiCommandRouter {
  /** Route one complete composer line. */
  route(line: string, signal: AbortSignal): Promise<TuiCommandRoute>
}

function append(
  store: TuiStore,
  kind: 'system' | 'error',
  text: string,
): void {
  store.dispatch({ type: 'transcript/finalize', row: { kind, text } })
}

function localHelp(ctx: Context, agent: Agent): string {
  const registered = ctx.commands.list(agent).map((descriptor) => {
    const hint = descriptor.input?.hint === undefined ? '' : ` ${descriptor.input.hint}`
    return `/${descriptor.name}${hint} — ${descriptor.description}`
  })
  return [
    '/help — Show available commands',
    '/resume — Choose another saved session',
    '/exit — Exit after saving the current session',
    ...registered,
  ].join('\n')
}

/**
 * Create one local-first router over the shared command registry.
 * @param ctx - context carrying the effective scoped command runtime.
 * @param options - exact Agent and terminal effects.
 * @returns a router retaining only one pending unknown-command confirmation.
 */
export function createTuiCommandRouter(
  ctx: Context,
  options: TuiCommandRouterOptions,
): TuiCommandRouter {
  let pendingUnknown: string | undefined
  return {
    async route(line, signal) {
      const agent = options.agent()
      if (agent === undefined) {
        append(options.store, 'error', 'No active session is available.')
        return 'preserve'
      }
      if (line === '/help') {
        pendingUnknown = undefined
        append(options.store, 'system', localHelp(ctx, agent))
        return 'accepted'
      }
      if (line === '/resume') {
        pendingUnknown = undefined
        const state = options.store.getSnapshot()
        if (agent.status === 'running' || state.interaction !== undefined) {
          append(options.store, 'error', 'Cannot resume another session while a turn or interaction is active.')
          return 'preserve'
        }
        await options.openResume()
        return 'accepted'
      }
      if (line === '/exit') {
        pendingUnknown = undefined
        await options.requestShutdown()
        return 'accepted'
      }
      if (line.startsWith('/')) {
        try {
          const execution = await ctx.commands.execute(agent, line, [], signal)
          if (execution !== undefined) {
            pendingUnknown = undefined
            return execution.result.kind === 'error' ? 'preserve' : 'accepted'
          }
        } catch (error: unknown) {
          append(options.store, 'error', error instanceof Error ? error.message : String(error))
          return 'preserve'
        }
        if (pendingUnknown !== line) {
          pendingUnknown = line
          append(options.store, 'system', `Unknown command. Submit it again to send ${JSON.stringify(line)} to the model.`)
          return 'preserve'
        }
      }
      pendingUnknown = undefined
      options.submitModel(line)
      return 'accepted'
    },
  }
}
