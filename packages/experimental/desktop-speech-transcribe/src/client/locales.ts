/**
 * Locale-owned copy for the 录音转文字 row. Chinese is the default.
 * @module @deepseek-ai/dsh-experimental-desktop-speech-transcribe/client/locales
 */

/** Dictionary keys owned by this overlay. */
export type SpeechTranscribeKey = keyof typeof zh

/** Chinese desktop copy. */
export const zh = {
  'row.label': '录音转文字',
  'row.noSession': '先在下方输入框开始对话，再转写录音。',
  'row.unavailable': '现在还不能导入录音，请稍后再试。',
  'row.tooLarge': '录音超过 {mib} MiB，请改选较短的录音或先压缩。',
  'row.readFailed': '没能读取这段录音。',
  'row.importFailed': '没能把录音放进工作区。',
  'row.draft': '把 {path} 转成文字稿',
} as const

/** English fallback. */
export const en = {
  'row.label': 'Transcribe recording',
  'row.noSession': 'Start a conversation in the composer first, then transcribe a recording.',
  'row.unavailable': 'Recordings cannot be staged right now. Try again shortly.',
  'row.tooLarge': 'The recording exceeds {mib} MiB. Choose a shorter one or compress it first.',
  'row.readFailed': 'Could not read this recording.',
  'row.importFailed': 'Could not stage this recording into the workspace.',
  'row.draft': 'Transcribe {path} into a transcript.',
} as const

/** Dictionary namespace. */
export const NS = 'desktop-speech-transcribe'
