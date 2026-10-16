/**
 * ask_knowledge_retrieve / ask_knowledge_lookup. Executor rejects sentences.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/tools
 */

import type { PassageSearchRequest, PassageSearchResult, PassageReadRequest } from './document-retrieve.ts'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ASK_KNOWLEDGE_TERM_MAX_COUNT,
  ASK_KNOWLEDGE_TERM_MAX_LENGTH,
  ASK_KNOWLEDGE_TERM_MIN_COUNT,
  AskKnowledgeError,
  parseAskKnowledgeLookupTerm,
  parseAskKnowledgeTerms,
} from '@deepseek-ai/dsh-host-ask-knowledge'
import type { AskKnowledge } from '@deepseek-ai/dsh-host-ask-knowledge'
import { AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'

const TERMS_ERROR = '请改用 1 到 6 个专名，不要整句。'
const UNBOUND_ERROR = '先在上方挂上一个知识库。'

/**
 * Register retrieve and lookup tools. Disposed with the plugin fiber.
 * @param ctx - Host context.
 * @param passages - authorized bounded search and read operations.
 * @returns disposer.
 */
export function registerAskKnowledgeTools(ctx: Context, passages?: {
  search(request: PassageSearchRequest, signal?: AbortSignal): Promise<PassageSearchResult>
  read(request: PassageReadRequest, signal?: AbortSignal): Promise<PassageSearchResult>
}): () => void {
  const tools = ctx.get('tools')
  if (tools === undefined) return () => {}
  const retrieve = tools.register(defineTool({
    name: 'ask_knowledge_retrieve',
    description:
      'Search the hung knowledge library. Pass 1 to 6 names in terms, not a sentence.',
    parameters: {
      cursor: { type: 'string', description: 'Opaque continuation returned by this search; keep terms and documentFilter unchanged.' },
      documentFilter: { type: 'string', description: 'Optional raw path from an earlier result.' },
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
        return [{ type: 'text', text: renderRetrieveBodies(value) }]
      },
    },
    presentCall: () => ({ card: 'generic', title: 'ask_knowledge_retrieve' }),
    presentResult: () => ({ card: 'generic' }),
    async execute(args, exec) {
      const terms = parseTermsOrThrow(args)
      const capability = requireCapability(ctx)
      const libraryId = boundLibraryId(ctx, exec.agent?.session)
      if (passages !== undefined) {
        const result = await passages.search({ libraryId, queries: terms,
          ...typeof args.cursor === 'string' ? { cursor: args.cursor } : {},
          ...typeof args.documentFilter === 'string' ? { documentFilter: args.documentFilter } : {} }, exec.signal)
        return { items: result.items.map(item => ({ path: item.path, title: item.title, text: item.text, kind: item.kind, passageId: item.passageId, reason: 'passage match' })),
          warnings: [...result.warnings], tokenEstimate: result.tokenEstimate,
          totalMatches: result.totalMatches, generationId: result.generationId,
          ...result.cursor === null ? {} : { cursor: result.cursor } }
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
    description: 'Look up one name in the hung knowledge library and return its page body.',
    parameters: {
      term: {
        type: 'string',
        required: true,
        description: 'One name. No sentence punctuation.',
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
        return [{ type: 'text', text: typeof value.text === 'string' ? value.text : value.term }]
      },
    },
    presentCall: () => ({ card: 'generic', title: 'ask_knowledge_lookup' }),
    presentResult: () => ({ card: 'generic' }),
    async execute(args, exec) {
      const term = parseLookupOrThrow(args)
      const capability = requireCapability(ctx)
      const libraryId = boundLibraryId(ctx, exec.agent?.session)
      const result = await capability.lookup({ libraryId, term }, exec.signal)
      return {
        term: result.term,
        ...result.canonicalPath === undefined ? {} : { canonicalPath: result.canonicalPath },
        ...result.text === undefined ? {} : { text: result.text },
        warnings: [...result.warnings],
      }
    },
  }))
  const read = passages === undefined ? undefined : tools.register(defineTool({
    name: 'ask_knowledge_read',
    description: 'Read a returned passage in full, in bounded logged pages. Uses only the session-bound library.',
    parameters: {
      passageId: { type: 'string', required: true, description: 'Exact passageId returned by ask_knowledge_retrieve.' },
      cursor: { type: 'string', description: 'Opaque cursor returned by an earlier read of this passage.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        text: { type: 'string', required: true },
        path: { type: 'string', required: true },
        passageId: { type: 'string', required: true },
        cursor: { type: 'string' },
      } },
      render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }],
    },
    presentCall: () => ({ card: 'generic', title: 'ask_knowledge_read' }),
    presentResult: () => ({ card: 'generic' }),
    async execute(args, exec) {
      const result = await passages.read({ libraryId: boundLibraryId(ctx, exec.agent?.session),
        passageId: args.passageId, ...typeof args.cursor === 'string' ? { cursor: args.cursor } : {} }, exec.signal)
      const item = result.items[0]
      if (!item) throw new Error('Passage is no longer available')
      return { text: item.text, path: item.path, passageId: item.passageId,
        ...result.cursor === null ? {} : { cursor: result.cursor } }
    },
  }))
  void ASK_KNOWLEDGE_TERM_MIN_COUNT
  void ASK_KNOWLEDGE_TERM_MAX_COUNT
  void ASK_KNOWLEDGE_TERM_MAX_LENGTH
  return () => {
    retrieve()
    lookup()
    read?.()
  }
}

function renderRetrieveBodies(value: { items?: unknown; cursor?: unknown; warnings?: unknown }): string {
  if (!Array.isArray(value.items) || value.items.length === 0) return 'retrieved 0 pages'
  const blocks = value.items.flatMap((item, index) => {
    if (typeof item !== 'object' || item === null) return []
    const row = item as { title?: unknown; path?: unknown; text?: unknown }
    const title = typeof row.title === 'string' && row.title !== '' ? row.title : `page ${index + 1}`
    const path = typeof row.path === 'string' ? row.path : ''
    const text = typeof row.text === 'string' ? row.text : ''
    return [`## ${title}\n${path}\n\n${text}`]
  })
  return JSON.stringify({ passages: blocks, cursor: value.cursor ?? null, warnings: value.warnings ?? [] })
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
