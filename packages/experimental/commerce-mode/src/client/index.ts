/**
 * Browser half of commerce-mode: tool cards for staged, discarded, and exported commerce changes.
 * Cards derive from each call's logged arguments and result metadata; the ledger line reads the
 * `commerceSession` projection.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the keyed `tool.call.toolview` slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { CommerceChangeRow } from './CommerceChangeRow.tsx'
import { en, NS, zh, type CommerceKey } from './locales.ts'
import { COMMERCE_CARD_TOOL_NAMES } from './models.ts'

export type { CommerceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Commerce tool card copy. */
    'commerce-mode': CommerceKey
  }
}

/** Required services: the slot registry and the locale registry. */
export const inject = ['slots', 'locale']

/**
 * Register the commerce dictionaries and one keyed card per staging, discard, and export tool.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'commerce-mode: dictionaries')
  for (const key of COMMERCE_CARD_TOOL_NAMES) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key, locale: NS },
      CommerceChangeRow,
    ))
  }
}
