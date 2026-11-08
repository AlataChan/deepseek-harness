/**
 * Browser/Client contribution for Agent-Reach.
 * Registers typed locale dictionaries and tool call view presenters.
 *
 * @module @deepseek-ai/dsh-experimental-agent-reach/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { en, NS, zh, type ReachLocaleKey } from './locales.ts'
import { ReachCard } from './ReachCard.tsx'

export { ReachCard, type ReachCardProps } from './ReachCard.tsx'
export { en, NS, zh, type ReachLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'desktop-agent-reach': ReachLocaleKey
  }
}

const TOOLS = ['reach_channels', 'reach_status', 'reach_query', 'reach_setup'] as const

/** Required browser services. */
export const inject = ['slots', 'locale']

/**
 * Register dictionaries and tool view cards.
 *
 * @param ctx - client root context
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'desktop-agent-reach: dictionaries')

  for (const key of TOOLS) {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register(
        {
          name: 'tool.call.toolview',
          key,
          locale: NS,
        },
        ReachCard,
      ),
    )
  }
}
