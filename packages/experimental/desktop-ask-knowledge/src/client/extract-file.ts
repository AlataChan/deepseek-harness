/**
 * Client-side session-only extract over begin/append/finish remotes.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/client/extract-file
 */

import { encodeIngestChunks } from './ingest-file.ts'

/** Remote result used by the session-document bridge. */
type ExtractRemote<T> = Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>

/** Session remotes the extract path needs. */
export interface SessionDocumentExtractRemotes {
  beginExtract(request: { filename: string }): ExtractRemote<string>
  appendExtractChunk(request: { handle: string; bytes: string }): ExtractRemote<void>
  finishExtract(request: { handle: string }): ExtractRemote<{
    filename: string
    text: string
    truncated: boolean
  }>
}

/** Settled extract handed to the composer. */
export type SessionDocumentExtractOutcome =
  | { readonly ok: true; readonly filename: string; readonly text: string; readonly truncated: boolean }
  | { readonly ok: false; readonly error: string }

/**
 * Upload one browser file through extract remotes and return raw text.
 * @param remotes - session extract remotes.
 * @param file - user-selected file.
 * @returns extracted text or an operator-facing error.
 */
export async function extractSessionDocumentFile(
  remotes: SessionDocumentExtractRemotes,
  file: File,
): Promise<SessionDocumentExtractOutcome> {
  const begun = await remotes.beginExtract({ filename: file.name })
  if (!begun.ok) return { ok: false, error: begun.error.message }
  const bytes = new Uint8Array(await file.arrayBuffer())
  for (const chunk of encodeIngestChunks(bytes)) {
    const appended = await remotes.appendExtractChunk({ handle: begun.value, bytes: chunk })
    if (!appended.ok) return { ok: false, error: appended.error.message }
  }
  const finished = await remotes.finishExtract({ handle: begun.value })
  if (!finished.ok) return { ok: false, error: finished.error.message }
  return { ok: true, ...finished.value }
}
