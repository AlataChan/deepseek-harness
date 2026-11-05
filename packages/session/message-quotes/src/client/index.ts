/** Selected transcript text enters the current composer through its keyed Chat slot. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { QuoteSelectionAction } from './QuoteSelection.tsx'
import { en, NS, zh, type MessageQuotesKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Selected transcript quotation action. */
    messageQuotes: MessageQuotesKey
  }
}
/** Browser plugin name. */
export const name = 'message-quotes'
/** Slot and locale services own contributions. */
export const inject = ['slots', 'locale', 'sessions', 'uiConversation']
/** @param ctx - Browser context owning quote contributions. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'message-quotes: dictionaries')
  ctx.slots.inject('conversation.chat.text-interaction', () => ctx.slots.register({
    name: 'conversation.chat.text-interaction', key: 'quote', locale: NS,
  }, QuoteSelectionAction))
}
