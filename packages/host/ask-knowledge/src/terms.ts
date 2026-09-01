/**
 * Shared term schema and closed error codes for retrieve / lookup.
 * Official session-controller and the overlay tool both import this module.
 * @module @deepseek-ai/dsh-host-ask-knowledge/terms
 */

import { z } from 'zod'

/** Maximum number of retrieve terms in one call. */
export const ASK_KNOWLEDGE_TERM_MAX_COUNT = 6
/** Minimum number of retrieve terms in one call. */
export const ASK_KNOWLEDGE_TERM_MIN_COUNT = 1
/** Maximum Unicode code points in one term after trim. */
export const ASK_KNOWLEDGE_TERM_MAX_LENGTH = 16
/** Punctuation that marks a sentence rather than a name. */
export const ASK_KNOWLEDGE_TERM_FORBIDDEN = /[?？。！!\n\r]/

const termSchema = z.string().transform((value, ctx) => {
  const trimmed = value.trim()
  if (trimmed === '') {
    ctx.addIssue({ code: 'custom', message: 'empty' })
    return z.NEVER
  }
  if ([...trimmed].length > ASK_KNOWLEDGE_TERM_MAX_LENGTH) {
    ctx.addIssue({ code: 'custom', message: 'too-long' })
    return z.NEVER
  }
  if (ASK_KNOWLEDGE_TERM_FORBIDDEN.test(trimmed)) {
    ctx.addIssue({ code: 'custom', message: 'sentence' })
    return z.NEVER
  }
  return trimmed
})

/** Runtime schema for `ask_knowledge_retrieve` arguments. */
export const ASK_KNOWLEDGE_TERMS_SCHEMA = z.object({
  terms: z.array(termSchema).min(ASK_KNOWLEDGE_TERM_MIN_COUNT).max(ASK_KNOWLEDGE_TERM_MAX_COUNT),
})

/** Runtime schema for `ask_knowledge_lookup` arguments. */
export const ASK_KNOWLEDGE_LOOKUP_SCHEMA = z.object({
  term: termSchema,
})

/** Neutral error data when terms fail the executor check. */
export interface AskKnowledgeTermsInvalid {
  readonly code: 'ask-knowledge/terms-invalid'
  readonly reason: 'empty' | 'count' | 'too-long' | 'sentence'
}

/** Neutral error data when the pre-trim retrieve payload is empty. */
export interface AskKnowledgeNoHit {
  readonly code: 'ask-knowledge/no-hit'
}

/**
 * Parse retrieve terms. Rejects count, empty, length, and sentence punctuation.
 * Does not use a function-word substring blacklist.
 * @param input - raw tool or Remote argument object.
 * @returns trimmed terms.
 */
export function parseAskKnowledgeTerms(input: unknown): string[] {
  const parsed = ASK_KNOWLEDGE_TERMS_SCHEMA.safeParse(input)
  if (!parsed.success) {
    throw Object.assign(new Error('ask-knowledge/terms-invalid'), {
      code: 'ask-knowledge/terms-invalid' as const,
      details: { reason: reasonOf(parsed.error) } satisfies Omit<AskKnowledgeTermsInvalid, 'code'>,
    })
  }
  return parsed.data.terms
}

/**
 * Parse one lookup term with the same mechanical rules as retrieve.
 * @param input - raw tool or Remote argument object.
 * @returns the trimmed term.
 */
export function parseAskKnowledgeLookupTerm(input: unknown): string {
  const parsed = ASK_KNOWLEDGE_LOOKUP_SCHEMA.safeParse(input)
  if (!parsed.success) {
    throw Object.assign(new Error('ask-knowledge/terms-invalid'), {
      code: 'ask-knowledge/terms-invalid' as const,
      details: { reason: reasonOf(parsed.error) } satisfies Omit<AskKnowledgeTermsInvalid, 'code'>,
    })
  }
  return parsed.data.term
}

function reasonOf(error: z.ZodError): AskKnowledgeTermsInvalid['reason'] {
  /* v8 ignore next -- ZodError from these schemas always carries at least one issue */
  const message = error.issues[0]?.message ?? 'count'
  if (message === 'empty' || message === 'too-long' || message === 'sentence') return message
  return 'count'
}
