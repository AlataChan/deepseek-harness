/**
 * Session-only extract: sidecar convert-file, then a character cap.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/extract
 */

import { readFile } from 'node:fs/promises'
import { ASK_KNOWLEDGE_EXTRACT_MAX_CHARS, AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import type { AskKnowledgeExtractResult } from '@deepseek-ai/dsh-host-ask-knowledge'
import { extractDocxBytes, isDocxExtractFilename } from './extract-docx.ts'
import type { AskKnowledgeHomeConfig } from './knowledge-home.ts'
import { runSidecar } from './sidecar.ts'
import type { IngestUpload } from './upload-temp.ts'

/** Sidecar deadline for convert-file. Convert has no LLM propose step. */
export const CONVERT_FILE_TIMEOUT_MS = 90_000

/**
 * Cap extracted text at {@link ASK_KNOWLEDGE_EXTRACT_MAX_CHARS} code points.
 * @param text - sidecar body.
 * @returns clipped text and whether a suffix was dropped.
 */
export function clipExtractText(text: string): { text: string; truncated: boolean } {
  const chars = [...text]
  if (chars.length <= ASK_KNOWLEDGE_EXTRACT_MAX_CHARS) return { text, truncated: false }
  return { text: chars.slice(0, ASK_KNOWLEDGE_EXTRACT_MAX_CHARS).join(''), truncated: true }
}

/**
 * Convert one materialized upload to markdown and clip it. Does not write vault.
 * @param config - sidecar home.
 * @param upload - assembled temp file.
 * @param signal - caller lifetime.
 * @returns filename, clipped text, and truncation flag.
 */
export async function convertUploadToText(
  config: AskKnowledgeHomeConfig,
  upload: IngestUpload,
  signal?: AbortSignal,
): Promise<AskKnowledgeExtractResult> {
  if (isDocxExtractFilename(upload.filename)) {
    const text = extractDocxBytes(new Uint8Array(await readFile(upload.path)))
    if (text.trim() === '') {
      throw new AskKnowledgeError('ingest-failed', '这份 Word 没有可提取的文字')
    }
    const clipped = clipExtractText(text)
    return { filename: upload.filename, text: clipped.text, truncated: clipped.truncated }
  }
  const result = await runSidecar(config, {
    command: 'convert-file',
    path: upload.path,
  }, { signal, timeoutMs: CONVERT_FILE_TIMEOUT_MS })
  const body = typeof result.body === 'string' ? result.body : ''
  if (body.trim() === '') {
    throw new AskKnowledgeError('ingest-failed', '这份文件没有可提取的文字。')
  }
  const clipped = clipExtractText(body)
  return { filename: upload.filename, text: clipped.text, truncated: clipped.truncated }
}
