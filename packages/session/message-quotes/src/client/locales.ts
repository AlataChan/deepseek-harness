/** Quote selection dictionaries. */
export const NS = 'messageQuotes'
/** Chinese selection action. */
export const zh = { 'quote.add': '引用文本' }
/** English selection action. */
export const en: Record<keyof typeof zh, string> = { 'quote.add': 'Quote text' }
/** Supported selection dictionary keys. */
export type MessageQuotesKey = keyof typeof zh
