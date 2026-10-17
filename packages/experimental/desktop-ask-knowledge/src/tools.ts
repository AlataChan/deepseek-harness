/**
 * ask_knowledge_retrieve / ask_knowledge_lookup / ask_knowledge_read.
 * Implements wiki-first answering, same-turn attempt receipts, and source fallback.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/tools
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { knowledgeResultBytes, resolveResultBounds } from './result-bounds.ts'
import type { Session } from '@deepseek-ai/dsh-session'
import type { PassageSearchItem, PassageSearchRequest, PassageSearchResult, PassageReadRequest, WikiLookupRequest,
  WikiLookupResult } from './document-retrieve.ts'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  AskKnowledgeError,
  parseAskKnowledgeLookupTerm,
  parseAskKnowledgeTerms,
} from '@deepseek-ai/dsh-host-ask-knowledge'
import type { AskKnowledge, AskKnowledgeLookup } from '@deepseek-ai/dsh-host-ask-knowledge'
import { AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import type { AskKnowledgeHomeConfig } from './knowledge-home.ts'
import {
  cleanDigest,
  findAuthorizedSessionAttachments,
  getOrConvertSessionAttachment,
  readSessionAttachment,
  resolveAuthorizedAttachment,
  searchSessionAttachment,
} from './session-attachments.ts'

const TERMS_ERROR = '请改用 1 到 6 个专名，不要整句。'
const UNBOUND_ERROR = '先在上方挂上一个知识库。'

/** Typed failure for same-turn wiki attempt receipt verification. */
export class WikiAttemptError extends Error {
  /** Stable tool denial code. */
  readonly code: 'wiki-attempt-required' | 'wiki-attempt-invalid' | 'wiki-attempt-stale'
  constructor(code: 'wiki-attempt-required' | 'wiki-attempt-invalid' | 'wiki-attempt-stale', message: string) {
    super(message)
    this.name = 'WikiAttemptError'
    this.code = code
  }
}


/** Pluggable passage and wiki providers passed to tool registration. */
export interface AskKnowledgeToolPassages {
  search(request: PassageSearchRequest, signal?: AbortSignal): Promise<PassageSearchResult>
  read(request: PassageReadRequest, signal?: AbortSignal): Promise<PassageSearchResult>
  lookup?(request: WikiLookupRequest, signal?: AbortSignal): Promise<WikiLookupResult>
}

/** Issued wiki receipt metadata; only a corresponding logged result authorizes source access. */
export interface WikiAttemptReceipt {
  readonly attemptId: string
  readonly libraryId: string
  readonly sessionId: string
  readonly turn: number
  readonly timestamp: number
  readonly status: 'hit' | 'no-hit' | 'unavailable'
  readonly query: readonly string[]
}

/** Store and mechanical validator for same-turn wiki attempt receipts. */
export class WikiAttemptStore {
  private readonly receipts = new Map<string, WikiAttemptReceipt>()

  /** Record a pending receipt for diagnostics; logged history remains authoritative.
   * @param receipt - issued wiki receipt.
   */
  record(receipt: WikiAttemptReceipt): void {
    this.receipts.set(receipt.attemptId, receipt)
    if (this.receipts.size > 1000) {
      const now = Date.now()
      for (const [id, r] of this.receipts) {
        if (now - r.timestamp > 3600_000) this.receipts.delete(id)
      }
    }
  }

  /** Retrieve a pending receipt.
   * @param attemptId - receipt identity.
   * @returns issued receipt, when present in this runtime.
   */
  get(attemptId: string): WikiAttemptReceipt | undefined {
    return this.receipts.get(attemptId)
  }

  /**
   * Mechanically verify an attempt receipt.
   * @param attemptId - pending receipt identity.
   * @param sessionId - expected session.
   * @param libraryId - expected library.
   * @param turn - current turn.
   * @returns matching issued receipt; durable source admission is checked separately.
   */
  verifyAttempt(attemptId: string, sessionId: string, libraryId: string, turn: number): WikiAttemptReceipt {
    const receipt = this.receipts.get(attemptId)
    if (receipt === undefined) {
      throw new WikiAttemptError('wiki-attempt-invalid', 'Fabricated or unknown wiki attempt receipt rejected.')
    }
    if (receipt.libraryId !== libraryId) {
      throw new WikiAttemptError('wiki-attempt-invalid', 'Wiki attempt receipt belongs to another library.')
    }
    if (receipt.sessionId !== sessionId) {
      throw new WikiAttemptError('wiki-attempt-invalid', 'Wiki attempt receipt belongs to another session.')
    }
    if (receipt.turn !== turn) {
      throw new WikiAttemptError('wiki-attempt-stale',
        'Wiki attempt receipt is from a previous turn; a new wiki attempt is required in each turn.')
    }
    return receipt
  }
}

function sourceEvidence(item: PassageSearchItem): { sourceRevision: string; sourceStart: number; sourceEnd: number } | undefined {
  if (!item.path.startsWith('raw/') || !item.sourceRevision || !/^sha256:[a-f0-9]{64}$/.test(item.sourceRevision) ||
      item.sourceStart === undefined || item.sourceEnd === undefined || !Number.isSafeInteger(item.sourceStart) ||
      !Number.isSafeInteger(item.sourceEnd) || item.sourceStart < 0 ||
        item.sourceEnd - item.sourceStart !== [...item.text].length) return undefined
  return { sourceRevision: item.sourceRevision, sourceStart: item.sourceStart, sourceEnd: item.sourceEnd }
}

const loggedAttemptSchema = z.object({ wikiAttempt: z.object({
  attemptId: z.string(), libraryId: z.string(), sessionId: z.string(), turn: z.number().int(),
  status: z.enum(['hit', 'no-hit', 'unavailable']),
}) })

function requireLoggedWikiAttempt(session: Session | undefined, libraryId: string, turn: number, attemptId?: string): void {
  if (session) {
    for (const event of session.snapshotEvents()) {
      if (event.type !== 'tool/result' || event.data.turn !== turn || event.data.message.isError ||
          !event.sourceEventSeqs?.some((seq) => {
            const call = session.eventAt(seq)
            return call?.type === 'tool/call' && call.data.turn === turn && call.data.name === 'ask_knowledge_retrieve' &&
              call.data.callId === event.data.message.toolCallId
          })) continue
      for (const block of event.data.message.content) {
        if (block.type !== 'text') continue
        let body: unknown
        const prefix = '<external-data>\n'
        const suffix = '\n</external-data>'
        const text = block.text.startsWith(prefix) && block.text.endsWith(suffix)
          ? block.text.slice(prefix.length, -suffix.length) : block.text
        try { body = JSON.parse(text) } catch (error) {
          // Legacy or failed tool output contains no reusable wiki receipt.
          if (error instanceof SyntaxError) continue
          throw error
        }
        const parsed = loggedAttemptSchema.safeParse(body)
        if (!parsed.success) continue
        const receipt = parsed.data.wikiAttempt
        if (receipt.sessionId === session.id && receipt.libraryId === libraryId && receipt.turn === turn &&
            (attemptId === undefined || attemptId === receipt.attemptId)) return
      }
    }
  }
  throw new WikiAttemptError(attemptId ? 'wiki-attempt-invalid' : 'wiki-attempt-required',
    `${attemptId ? 'Fabricated or unknown wiki receipt. ' : ''}A successful logged wiki result from this session, library and turn is required before source access.`)
}

/**
 * Determine the current turn number for a live session.
 * @param ctx - Cordis context.
 * @param session - live or detached session.
 * @returns turn index (defaults to 0 when unstarted).
 */
export function currentTurnOf(ctx: Context, session: { id: string } | undefined): number {
  if (session === undefined) return 0
  const live = ctx.get('sessions')?.get(session.id as never)
  if (live === undefined) return 0
  const boundary = ctx.sessionProjections?.stateOf?.(live, 'turnBoundary') as { lastTurn?: number } | undefined
  if (typeof boundary?.lastTurn === 'number') {
    return boundary.lastTurn
  }
  for (const event of [...live.snapshotEvents()].reverse()) {
    if (event.type === 'turn/start') return event.data.turn
  }
  return 0
}

/**
 * Register retrieve, lookup, read, and session document tools. Disposed with the plugin fiber.
 * @param ctx - Host context.
 * @param passages - authorized bounded search and read operations.
 * @param attempts - optional attempt receipt store.
 * @param config - optional plugin configuration.
 * @returns disposer.
 */
export function registerAskKnowledgeTools(
  ctx: Context,
  passages?: AskKnowledgeToolPassages,
  attempts?: WikiAttemptStore,
  config?: AskKnowledgeHomeConfig,
): () => void {
  const tools = ctx.get('tools')
  if (tools === undefined) return () => {}
  const attemptStore = attempts ?? new WikiAttemptStore()
  const bounds = resolveResultBounds({ maxTokens: config?.maxResultTokens, maxChars: config?.maxResultChars,
    maxItems: config?.maxResultItems })
  // The conservative estimator charges one token per serialized UTF-8 byte.
  const maxSerializedBytes = bounds.maxTokens
  const renderJson = (value: object): string => {
    const text = JSON.stringify(value)
    if (knowledgeResultBytes(value) > maxSerializedBytes) throw new AskKnowledgeError('ingest-failed', 'Tool result metadata exceeds its serialized allowance')
    return text
  }

  const retrieve = tools.register(defineTool({
    name: 'ask_knowledge_retrieve',
    description:
      'Search the hung knowledge library. Pass 1 to 6 names in terms, not a sentence. Searches Wiki first; source fallback requires a same-turn wiki attempt.',
    parameters: {
      cursor: { type: 'string', description: 'Opaque continuation returned by this search; keep terms and documentFilter unchanged.' },
      documentFilter: { type: 'string', description: 'Optional raw path from an earlier result.' },
      mode: {
        type: 'string',
        enum: ['wiki', 'source'],
        description: 'Optional search mode: "wiki" (default) searches wiki concepts, entities, and index first. "source" searches raw source documents as fallback and requires wikiAttemptId.',
      },
      wikiAttemptId: {
        type: 'string',
        description: 'Receipt ID from an earlier same-turn wiki attempt; required when mode is "source".',
      },
      fallbackReason: {
        type: 'string',
        description: 'Optional model explanation for source fallback (e.g. citation verification, contradiction, or explicit user request).',
      },
      terms: {
        type: 'array',
        required: true,
        description: 'One to six names. No sentence punctuation.',
        items: { type: 'string', description: 'One name.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cursor: { type: 'string' },
          totalMatches: { type: 'integer' },
          generationId: { type: 'string' },
          wikiAttemptId: { type: 'string' },
          wikiAttempt: { type: 'object', additionalProperties: false, properties: {
            attemptId: { type: 'string', required: true }, libraryId: { type: 'string', required: true },
            sessionId: { type: 'string', required: true }, turn: { type: 'integer', required: true },
            status: { type: 'string', required: true },
          } },
          fallbackReason: { type: 'string' },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                title: { type: 'string', required: true },
                reason: { type: 'string', required: true },
                text: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                passageId: { type: 'string' },
                verification: { type: 'string' },
                sourceRevision: { type: 'string' }, sourceStart: { type: 'integer' }, sourceEnd: { type: 'integer' },
                citations: { type: 'array', items: { type: 'string' } },
                relatedLinks: { type: 'array', items: { type: 'string' } },
                coverageStatus: { type: 'string' },
              },
            },
          },
          warnings: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ruleId: { type: 'string', required: true },
                message: { type: 'string', required: true },
              },
            },
          },
          tokenEstimate: { type: 'integer', required: true },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderJson(value) }]
      },
    },
    presentCall: () => ({ card: 'generic', title: 'ask_knowledge_retrieve' }),
    presentResult: () => ({ card: 'generic' }),
    async execute(args, exec) {
      const terms = parseTermsOrThrow(args)
      const capability = requireCapability(ctx)
      const libraryId = boundLibraryId(ctx, exec.agent?.session)
      const sessionId = exec.agent?.session?.id ?? ''
      const currentTurn = currentTurnOf(ctx, exec.agent?.session)
      const rawArgs = (args && typeof args === 'object') ? (args as Record<string, unknown>) : {}
      const mode = rawArgs.mode === 'source' ? 'source' : 'wiki'

      if (passages !== undefined) {
        if (mode === 'source') {
          const attemptId = typeof rawArgs.wikiAttemptId === 'string' ? rawArgs.wikiAttemptId : undefined
          if (attemptId && attemptStore.get(attemptId)) attemptStore.verifyAttempt(attemptId, sessionId, libraryId, currentTurn)
          requireLoggedWikiAttempt(exec.agent?.session, libraryId, currentTurn, attemptId)
          const result = await passages.search({
            libraryId,
            queries: terms,
            layer: 'raw',
            ...typeof rawArgs.cursor === 'string' ? { cursor: rawArgs.cursor } : {},
            ...typeof rawArgs.documentFilter === 'string' ? { documentFilter: rawArgs.documentFilter } : {},
          }, exec.signal)
          return {
            items: result.items.map(item => ({
              path: item.path,
              title: item.title,
              text: item.text,
              kind: item.kind,
              passageId: item.passageId,
              reason: 'source fallback',
              verification: sourceEvidence(item) ? 'source-verified' : 'unverified-source-excerpt',
              ...sourceEvidence(item),
              ...item.citations ? { citations: [...item.citations] } : {},
            })),
            warnings: [...result.warnings],
            tokenEstimate: result.tokenEstimate,
            totalMatches: result.totalMatches,
            generationId: result.generationId,
            ...result.cursor === null ? {} : { cursor: result.cursor },
            ...typeof rawArgs.fallbackReason === 'string' ? { fallbackReason: rawArgs.fallbackReason } : {},
          }
        }

        // mode === 'wiki'
        const result = await passages.search({
          libraryId,
          queries: terms,
          layer: 'wiki',
          ...typeof rawArgs.cursor === 'string' ? { cursor: rawArgs.cursor } : {},
          ...typeof rawArgs.documentFilter === 'string' ? { documentFilter: rawArgs.documentFilter } : {},
        }, exec.signal)

        const isWikiUnavailable = result.warnings.some(w => w.ruleId === 'wiki_unavailable')
        const attemptId = `wka-${randomUUID()}`
        const receiptStatus = result.items.length > 0 ? 'hit' : (isWikiUnavailable ? 'unavailable' : 'no-hit')
        attemptStore.record({
          attemptId,
          libraryId,
          sessionId,
          turn: currentTurn,
          timestamp: Date.now(),
          status: receiptStatus,
          query: terms,
        })


        return {
          wikiAttemptId: attemptId,
          wikiAttempt: { attemptId, libraryId, sessionId, turn: currentTurn, status: receiptStatus },
          items: result.items.map(item => ({
            path: item.path,
            title: item.title,
            text: item.text,
            kind: item.kind,
            passageId: item.passageId,
            reason: 'wiki match',
            verification: 'unverified-wiki-summary',
            ...item.citations ? { citations: [...item.citations] } : {},
            ...item.relatedLinks ? { relatedLinks: [...item.relatedLinks] } : {},
            ...item.coverageStatus ? { coverageStatus: item.coverageStatus } : {},
          })),
          warnings: [...result.warnings, ...isWikiUnavailable ? [{ ruleId: 'wiki_unavailable',
            message: 'Wiki unavailable; read sources with this receipt after the wiki result is logged.' }] : []],
          tokenEstimate: result.tokenEstimate,
          totalMatches: result.totalMatches,
          generationId: result.generationId,
          ...result.cursor === null ? {} : { cursor: result.cursor },
        }
      }

      const bundle = await capability.retrieveBundle({ libraryId, terms }, exec.signal)
      return {
        items: [...bundle.items],
        warnings: [...bundle.warnings],
        tokenEstimate: bundle.tokenEstimate,
      }
    },
  }))

  const lookup = tools.register(defineTool({
    name: 'ask_knowledge_lookup',
    description: 'Look up one name or wiki page in the hung knowledge library and return its page body with continuation.',
    parameters: {
      term: {
        type: 'string',
        required: true,
        description: 'One name or page title. No sentence punctuation.',
      },
      cursor: {
        type: 'string',
        description: 'Opaque continuation returned by an earlier lookup of this page.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          term: { type: 'string', required: true },
          canonicalPath: { type: 'string' },
          text: { type: 'string' },
          cursor: { type: 'string' },
          citations: { type: 'array', items: { type: 'string' } },
          relatedLinks: { type: 'array', items: { type: 'string' } },
          coverageStatus: { type: 'string' },
          warnings: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ruleId: { type: 'string', required: true },
                message: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render(_args, value) {
        return [{ type: 'text', text: renderJson(value) }]
      },
    },
    presentCall: () => ({ card: 'generic', title: 'ask_knowledge_lookup' }),
    presentResult: () => ({ card: 'generic' }),
    async execute(args, exec) {
      const term = parseLookupOrThrow(args)
      const rawArgs = (args && typeof args === 'object') ? (args as Record<string, unknown>) : {}
      const libraryId = boundLibraryId(ctx, exec.agent?.session)

      if (passages?.lookup !== undefined) {
        const result = await passages.lookup({
          libraryId,
          term,
          ...typeof rawArgs.cursor === 'string' ? { cursor: rawArgs.cursor } : {},
        }, exec.signal)
        if (result.canonicalPath && !result.canonicalPath.startsWith('wiki/')) throw new AskKnowledgeError('no-hit',
          'Lookup opens wiki pages only; use wiki retrieval followed by source mode for original text.')
        return {
          term: result.term,
          ...result.canonicalPath === undefined ? {} : { canonicalPath: result.canonicalPath },
          ...result.text === undefined ? {} : { text: result.text },
          ...result.cursor ? { cursor: result.cursor } : {},
          ...result.citations ? { citations: [...result.citations] } : {},
          ...result.relatedLinks ? { relatedLinks: [...result.relatedLinks] } : {},
          ...result.coverageStatus ? { coverageStatus: result.coverageStatus } : {},
          warnings: [...result.warnings],
        }
      }

      const capability = requireCapability(ctx)
      const result = await capability.lookup({
        libraryId,
        term,
        ...typeof rawArgs.cursor === 'string' ? { cursor: rawArgs.cursor } : {},
      } as { libraryId: AskKnowledgeLibraryId; term: string }, exec.signal) as AskKnowledgeLookup & {
        cursor?: string | null
        citations?: readonly string[]
        relatedLinks?: readonly string[]
        coverageStatus?: string
      }
      if (result.canonicalPath && !result.canonicalPath.startsWith('wiki/')) throw new AskKnowledgeError('no-hit',
        'Lookup opens wiki pages only; use wiki retrieval followed by source mode for original text.')
      return {
        term: result.term,
        ...result.canonicalPath === undefined ? {} : { canonicalPath: result.canonicalPath },
        ...result.text === undefined ? {} : { text: result.text },
        ...result.cursor ? { cursor: result.cursor } : {},
        ...result.citations ? { citations: [...result.citations] } : {},
        ...result.relatedLinks ? { relatedLinks: [...result.relatedLinks] } : {},
        ...result.coverageStatus ? { coverageStatus: result.coverageStatus } : {},
        warnings: [...result.warnings],
      }
    },
  }))

  const read = passages === undefined ? undefined : tools.register(defineTool({
    name: 'ask_knowledge_read',
    description: 'Read a returned passage in full, in bounded logged pages. Requires an earlier wiki attempt receipt in the same turn.',
    parameters: {
      passageId: { type: 'string', required: true, description: 'Exact passageId returned by ask_knowledge_retrieve.' },
      cursor: { type: 'string', description: 'Opaque cursor returned by an earlier read of this passage.' },
      wikiAttemptId: { type: 'string', description: 'Receipt ID from an earlier same-turn wiki attempt.' },
      fallbackReason: { type: 'string', description: 'Optional model explanation for reading raw source.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        text: { type: 'string', required: true },
        path: { type: 'string', required: true },
        passageId: { type: 'string', required: true },
        cursor: { type: 'string' },
        verification: { type: 'string' },
        sourceRevision: { type: 'string' }, sourceStart: { type: 'integer' }, sourceEnd: { type: 'integer' },
        fallbackReason: { type: 'string' },
      } },
      render: (_args, result) => [{ type: 'text', text: renderJson(result) }],
    },
    presentCall: () => ({ card: 'generic', title: 'ask_knowledge_read' }),
    presentResult: () => ({ card: 'generic' }),
    async execute(args, exec) {
      const rawArgs = (args && typeof args === 'object') ? (args as Record<string, unknown>) : {}
      const passageId = String(rawArgs.passageId ?? '')
      const libraryId = boundLibraryId(ctx, exec.agent?.session)
      const currentTurn = currentTurnOf(ctx, exec.agent?.session)

      const attemptId = typeof rawArgs.wikiAttemptId === 'string' ? rawArgs.wikiAttemptId : undefined
      requireLoggedWikiAttempt(exec.agent?.session, libraryId, currentTurn, attemptId)

      const result = await passages.read({
        libraryId,
        passageId,
        ...typeof rawArgs.cursor === 'string' ? { cursor: rawArgs.cursor } : {},
      }, exec.signal)
      const item = result.items[0]
      if (!item) throw new Error('Passage is no longer available')
      return {
        text: item.text,
        path: item.path,
        passageId: item.passageId,
        verification: sourceEvidence(item) ? 'source-verified' : item.path.startsWith('raw/') ? 'unverified-source-excerpt' : 'unverified-wiki-summary',
        ...sourceEvidence(item),
        ...typeof rawArgs.fallbackReason === 'string' ? { fallbackReason: rawArgs.fallbackReason } : {},
        ...result.cursor === null ? {} : { cursor: result.cursor },
      }
    },
  }))

  const sessionDocumentTool = defineTool({
    name: 'ask_knowledge_session_document',
    description:
      'Search or read documents attached directly to the current session (e.g. PDF, DOCX, TXT), even when no knowledge library is bound. Supports action="read" (with continuation cursor and page locators) and action="search" (keyword query across document passages).',
    parameters: {
      action: {
        type: 'string',
        enum: ['read', 'search'],
        description: 'Action to perform: "read" to read document text in bounded pages/chunks with locators, or "search" to find relevant passages.',
      },
      filename: {
        type: 'string',
        description: 'Optional filename of the session attachment (e.g. policy.pdf, manual.docx).',
      },
      digest: {
        type: 'string',
        description: 'Optional SHA-256 digest of the session attachment.',
      },
      query: {
        type: 'string',
        description: 'Search query terms when action is "search".',
      },
      cursor: {
        type: 'string',
        description: 'Opaque continuation cursor from an earlier read or search of this document.',
      },
      page: {
        type: 'integer',
        description: 'Optional 1-based page number to read directly.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          filename: { type: 'string', required: true },
          digest: { type: 'string', required: true },
          status: { type: 'string', required: true },
          text: { type: 'string' },
          page: { type: 'integer' },
          charOffset: { type: 'integer' },
          totalChars: { type: 'integer' },
          totalMatches: { type: 'integer' },
          cursor: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                locator: { type: 'string', required: true },
                page: { type: 'integer' },
                text: { type: 'string', required: true },
                charOffset: { type: 'integer', required: true },
                kind: { type: 'string', required: true },
              },
            },
          },
          diagnostics: {
            type: 'object',
            additionalProperties: false,
            properties: {
              warnings: { type: 'array', items: { type: 'string' } },
              omissions: { type: 'array', items: { type: 'string' } },
              unsupportedFeatures: { type: 'array', items: { type: 'string' } },
              needsOcrPages: { type: 'array', items: { type: 'integer' } },
              totalPages: { type: 'integer' },
              decoding: { type: 'string' },
              nativeDiagnostic: { type: 'string' },
            },
          },
        },
      },
      render: (_args, result) => [{ type: 'text', text: renderJson(result) }],
    },
    presentCall: () => ({ card: 'generic', title: 'ask_knowledge_session_document' }),
    presentResult: () => ({ card: 'generic' }),
    async execute(args, exec) {
      const sessionId = exec.agent?.session?.id ?? ''
      const authorized = await findAuthorizedSessionAttachments(ctx, sessionId, exec.agent?.session as never)
      const rawArgs = (args && typeof args === 'object') ? (args as Record<string, unknown>) : {}
      const digest = typeof rawArgs.digest === 'string' ? rawArgs.digest : undefined
      const filename = typeof rawArgs.filename === 'string' ? rawArgs.filename : undefined
      const ref = resolveAuthorizedAttachment(authorized, {
        ...digest !== undefined ? { digest } : {},
        ...filename !== undefined ? { filename } : {},
      })

      const homeConfig = config ?? {}
      const converted = await getOrConvertSessionAttachment(homeConfig, ctx, ref, exec.signal)
      exec.signal.throwIfAborted()
      if (!(await findAuthorizedSessionAttachments(ctx, sessionId, exec.agent?.session)).has(cleanDigest(String(ref.attachmentId)))) {
        throw new AskKnowledgeError('ingest-failed', 'Attachment authorization changed during conversion')
      }
      const action = rawArgs.action === 'search' ? 'search' : 'read'

      if (action === 'search') {
        const query = typeof rawArgs.query === 'string' ? rawArgs.query : ''
        const cursor = typeof rawArgs.cursor === 'string' ? rawArgs.cursor : undefined
        return searchSessionAttachment(converted, ref, sessionId, query, {
          maxBytes: maxSerializedBytes,
          limitChars: Math.min(3000, bounds.maxChars),
          ...cursor !== undefined ? { cursor } : {},
        })
      }

      const cursor = typeof rawArgs.cursor === 'string' ? rawArgs.cursor : undefined
      const page = typeof rawArgs.page === 'number' ? rawArgs.page : undefined
      return readSessionAttachment(converted, ref, sessionId, {
        maxBytes: maxSerializedBytes,
        limitChars: Math.min(3000, bounds.maxChars),
        ...cursor !== undefined ? { cursor } : {},
        ...page !== undefined ? { page } : {},
      })
    },
  })

  const sessionDoc = tools.register(sessionDocumentTool)
  const attachmentRead = tools.register({ ...sessionDocumentTool,
    name: 'ask_knowledge_attachment_read',
    presentCall: () => ({ card: 'generic' as const, title: 'ask_knowledge_attachment_read' }),
  })

  return () => {
    retrieve()
    lookup()
    read?.()
    sessionDoc()
    attachmentRead()
  }
}

function parseTermsOrThrow(args: unknown): string[] {
  try {
    return parseAskKnowledgeTerms(args)
  } catch {
    throw Object.assign(new Error(TERMS_ERROR), {
      code: 'ask-knowledge/terms-invalid',
    })
  }
}

function parseLookupOrThrow(args: unknown): string {
  try {
    return parseAskKnowledgeLookupTerm(args)
  } catch {
    throw Object.assign(new Error(TERMS_ERROR), {
      code: 'ask-knowledge/terms-invalid',
    })
  }
}

function requireCapability(ctx: Context): AskKnowledge {
  const capability = ctx.get('askKnowledge')
  if (capability === undefined) {
    throw new AskKnowledgeError('ask-knowledge-unavailable', UNBOUND_ERROR)
  }
  return capability
}

function boundLibraryId(ctx: Context, session: { id: string } | undefined): ReturnType<typeof AskKnowledgeLibraryId> {
  if (session === undefined) {
    throw Object.assign(new Error(UNBOUND_ERROR), { code: 'ask-knowledge/unbound' })
  }
  const live = ctx.get('sessions')?.get(session.id as never)
  const binding = live === undefined
    ? undefined
    : ctx.sessionProjections.stateOf(live, 'askKnowledgeBinding')
  if (binding == null || binding.libraryId === '') {
    throw Object.assign(new Error(UNBOUND_ERROR), { code: 'ask-knowledge/unbound' })
  }
  return AskKnowledgeLibraryId(binding.libraryId)
}
