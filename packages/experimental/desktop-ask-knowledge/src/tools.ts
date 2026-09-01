/**
 * ask_knowledge_retrieve / ask_knowledge_lookup. Executor rejects sentences.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/tools
 */

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
 * @returns disposer.
 */
export function registerAskKnowledgeTools(ctx: Context): () => void {
  const tools = ctx.get('tools')
  if (tools === undefined) return () => {}
  const retrieve = tools.register(defineTool({
    name: 'ask_knowledge_retrieve',
    description:
      'Search the hung knowledge library. Pass 1 to 6 names in terms, not a sentence.',
    parameters: {
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
  void ASK_KNOWLEDGE_TERM_MIN_COUNT
  void ASK_KNOWLEDGE_TERM_MAX_COUNT
  void ASK_KNOWLEDGE_TERM_MAX_LENGTH
  return () => {
    retrieve()
    lookup()
  }
}

function renderRetrieveBodies(value: { items?: unknown }): string {
  if (!Array.isArray(value.items) || value.items.length === 0) return 'retrieved 0 pages'
  const blocks = value.items.flatMap((item, index) => {
    if (typeof item !== 'object' || item === null) return []
    const row = item as { title?: unknown; path?: unknown; text?: unknown }
    const title = typeof row.title === 'string' && row.title !== '' ? row.title : `page ${index + 1}`
    const path = typeof row.path === 'string' ? row.path : ''
    const text = typeof row.text === 'string' ? row.text : ''
    return [`## ${title}\n${path}\n\n${text}`]
  })
  return blocks.length === 0 ? 'retrieved 0 pages' : blocks.join('\n\n')
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
