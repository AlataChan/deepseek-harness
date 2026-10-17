/**
 * Official session-only attachment conversion, caching, and authorized search/read tools.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/session-attachments
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, mkdtemp, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extname, join } from 'node:path'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import { deriveEventMessage, foldSurface, type Session, type SessionId } from '@deepseek-ai/dsh-session'
import { convertSourceFile, type ConversionDiagnostics, type ConversionResult } from './conversion.ts'
import type { AskKnowledgeHomeConfig } from './knowledge-home.ts'
import { resolveKnowledgeHome } from './knowledge-home.ts'
import { DEFAULT_MAX_INGEST_BYTES } from './upload-temp.ts'
import { MAX_CONVERT_OUTPUT_BYTES } from './conversion.ts'

const HMAC_SECRET = randomBytes(32)
const requireConverter = createRequire(import.meta.url)

/** Native dependency and built-in conversion generation used to invalidate derivatives. */
async function converterIdentity(): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(requireConverter.resolve('@firecrawl/anydoc/package.json'), 'utf8')) as { version?: string }
    if (typeof manifest.version !== 'string') throw new Error('Invalid AnyDoc package version')
    return `builtin-2:anydoc-${manifest.version}`
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error
    return 'builtin-2:anydoc-unavailable'
  }
}

/** Normalize an official attachment digest.
 * @param digest - bare or sha256-prefixed content digest.
 * @returns lowercase digest without its prefix.
 */
export function cleanDigest(digest: string): string {
  return digest.trim().replace(/^sha256:/i, '').toLowerCase()
}

/** Collect FileAttachmentRef objects from an event's model-visible content. */
function collectBlocks(content: unknown, files: Map<string, FileAttachmentRef>): void {
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const typedBlock = block as { type?: unknown; attachment?: unknown }
    if (typedBlock.type === 'file' && typeof typedBlock.attachment === 'object' && typedBlock.attachment !== null) {
      const ref = typedBlock.attachment as FileAttachmentRef
      if (typeof ref.attachmentId === 'string' && typeof ref.name === 'string' && typeof ref.bytes === 'number') {
        const id = cleanDigest(String(ref.attachmentId))
        files.set(id, ref)
      }
    }
  }
}

/**
 * Synchronously scan a live session's model-visible history for authorized FileBlock attachments.
 * @param session - live session instance.
 * @returns Map of normalized digest -> FileAttachmentRef.
 */
export function findAuthorizedSessionAttachmentsSync(session?: Session): Map<string, FileAttachmentRef> {
  const files = new Map<string, FileAttachmentRef>()
  if (!session) return files
  for (const message of session.deriveMessages()) collectBlocks(message.content, files)
  return files
}

/**
 * Scan caller session's model-visible history for authorized FileBlock attachments.
 * Plain text mentions or arbitrary files outside model-visible history are excluded.
 * @param ctx - Cordis context.
 * @param sessionId - caller session ID.
 * @param liveSession - optional live session instance.
 * @returns Map of normalized digest -> FileAttachmentRef.
 */
export async function findAuthorizedSessionAttachments(
  ctx: Context,
  sessionId: string,
  liveSession?: Session,
): Promise<Map<string, FileAttachmentRef>> {
  if (!sessionId && !liveSession) return new Map()
  const live = sessionId ? ctx.get('sessions')?.get(sessionId as SessionId) : undefined
  if (liveSession && ctx.get('sessions') && live !== liveSession) return new Map()
  const session = live ?? liveSession
  if (session !== undefined) {
    return findAuthorizedSessionAttachmentsSync(session)
  }

  const files = new Map<string, FileAttachmentRef>()

  // Cold session or after process restart: read from persistence if available
  const persistence = ctx.get('sessionPersistence')
  if (persistence && sessionId) {
    try {
      const handle = await persistence.open(sessionId as SessionId, 'read')
      try {
        const { events } = await handle.read(0, undefined)
        const fold = foldSurface(events, ctx.get('sessions')?.messageProjections)
        const surfaceSeqs = new Set(fold.nodes)
        for (const seq of surfaceSeqs) {
          const event = events[seq]
          if (event) collectBlocks(deriveEventMessage(event, fold.projectedMessages)?.content, files)
        }
      } finally {
        await handle.close()
      }
    } catch {
      // Session does not exist or was deleted; remains empty
    }
  }

  return files
}

/**
 * Match a user or model selector (digest or filename) against authorized attachments.
 * @param authorized - set of authorized FileAttachmentRef from caller session.
 * @param selector - target selector.
 * @returns authorized FileAttachmentRef.
 * @throws AskKnowledgeError if not found, unauthorized, or ambiguous.
 */
export function resolveAuthorizedAttachment(
  authorized: Map<string, FileAttachmentRef>,
  selector: { digest?: string | undefined; filename?: string | undefined },
): FileAttachmentRef {
  if (selector.digest !== undefined && selector.digest.trim() !== '') {
    const targetDigest = cleanDigest(selector.digest)
    const ref = authorized.get(targetDigest)
    if (ref === undefined) {
      throw new AskKnowledgeError('ingest-failed', 'The specified attachment digest is not authorized in this session.')
    }
    return ref
  }

  if (selector.filename !== undefined && selector.filename.trim() !== '') {
    const targetName = selector.filename.trim()
    const matches: FileAttachmentRef[] = []
    for (const ref of authorized.values()) {
      if (ref.name === targetName || ref.name.endsWith(`/${targetName}`) || ref.name.endsWith(`\\${targetName}`)) {
        matches.push(ref)
      }
    }
    if (matches.length === 0) {
      throw new AskKnowledgeError('ingest-failed', `No attachment named "${targetName}" found in this session.`)
    }
    if (matches.length > 1) {
      const digests = matches.map(m => cleanDigest(String(m.attachmentId))).join(', ')
      throw new AskKnowledgeError('ingest-failed', `Multiple attachments match "${targetName}". Please specify digest: ${digests}`)
    }
    return matches[0] as FileAttachmentRef
  }

  // Neither provided: default to the single attachment if exactly one exists
  if (authorized.size === 1) {
    return authorized.values().next().value as FileAttachmentRef
  }
  if (authorized.size === 0) {
    throw new AskKnowledgeError('ingest-failed', 'No attachments found in this session.')
  }
  const choices = [...authorized.values()].map(r => `${r.name} (${cleanDigest(String(r.attachmentId))})`).join(', ')
  throw new AskKnowledgeError('ingest-failed',
    `Multiple attachments available in this session. Please specify filename or digest: ${choices}`)
}

const conversionSchema = z.object({
  status: z.enum(['complete', 'partial', 'needs_ocr', 'unsupported', 'failed', 'unknown']),
  format: z.string(), markdown: z.string(), sha256: z.string(), byteLength: z.number().int().nonnegative(),
  error: z.string().optional(),
  diagnostics: z.object({ warnings: z.array(z.string()), omissions: z.array(z.string()), unsupportedFeatures: z.array(z.string()),
    needsOcrPages: z.array(z.number().int().positive()).optional(), totalPages: z.number().int().nonnegative().optional(),
    decoding: z.string().optional(), nativeDiagnostic: z.string().optional() }),
  blocks: z.array(z.object({ id: z.string(), kind: z.enum(['heading', 'paragraph', 'list', 'table', 'quote', 'code', 'footnote', 'other']),
    text: z.string(), charOffset: z.number().int().nonnegative(), level: z.number().optional(),
    page: z.number().int().positive().optional(),
    locator: z.object({ page: z.number().int().positive().optional(), blockIndex: z.number().optional(), section: z.string().optional(),
      row: z.number().optional(), col: z.number().optional(), sheet: z.string().optional(), noteId: z.string().optional() }).optional() })),
})
const cacheSchema = z.object({ version: z.literal(2), identity: z.string(), resultHash: z.string(), result: conversionSchema })

function assertAdmitted(ref: FileAttachmentRef, limit: number): void {
  if (!/^[a-f0-9]{64}$/.test(cleanDigest(String(ref.attachmentId))) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) {
    throw new AskKnowledgeError('ingest-failed', 'Invalid attachment identity or length')
  }
  if (ref.bytes > limit) throw new AskKnowledgeError('file-too-large', `Attachment retained; conversion limit is ${limit} bytes`)
}

/** Get an integrity-checked conversion or stream the original into private staging.
 * @param config - admission, conversion and cache configuration.
 * @param ctx - context providing the official attachment store.
 * @param ref - authorized original identity.
 * @param signal - caller cancellation.
 * @returns normalized text and completeness diagnostics.
 */
export async function getOrConvertSessionAttachment(
  config: AskKnowledgeHomeConfig,
  ctx: Context,
  ref: FileAttachmentRef,
  signal?: AbortSignal,
): Promise<ConversionResult> {
  const cleanSha = cleanDigest(String(ref.attachmentId))
  const inputLimit = config.maxIngestBytes ?? DEFAULT_MAX_INGEST_BYTES
  const outputLimit = config.maxConvertedBytes ?? MAX_CONVERT_OUTPUT_BYTES
  assertAdmitted(ref, inputLimit)
  signal?.throwIfAborted()
  const cacheDir = join(resolveKnowledgeHome(config), 'attachment-cache')
  await mkdir(cacheDir, { recursive: true, mode: 0o700 })
  await chmod(cacheDir, 0o700)
  const cachePath = join(cacheDir, `${cleanSha}_v2.json`)
  const identity = JSON.stringify({ version: 2, converter: await converterIdentity(), digest: cleanSha, bytes: ref.bytes,
    format: extname(ref.name).toLowerCase(),
    maxConvertedBytes: outputLimit, maxDocxXmlBytes: config.maxDocxXmlBytes ?? null })
  try {
    const info = await stat(cachePath)
    if (info.size <= outputLimit * 4 + 1024 * 1024) {
      const parsed = cacheSchema.safeParse(JSON.parse(await readFile(cachePath, 'utf8')))
      signal?.throwIfAborted()
      if (parsed.success && parsed.data.identity === identity &&
          createHash('sha256').update(JSON.stringify(parsed.data.result)).digest('hex') === parsed.data.resultHash &&
          Buffer.byteLength(parsed.data.result.markdown) <= outputLimit) return parsed.data.result as ConversionResult
    }
  } catch (error) {
    signal?.throwIfAborted()
    // Missing, interrupted or obsolete caches are reconstructed from the official original.
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const tempDir = await mkdtemp(join(cacheDir, '.conversion-'))
  await chmod(tempDir, 0o700)
  try {
    const suffix = extname(ref.name).toLowerCase()
    if (!/^\.[a-z0-9]+$/.test(suffix)) throw new AskKnowledgeError('ingest-failed', 'Unsupported attachment filename extension')
    const tempFile = join(tempDir, `original${suffix}`)
    const attachments = ctx.get('attachments')
    if (!attachments) throw new AskKnowledgeError('ingest-failed', 'Official attachment store is unavailable')
    const file = await open(tempFile, 'wx', 0o600)
    const hasher = createHash('sha256')
    let bytes = 0
    try {
      for await (const chunk of attachments.readFileStream(ref, signal)) {
        signal?.throwIfAborted()
        bytes += chunk.byteLength
        if (bytes > inputLimit || bytes > ref.bytes) throw new AskKnowledgeError('file-too-large',
          'Attachment exceeds conversion admission')
        hasher.update(chunk)
        let offset = 0
        while (offset < chunk.byteLength) {
          const written = await file.write(chunk, offset, chunk.byteLength - offset)
          offset += written.bytesWritten
        }
      }
      if (bytes !== ref.bytes || hasher.digest('hex') !== cleanSha) throw new AskKnowledgeError('ingest-failed',
        'Attachment digest or length mismatch')
      await file.sync()
    } finally { await file.close() }
    signal?.throwIfAborted()
    const result = await convertSourceFile(config, tempFile, ref.name, { signal, timeoutMs: config.conversionTimeoutMs,
      maxBytes: outputLimit })
    signal?.throwIfAborted()
    if (Buffer.byteLength(result.markdown) > outputLimit) throw new AskKnowledgeError('ingest-failed',
      'Converted attachment exceeds output allowance')
    const cachedResult = conversionSchema.parse(result)
    const serialized = JSON.stringify(cachedResult)
    const cacheFile = join(tempDir, 'cache.json')
    const staged = await open(cacheFile, 'wx', 0o600)
    try {
      await staged.writeFile(JSON.stringify({ version: 2, identity,
        resultHash: createHash('sha256').update(serialized).digest('hex'), result: cachedResult }))
      await staged.sync()
    } finally { await staged.close() }
    signal?.throwIfAborted()
    await rename(cacheFile, cachePath)
    return result
  } finally { await rm(tempDir, { recursive: true, force: true }) }
}

/** Evict converted derivatives without deleting official originals.
 * @param config - private knowledge home.
 * @param digest - one digest, or omit to clear all derivatives.
 */
export async function evictSessionAttachmentCache(config: AskKnowledgeHomeConfig, digest?: string): Promise<void> {
  const cacheDir = join(resolveKnowledgeHome(config), 'attachment-cache')
  if (digest !== undefined) {
    const sha = cleanDigest(digest)
    if (!/^[a-f0-9]{64}$/.test(sha)) throw new AskKnowledgeError('ingest-failed', 'Invalid attachment digest')
    await rm(join(cacheDir, `${sha}_v1.json`), { force: true })
    await rm(join(cacheDir, `${sha}_v2.json`), { force: true })
  } else {
    await rm(cacheDir, { recursive: true, force: true })
  }
}

/** Sign a session-scoped document continuation.
 * @param payload - document, operation and exact continuation offsets.
 * @returns opaque authenticated cursor.
 */
export function encodeSessionDocCursor(payload: {
  digest: string
  offset: number
  sessionId: string
  operation?: string
  textOffset?: number
}): string {
  const data = JSON.stringify([payload.sessionId, payload.digest, payload.offset, payload.operation ?? 'read', payload.textOffset ?? 0])
  const sig = createHmac('sha256', HMAC_SECRET).update(data).digest('hex')
  return Buffer.from(JSON.stringify({ s: payload.sessionId, d: payload.digest, o: payload.offset, c: payload.operation ?? 'read',
    t: payload.textOffset ?? 0, h: sig })).toString('base64url')
}

/** Verify and decode a document continuation.
 * @param cursor - opaque cursor from a previous result.
 * @param expectedSessionId - authorized caller session.
 * @returns authenticated offsets, digest and operation identity.
 */
export function decodeSessionDocCursor(cursor: string, expectedSessionId: string): {
  digest: string
  offset: number
  operation: string
  textOffset: number
} {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = JSON.parse(raw) as { s?: string; d?: string; o?: number; h?: string; c?: string; t?: number }
    if (typeof parsed.s !== 'string' || typeof parsed.d !== 'string' || typeof parsed.o !== 'number' ||
      typeof parsed.h !== 'string' || typeof parsed.c !== 'string' || !Number.isSafeInteger(parsed.o) || parsed.o < 0 ||
        typeof parsed.t !== 'number' || !Number.isSafeInteger(parsed.t) || parsed.t < 0) {
      throw new Error('malformed cursor')
    }
    if (parsed.s !== expectedSessionId) {
      throw new AskKnowledgeError('ingest-failed', 'Cursor is bound to another session')
    }
    const data = JSON.stringify([parsed.s, parsed.d, parsed.o, parsed.c, parsed.t])
    const expectedSig = createHmac('sha256', HMAC_SECRET).update(data).digest('hex')
    const sigBuf = Buffer.from(parsed.h, 'hex')
    const expBuf = Buffer.from(expectedSig, 'hex')
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new AskKnowledgeError('ingest-failed', 'Cursor signature verification failed')
    }
    return { digest: parsed.d, offset: parsed.o, operation: parsed.c, textOffset: parsed.t }
  } catch (error) {
    if (error instanceof AskKnowledgeError) throw error
    throw new AskKnowledgeError('ingest-failed', 'Invalid cursor')
  }
}

/** Diagnostics formatted for tool return. */
export interface SessionDocDiagnostics {
  warnings: string[]
  omissions: string[]
  unsupportedFeatures: string[]
  needsOcrPages?: number[]
  totalPages?: number
  decoding?: string
  nativeDiagnostic?: string
}

function formatSessionDocDiagnostics(d: ConversionDiagnostics): SessionDocDiagnostics {
  return {
    warnings: [...d.warnings],
    omissions: [...d.omissions],
    unsupportedFeatures: [...d.unsupportedFeatures],
    ...d.needsOcrPages !== undefined ? { needsOcrPages: [...d.needsOcrPages] } : {},
    ...d.totalPages !== undefined ? { totalPages: d.totalPages } : {},
    ...d.decoding !== undefined ? { decoding: d.decoding } : {},
    ...d.nativeDiagnostic !== undefined ? { nativeDiagnostic: d.nativeDiagnostic } : {},
  }
}

/** Serialized model-visible payload, including the content-block wrapper. */
function emittedBytes(value: object): number {
  return Buffer.byteLength(JSON.stringify([{ type: 'text', text: JSON.stringify(value) }]))
}

function fitText<T extends object>(text: string, make: (text: string) => T, maxBytes: number): T {
  const chars = [...text]
  let low = 0, high = chars.length
  if (emittedBytes(make('')) > maxBytes) throw new AskKnowledgeError('ingest-failed', 'Document metadata exceeds result allowance')
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (emittedBytes(make(chars.slice(0, mid).join(''))) <= maxBytes) low = mid
    else high = mid - 1
  }
  if (!low && chars.length) throw new AskKnowledgeError('ingest-failed', 'Document text cannot fit result allowance')
  return make(chars.slice(0, low).join(''))
}

/** Bounded session-document read with conversion diagnostics and exact continuation. */
export interface SessionDocumentReadResult {
  action: 'read'
  filename: string
  digest: string
  status: ConversionResult['status']
  charOffset: number
  totalChars: number
  text: string
  page?: number
  cursor?: string
  diagnostics: SessionDocDiagnostics
}

/** Bounded matching document range; missing pagination is represented by an absent page. */
export interface SessionDocumentSearchResult {
  action: 'search'
  filename: string
  digest: string
  status: ConversionResult['status']
  totalMatches: number
  items: Array<{ locator: string; page?: number; text: string; charOffset: number; kind: string }>
  cursor?: string
  diagnostics: SessionDocDiagnostics
}

function boundedText(text: string, offset: number, limit: number): string {
  const end = Math.min(text.length, offset + limit)
  const last = text.charCodeAt(end - 1)
  return text.slice(offset, last >= 0xd800 && last <= 0xdbff ? end - 1 : end)
}

/** Read a bounded full-document or page range.
 * @param converted - normalized conversion and diagnostics.
 * @param ref - authorized original file.
 * @param sessionId - caller session.
 * @param options - page selection, continuation and complete payload allowance.
 * @returns rendered-data fields with an exact continuation for omitted text.
 */
export function readSessionAttachment(
  converted: ConversionResult, ref: FileAttachmentRef, sessionId: string,
  options: { offset?: number; limitChars?: number; page?: number; cursor?: string; maxBytes?: number } = {},
): SessionDocumentReadResult {
  const digest = cleanDigest(String(ref.attachmentId))
  const decoded = options.cursor ? decodeSessionDocCursor(options.cursor, sessionId) : undefined
  if (decoded && decoded.digest !== digest) throw new AskKnowledgeError('ingest-failed', 'Cursor belongs to another document')
  const operation = decoded?.operation ?? (options.page ? `read:page:${options.page}` : 'read')
  if (operation !== 'read' && !/^read:page:[1-9][0-9]*$/.test(operation)) throw new AskKnowledgeError('ingest-failed',
    'Cursor belongs to a different operation')
  if (options.page && operation !== `read:page:${options.page}`) throw new AskKnowledgeError('ingest-failed', 'Cursor page changed')
  const page = operation === 'read' ? undefined : Number(operation.slice('read:page:'.length))
  const text = page === undefined ? converted.markdown : converted.blocks.filter(b => b.page === page ||
    b.locator?.page === page).map(b => b.text).join('\n\n')
  const offset = decoded?.offset ?? options.offset ?? 0
  if (offset > text.length) throw new AskKnowledgeError('ingest-failed', 'Cursor outside document range')
  const limit = Math.min(options.limitChars ?? 3000, 4000)
  const make = (slice: string) => ({ action: 'read' as const, filename: ref.name, digest, status: converted.status,
    charOffset: offset, totalChars: text.length, text: slice,
    ...page === undefined ? {} : { page },
    ...offset + slice.length < text.length ? { cursor: encodeSessionDocCursor({ digest, offset: offset + slice.length, sessionId,
      operation }) } : {},
    diagnostics: formatSessionDocDiagnostics(converted.diagnostics) })
  return fitText(boundedText(text, offset, limit), make, options.maxBytes ?? 6000)
}

/** Search bounded ranges with continuation inside oversized matching blocks.
 * @param converted - normalized conversion and diagnostics.
 * @param ref - authorized original file.
 * @param sessionId - caller session.
 * @param query - search text bound into the continuation identity.
 * @param options - continuation and complete payload allowance.
 * @returns matching text with authentic locators and continuation.
 */
export function searchSessionAttachment(
  converted: ConversionResult, ref: FileAttachmentRef, sessionId: string, query: string,
  options: { offset?: number; limit?: number; limitChars?: number; cursor?: string; maxBytes?: number } = {},
): SessionDocumentSearchResult {
  const digest = cleanDigest(String(ref.attachmentId))
  const operation = `search:${createHash('sha256').update(query).digest('hex')}`
  const decoded = options.cursor ? decodeSessionDocCursor(options.cursor, sessionId) : undefined
  if (decoded && (decoded.digest !== digest || decoded.operation !== operation)) throw new AskKnowledgeError('ingest-failed',
    'Cursor query or document changed')
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = converted.blocks.filter(b => !tokens.length || tokens.some(t => b.text.toLowerCase().includes(t)))
  const index = decoded?.offset ?? options.offset ?? 0
  const offset = decoded?.textOffset ?? 0
  if (index > matches.length) throw new AskKnowledgeError('ingest-failed', 'Cursor outside search results')
  const block = matches[index]
  const page = block?.page ?? block?.locator?.page
  const make = (slice: string) => {
    const nextIndex = block && offset + slice.length < block.text.length ? index : index + 1
    const nextTextOffset = nextIndex === index ? offset + slice.length : 0
    return { action: 'search' as const, filename: ref.name, digest, status: converted.status, totalMatches: matches.length,
      items: block ? [{ locator: `${page ? `p${page}_` : ''}o${block.charOffset + offset}`, ...page === undefined ? {} : { page },
        text: slice, charOffset: block.charOffset + offset, kind: block.kind }] : [],
      ...block && nextIndex < matches.length ? { cursor: encodeSessionDocCursor({ digest, sessionId, operation,
        offset: nextIndex, textOffset: nextTextOffset }) } : {},
      diagnostics: formatSessionDocDiagnostics(converted.diagnostics) }
  }
  return fitText(block ? boundedText(block.text, offset, Math.min(options.limitChars ?? 3000, 4000)) : '', make, options.maxBytes ?? 6000)
}

/** Describe authorized attachment tools without embedding original bytes.
 * @param authorized - FileBlocks from current model-visible history.
 * @returns prompt section naming the attachment tools and selectors.
 */
export function renderSessionAttachmentsPrompt(authorized: Map<string, FileAttachmentRef>): string {
  const names = [...authorized.values()].map(a => `${a.name} (${cleanDigest(String(a.attachmentId)).slice(0, 8)})`).join(', ')
  return [
    `当前会话包含已上传的附件文档：${names}。`,
    '当用户询问附件文档内容时，请调用 ask_knowledge_session_document 工具。',
    '可通过 filename 或 digest 指定目标文档进行检索（action="search"）或连续翻页阅读（action="read"）。',
    '阅读长文档时如果返回 cursor，可带上相同 cursor 继续读取后续段落。',
  ].join('\n')
}
