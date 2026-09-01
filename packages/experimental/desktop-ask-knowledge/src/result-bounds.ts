/**
 * Bound a complete retrieve / lookup payload after bodies are loaded.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/result-bounds
 */

import type { AskKnowledgeBundle, AskKnowledgeBundleItem } from '@deepseek-ai/dsh-host-ask-knowledge'

/** Default item cap. */
export const DEFAULT_MAX_RESULT_ITEMS = 12
/** Default sum of item text lengths. */
export const DEFAULT_MAX_RESULT_CHARS = 24_000
/** Default token estimate cap. */
export const DEFAULT_MAX_RESULT_TOKENS = 6000
/** Per-item text cap before the whole-payload trim. */
export const ITEM_TEXT_LIMIT = 4000

/** Hard tops; Config may only lower these. */
export const RESULT_BOUND_HARD_TOP = {
  items: DEFAULT_MAX_RESULT_ITEMS,
  chars: DEFAULT_MAX_RESULT_CHARS,
  tokens: DEFAULT_MAX_RESULT_TOKENS,
} as const

/** Effective bounds after Config is clamped to the hard top. */
export interface ResultBounds {
  readonly maxItems: number
  readonly maxChars: number
  readonly maxTokens: number
}

/**
 * Clamp configured bounds so they never exceed the hard top.
 * @param request - optional lowered caps.
 * @returns effective bounds.
 */
export function resolveResultBounds(request: {
  readonly maxItems?: number | undefined
  readonly maxChars?: number | undefined
  readonly maxTokens?: number | undefined
} = {}): ResultBounds {
  return {
    maxItems: clamp(request.maxItems, RESULT_BOUND_HARD_TOP.items),
    maxChars: clamp(request.maxChars, RESULT_BOUND_HARD_TOP.chars),
    maxTokens: clamp(request.maxTokens, RESULT_BOUND_HARD_TOP.tokens),
  }
}

/**
 * Estimate tokens as ceil(chars / 4).
 * @param text - source text.
 * @returns token estimate.
 */
export function tokenEstimate(text: string): number {
  return Math.ceil([...text].length / 4)
}

/**
 * Trim one item body to {@link ITEM_TEXT_LIMIT} code points.
 * @param text - page body.
 * @returns sliced text.
 */
export function clipItemText(text: string): string {
  const chars = [...text]
  return chars.length <= ITEM_TEXT_LIMIT ? text : chars.slice(0, ITEM_TEXT_LIMIT).join('')
}

/**
 * Apply item / char / token caps to a complete payload.
 * @param items - already body-loaded items.
 * @param warnings - sidecar warnings.
 * @param bounds - effective caps.
 * @returns bounded bundle.
 */
export function boundRetrieveResult(
  items: readonly AskKnowledgeBundleItem[],
  warnings: readonly { readonly ruleId: string; readonly message: string }[],
  bounds: ResultBounds,
): AskKnowledgeBundle {
  const clipped = items.map(item => ({ ...item, text: clipItemText(item.text) }))
  const kept: AskKnowledgeBundleItem[] = []
  let chars = 0
  let tokens = 0
  let truncated = false
  for (const item of clipped) {
    const nextChars = chars + [...item.text].length
    const nextTokens = tokens + tokenEstimate(item.text)
    if (kept.length >= bounds.maxItems || nextChars > bounds.maxChars || nextTokens > bounds.maxTokens) {
      truncated = true
      break
    }
    kept.push(item)
    chars = nextChars
    tokens = nextTokens
  }
  return {
    items: kept,
    warnings: truncated
      ? [...warnings, { ruleId: 'result-truncated', message: 'retrieve result exceeded the payload bound' }]
      : [...warnings],
    tokenEstimate: tokens,
  }
}

function clamp(value: number | undefined, hardTop: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return hardTop
  return Math.min(Math.floor(value), hardTop)
}
