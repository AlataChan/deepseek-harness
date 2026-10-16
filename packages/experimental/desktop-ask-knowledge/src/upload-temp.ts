/**
 * Private ingest upload directory under knowledgeHome/tmp/.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/upload-temp
 */

import { randomUUID } from 'node:crypto'
import { mkdir, open, rm } from 'node:fs/promises'
import { closeSync, constants, openSync, ftruncateSync, writeSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { AskKnowledgeError, AskKnowledgeIngestHandle, AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'

/** Decoded size of one append chunk. */
export const MAX_INGEST_CHUNK_BYTES = 160 * 1024

/** Default assembled-file cap. */
export const DEFAULT_MAX_INGEST_BYTES = 20 * 1024 * 1024

/** Extensions `beginIngest` accepts. Host unzips `.docx` to markdown before sidecar `ingest-file`. `.xls` is rejected; use `.xlsx`. */
export const ACCEPTED_INGEST_EXTENSIONS = ['.md', '.txt', '.html', '.htm', '.pdf', '.docx', '.csv', '.json', '.xlsx'] as const

/** Extensions session-only extract accepts. Spreadsheets stay on ask-data. */
export const ACCEPTED_EXTRACT_EXTENSIONS = ['.md', '.txt', '.html', '.htm', '.pdf', '.docx'] as const

/** Sentinel library id stored on extract uploads. Never written to catalog.json. */
export const EXTRACT_LIBRARY_ID = AskKnowledgeLibraryId('session-extract')

/** Private disk upload assembled from bounded Remote chunks. */
export interface IngestUpload {
  readonly handle: AskKnowledgeIngestHandle
  readonly libraryId: AskKnowledgeLibraryId
  readonly filename: string
  readonly dir: string
  readonly path: string
  bytes: number
}

/**
 * Validate the original filename and return its basename + extension.
 * @param filename - user-supplied name.
 * @returns basename and lowercase extension.
 */
function parseSafeBasename(filename: string): { basename: string; extension: string } {
  if (filename.includes('\0') || filename.includes('..') || isAbsolute(filename)) {
    throw new AskKnowledgeError('path-escape', 'filename is not a safe basename')
  }
  const name = basename(filename)
  if (name === '' || name === '.' || name === '..') {
    throw new AskKnowledgeError('path-escape', 'filename is not a safe basename')
  }
  const dot = name.lastIndexOf('.')
  const extension = dot >= 0 ? name.slice(dot).toLowerCase() : ''
  return { basename: name, extension }
}

/**
 * Validate the original filename and return its basename + extension.
 * @param filename - user-supplied name.
 * @returns basename and lowercase extension.
 */
export function parseIngestFilename(filename: string): { basename: string; extension: string } {
  const parsed = parseSafeBasename(filename)
  if (!ACCEPTED_INGEST_EXTENSIONS.includes(parsed.extension as typeof ACCEPTED_INGEST_EXTENSIONS[number])) {
    throw new AskKnowledgeError('type-unsupported', `extension ${parsed.extension || '(none)'} is not accepted`)
  }
  return parsed
}

/**
 * Validate a session-only extract filename. Rejects spreadsheets.
 * @param filename - user-supplied name.
 * @returns basename and lowercase extension.
 */
export function parseExtractFilename(filename: string): { basename: string; extension: string } {
  const parsed = parseSafeBasename(filename)
  if (!ACCEPTED_EXTRACT_EXTENSIONS.includes(parsed.extension as typeof ACCEPTED_EXTRACT_EXTENSIONS[number])) {
    throw new AskKnowledgeError('type-unsupported', `extension ${parsed.extension || '(none)'} is not accepted`)
  }
  return parsed
}

/**
 * Decode one canonical base64 chunk and enforce the 160KiB decoded cap.
 * @param bytes - wire field.
 * @returns decoded buffer.
 */
export function decodeIngestChunk(bytes: unknown): Buffer {
  if (typeof bytes !== 'string') {
    throw new AskKnowledgeError('chunk-too-large', 'bytes must be canonical base64')
  }
  if (bytes.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bytes)) {
    throw new AskKnowledgeError('chunk-too-large', 'bytes must be canonical base64')
  }
  const buf = Buffer.from(bytes, 'base64')
  if (buf.toString('base64') !== bytes) {
    throw new AskKnowledgeError('chunk-too-large', 'bytes must be canonical base64')
  }
  if (buf.byteLength > MAX_INGEST_CHUNK_BYTES) {
    throw new AskKnowledgeError('chunk-too-large', `chunk exceeds ${MAX_INGEST_CHUNK_BYTES} bytes`, {
      limit: MAX_INGEST_CHUNK_BYTES,
    })
  }
  return buf
}

/**
 * Create a private temp directory and an empty upload record.
 * @param knowledgeHome - resolved app-data directory.
 * @param libraryId - target library or the extract sentinel.
 * @param parsed - already-validated basename.
 * @returns the upload record.
 */
async function createUpload(
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  parsed: { basename: string },
): Promise<IngestUpload> {
  const root = join(resolve(knowledgeHome), 'tmp')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const dir = join(root, randomUUID())
  await mkdir(dir, { mode: 0o700 })
  const file = await open(join(dir, parsed.basename), 'wx', 0o600)
  await file.close()
  const handle = AskKnowledgeIngestHandle(randomUUID())
  return {
    handle,
    libraryId,
    filename: parsed.basename,
    dir,
    path: join(dir, parsed.basename),
    bytes: 0,
  }
}

/**
 * Create a private temp directory and an empty upload record.
 * @param knowledgeHome - resolved app-data directory.
 * @param libraryId - target library.
 * @param filename - original basename.
 * @returns the upload record.
 */
export async function beginUpload(
  knowledgeHome: string,
  libraryId: AskKnowledgeLibraryId,
  filename: string,
): Promise<IngestUpload> {
  return createUpload(knowledgeHome, libraryId, parseIngestFilename(filename))
}

/**
 * Create a private temp upload that is not bound to a catalog library.
 * @param knowledgeHome - resolved app-data directory.
 * @param filename - original basename.
 * @returns the upload record.
 */
export async function beginExtractUpload(
  knowledgeHome: string,
  filename: string,
): Promise<IngestUpload> {
  return createUpload(knowledgeHome, EXTRACT_LIBRARY_ID, parseExtractFilename(filename))
}

/**
 * Append one decoded chunk.
 * @param upload - in-flight upload.
 * @param chunk - decoded bytes.
 * @param maxBytes - assembled-file cap.
 */
export function appendUpload(upload: IngestUpload, chunk: Buffer, maxBytes: number): void {
  if (upload.bytes + chunk.byteLength > maxBytes) {
    throw new AskKnowledgeError('file-too-large', `file exceeds ${maxBytes} bytes`, { limit: maxBytes })
  }
  const fd = openSync(upload.path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW)
  try {
    let offset = 0
    while (offset < chunk.byteLength) offset += writeSync(fd, chunk, offset, chunk.byteLength - offset)
    upload.bytes += chunk.byteLength
  } catch (error) {
    ftruncateSync(fd, upload.bytes)
    throw error
  } finally {
    closeSync(fd)
  }
}

/**
 * Flush accepted chunks to disk before conversion or immutable publication.
 * @param upload - in-flight upload.
 * @returns absolute temp file path.
 */
export async function materializeUpload(upload: IngestUpload): Promise<string> {
  const file = await open(upload.path, constants.O_RDWR | constants.O_NOFOLLOW)
  try { await file.sync() } finally { await file.close() }
  return upload.path
}

/**
 * Delete the temp directory. Missing directories are success.
 * @param upload - in-flight upload.
 */
export async function disposeUpload(upload: IngestUpload): Promise<void> {
  await rm(upload.dir, { recursive: true, force: true })
}
