/**
 * Client-side ingest filename and chunking for the library picker.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/client/ingest-file
 */

import { encodeAskKnowledgeBytes } from './bytes.ts'

/** Decoded size of one append chunk. Must match the Host assembler. */
export const MAX_INGEST_CHUNK_BYTES = 160 * 1024

/** Extensions the Host assembler and sidecar converters accept. Must match `upload-temp`. */
export const ACCEPTED_INGEST_EXTENSIONS = ['.md', '.txt', '.html', '.htm', '.pdf', '.csv', '.json', '.xlsx'] as const

/** `accept` value for the picker file input. */
export const ACCEPTED_INGEST_ACCEPT = ACCEPTED_INGEST_EXTENSIONS.join(',')

/**
 * Whether `extension` is an accepted ingest suffix.
 * @param extension - lowercase suffix including the leading dot.
 * @returns true when the Host assembler will accept the file.
 */
export function isAcceptedIngestExtension(extension: string): boolean {
  return (ACCEPTED_INGEST_EXTENSIONS as readonly string[]).includes(extension)
}

/**
 * Lowercase extension of a browser filename, including the dot.
 * @param filename - `File.name` from the file input.
 * @returns the extension, or an empty string when the name has no dot.
 */
export function ingestFilenameExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

/**
 * Filename without its last extension, for the catalog display name.
 * @param filename - `File.name` from the file input.
 * @returns the stem, which may be empty for a name that is only an extension.
 */
export function ingestFilenameStem(filename: string): string {
  const extension = ingestFilenameExtension(filename)
  return (extension === '' ? filename : filename.slice(0, -extension.length)).trim()
}

/**
 * Whether a catalog name is still the untitled placeholder, including leftover
 * 「新建知识库」 rows from earlier builds.
 * @param name - catalog display name.
 * @param untitled - current-locale untitled prefix, e.g. 未命名知识库.
 * @returns true when a successful ingest should still rename the row.
 */
export function isDefaultLibraryName(name: string, untitled: string): boolean {
  return name === untitled
    || name.startsWith(`${untitled} `)
    || name === '新建知识库'
    || name.startsWith('新建知识库 ')
}

/**
 * Next unused catalog display name.
 * @param existing - names already in the list.
 * @param base - preferred name.
 * @returns `base`, or `base 2`, `base 3`, …
 */
export function unusedLibraryName(existing: readonly string[], base: string): string {
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${String(index)}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Split decoded bytes into canonical-base64 chunks of at most 160KiB.
 * An empty file yields one empty chunk so `append` still runs.
 * @param bytes - decoded file bytes.
 * @returns wire `bytes` fields for `appendAskKnowledgeIngestChunk`.
 */
export function encodeIngestChunks(bytes: Uint8Array): string[] {
  const chunks: string[] = []
  for (let index = 0; index < bytes.byteLength; index += MAX_INGEST_CHUNK_BYTES) {
    chunks.push(encodeAskKnowledgeBytes(bytes.subarray(index, index + MAX_INGEST_CHUNK_BYTES)))
  }
  if (chunks.length === 0) chunks.push(encodeAskKnowledgeBytes(new Uint8Array()))
  return chunks
}
