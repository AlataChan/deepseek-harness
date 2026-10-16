/**
 * Bound a complete retrieve / lookup payload after bodies are loaded.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/result-bounds
 */

import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
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
 * Estimate tokens conservatively using UTF-8 byte allowance for CJK safety.
 * @param text - source text.
 * @returns token estimate.
 */
export function tokenEstimate(text: string): number {
  return new TextEncoder().encode(text).length
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
  const notice = { ruleId: 'result-truncated', message: 'retrieve result exceeded the payload bound' }
  let truncated = warnings.length > bounds.maxItems
  const safeWarnings = warnings.slice(0, bounds.maxItems).map((warning) => {
    const ruleId = [...warning.ruleId].slice(0, 64).join('')
    const message = [...warning.message].slice(0, 256).join('')
    if (ruleId !== warning.ruleId || message !== warning.message) truncated = true
    return { ruleId, message }
  })
  const kept: AskKnowledgeBundleItem[] = []
  const envelope = (withNotice: boolean): AskKnowledgeBundle => {
    const result = { items: [...kept], warnings: withNotice ? [...safeWarnings, notice] : [...safeWarnings], tokenEstimate: 0 }
    let estimate = tokenEstimate(JSON.stringify(result))
    while (estimate !== result.tokenEstimate) {
      result.tokenEstimate = estimate
      estimate = tokenEstimate(JSON.stringify(result))
    }
    return result
  }
  if (envelope(truncated).tokenEstimate > bounds.maxTokens) {
    throw new AskKnowledgeError('ingest-failed', 'retrieval warning metadata exceeds the payload allowance')
  }
  let chars = 0
  for (const item of items) {
    if (kept.length >= bounds.maxItems || chars >= bounds.maxChars) { truncated = true; break }
    const body = [...clipItemText(item.text)].slice(0, bounds.maxChars - chars)
    const title = [...item.title].slice(0, 160).join('')
    const reason = [...item.reason].slice(0, 256).join('')
    if (title !== item.title || reason !== item.reason || body.join('') !== item.text) truncated = true
    const candidate = { ...item, title, reason, text: body.join('') }
    kept.push(candidate)
    if (envelope(truncated).tokenEstimate > bounds.maxTokens) {
      truncated = true
      candidate.text = ''
      if (envelope(true).tokenEstimate > bounds.maxTokens) {
        kept.pop()
        if (kept.length === 0) throw new AskKnowledgeError('ingest-failed', 'retrieval item metadata exceeds the payload allowance')
        break
      }
      let low = 0
      let high = body.length
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        candidate.text = body.slice(0, middle).join('')
        if (envelope(true).tokenEstimate <= bounds.maxTokens) low = middle
        else high = middle - 1
      }
      candidate.text = body.slice(0, low).join('')
      if (low === 0 && body.length > 0) kept.pop()
      chars += low
      break
    }
    chars += body.length
  }
  // Reserve diagnostic bytes when the next item or body cannot fit.
  let result = envelope(truncated)
  while (result.tokenEstimate > bounds.maxTokens && kept.length > 0) {
    truncated = true
    const previous = kept.at(-1)
    if (previous === undefined) break
    const last = { ...previous }
    kept[kept.length - 1] = last
    const body = [...last.text]
    last.text = ''
    if (envelope(true).tokenEstimate > bounds.maxTokens || body.length === 0) {
      kept.pop()
    } else {
      let low = 0
      let high = body.length
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        last.text = body.slice(0, middle).join('')
        if (envelope(true).tokenEstimate <= bounds.maxTokens) low = middle
        else high = middle - 1
      }
      last.text = body.slice(0, low).join('')
      if (low === 0) kept.pop()
    }
    result = envelope(true)
  }
  if (result.tokenEstimate > bounds.maxTokens) throw new AskKnowledgeError('ingest-failed', 'retrieval metadata exceeds the payload allowance')
  return result
}

function clamp(value: number | undefined, hardTop: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return hardTop
  return Math.min(Math.floor(value), hardTop)
}
