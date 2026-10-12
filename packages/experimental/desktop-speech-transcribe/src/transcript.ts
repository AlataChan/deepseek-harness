/**
 * Render the Markdown transcript written beside one recording.
 * @module @deepseek-ai/dsh-experimental-desktop-speech-transcribe/transcript
 */

import type { Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text'

/** Facts beyond the recognized text that the transcript file records. */
export interface TranscriptDocumentOptions {
  /** Recording file name shown in the title. */
  readonly sourceName: string
  /** Recognition result and its measured durations. */
  readonly transcript: Transcript
  /** Registered provider id. */
  readonly providerId: string
  /** Registered provider display name. */
  readonly providerName: string
  /** Generation timestamp used for the date line. */
  readonly generatedAt: Date
}

/**
 * Format a duration as `minutes:seconds`; minutes are not wrapped at 60.
 * @param seconds - duration in seconds.
 * @returns zero-padded clock text.
 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Format inference time with one decimal second.
 * @param seconds - measured inference seconds.
 * @returns Chinese duration text.
 */
export function formatInference(seconds: number): string {
  return `${Math.max(0, seconds).toFixed(1)} 秒`
}

/**
 * Format a local calendar date as `YYYY-MM-DD`.
 * @param date - generation time.
 * @returns date text.
 */
export function formatDate(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}`
    + `-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Render the transcript Markdown: a titled header, measured facts, and the
 * full text under `## 全文`. A whitespace-only recognition still produces a
 * file, marked `未识别到语音`.
 * @param options - source, recognition result, provider, and date.
 * @returns complete file content with one trailing newline.
 */
export function renderTranscript(options: TranscriptDocumentOptions): string {
  const text = options.transcript.text.trim()
  return [
    `# ${options.sourceName} 录音转写`,
    '',
    `- 时长：${formatClock(options.transcript.audioSeconds)}`,
    `- 转写用时：${formatInference(options.transcript.inferenceSeconds)}`,
    `- 识别服务：${options.providerId}（${options.providerName}）`,
    `- 生成日期：${formatDate(options.generatedAt)}`,
    '',
    '## 全文',
    '',
    text.length === 0 ? '未识别到语音。' : text,
    '',
  ].join('\n')
}
