/**
 * Staged-change guardrails, checked when a change is staged and again before export.
 * Adapted from the Claude Commerce Agents merchant guardrails (Apache License 2.0); see the package NOTICE.
 */

import type { CommerceChangeKind, CommerceValue } from '@deepseek-ai/dsh-host-commerce'
import { sanitizeUntrusted } from '@deepseek-ai/dsh-fence-policy'
import type { StagedChangeItem } from './types.ts'

/** Deployment caps and field lists applied to every staged change. */
export interface GuardrailConfig {
  /** Maximum lines one change may carry. */
  readonly maxItemsPerChange: number
  /** Maximum absolute price move of one line, in percent of its grounded price. */
  readonly maxPriceDeltaPct: number
  /** Maximum promotion discount depth, in percent. */
  readonly maxPromotionDiscountPct: number
  /** Maximum units one restock line may add. */
  readonly maxRestockQuantity: number
  /** Maximum campaign budget of one change. */
  readonly maxCampaignBudget: number
  /** Maximum characters in one listing text value. */
  readonly maxListingFieldChars: number
  /** Fields no staged change may carry, compared case-insensitively. */
  readonly protectedFields: string[]
  /** Fields whose values are prices, compared case-insensitively. */
  readonly priceBearingFields: string[]
  /** Fields a listing update may not carry, compared case-insensitively. */
  readonly listingUpdateBlockedFields: string[]
}

const LABEL_CHARS = 60

/**
 * List every guardrail the lines of one change break.
 * @param kind - staged change family.
 * @param items - the lines the merchant would approve.
 * @param guardrails - caps and field lists in force.
 * @returns one model-readable message per broken rule; empty when the change may proceed.
 */
export function checkGuardrails(
  kind: CommerceChangeKind,
  items: readonly StagedChangeItem[],
  guardrails: GuardrailConfig,
): string[] {
  const violations: string[] = []
  if (items.length > guardrails.maxItemsPerChange) {
    violations.push(`the change has ${String(items.length)} lines and the limit is ${String(guardrails.maxItemsPerChange)} per change; stage separate changes within the limit`)
  }
  const protectedFields = folded(guardrails.protectedFields)
  const blockedFields = folded(guardrails.listingUpdateBlockedFields)
  const priceFields = folded(guardrails.priceBearingFields)
  const seen = new Set<string>()
  for (const item of items) {
    const field = item.field.toLowerCase()
    const target = item.listingId === null ? 'the campaign' : label(item.listingId)
    // Each cap applies per line, so a repeated target and field would pass each cap once and apply the sum.
    const key = `${item.listingId ?? ''}\u0000${field}`
    if (seen.has(key)) {
      violations.push(`'${label(item.field)}' on ${target} appears more than once; stage one line per listing and field`)
    }
    seen.add(key)
    if (protectedFields.has(field)) {
      violations.push(`field '${label(item.field)}' on ${target} is protected and cannot be changed`)
    }
    if (kind === 'listing-update') {
      if (blockedFields.has(field)) {
        violations.push(`'${label(item.field)}' cannot be changed through a listing update; stage a price change or restock so its own limits apply`)
      }
      if (typeof item.after === 'string' && Array.from(item.after).length > guardrails.maxListingFieldChars) {
        violations.push(`'${label(item.field)}' on ${target} is ${String(Array.from(item.after).length)} characters and the limit is ${String(guardrails.maxListingFieldChars)}`)
      }
    }
    // Every promotion line is a price move, whatever its field is called.
    if (kind === 'promotion' || priceFields.has(field)) {
      const before = positiveAmount(item.before)
      const after = positiveAmount(item.after)
      if (before === undefined) {
        violations.push(`${target} has no grounded current price, so the price move cannot be checked`)
      } else if (after === undefined) {
        violations.push(`the new price for ${target} must be a positive amount`)
      } else {
        const movePct = Math.abs(after - before) / before * 100
        if (kind === 'promotion') {
          if (movePct > guardrails.maxPromotionDiscountPct) {
            violations.push(`the promotion moves ${target} by ${percent(movePct)}, above the ${percent(guardrails.maxPromotionDiscountPct)} promotion limit`)
          }
        } else if (movePct > guardrails.maxPriceDeltaPct) {
          violations.push(`the price move of ${percent(movePct)} on ${target} exceeds the ${percent(guardrails.maxPriceDeltaPct)} per-change limit`)
        }
      }
    }
    // Any restock line that raises the level counts against the restock cap.
    if (kind === 'restock') {
      const added = asQuantity(item.after) - asQuantity(item.before)
      if (added > guardrails.maxRestockQuantity) {
        violations.push(`restocking ${String(added)} units on ${target} exceeds the ${String(guardrails.maxRestockQuantity)}-unit per-change limit`)
      }
    }
    if (kind === 'campaign' && field === 'budget') {
      const budget = positiveAmount(item.after)
      if (budget !== undefined && budget > guardrails.maxCampaignBudget) {
        violations.push(`the campaign budget of ${String(budget)} exceeds the ${String(guardrails.maxCampaignBudget)} per-change limit`)
      }
    }
  }
  return violations
}

/**
 * Check a promotion's requested depth before any line is priced.
 * @param discountPct - requested discount in percent.
 * @param guardrails - caps in force.
 * @returns the violation message, or undefined when the depth is allowed.
 */
export function promotionDepthViolation(discountPct: number, guardrails: GuardrailConfig): string | undefined {
  const depth = Math.abs(discountPct)
  return depth > guardrails.maxPromotionDiscountPct
    ? `a ${percent(depth)} promotion exceeds this store's ${percent(guardrails.maxPromotionDiscountPct)} promotion limit`
    : undefined
}

/**
 * Structurally escape and shorten catalog or argument text quoted in guardrail messages.
 * @param text - listing id, field name, or other quoted value.
 * @returns text safe to place in an unfenced tool result.
 */
export function label(text: string): string {
  const safe = sanitizeUntrusted(text)
  const codePoints = Array.from(safe)
  return codePoints.length <= LABEL_CHARS ? safe : `${codePoints.slice(0, LABEL_CHARS).join('')}…`
}

function folded(fields: readonly string[]): ReadonlySet<string> {
  return new Set(fields.map(field => field.toLowerCase()))
}

/**
 * Read a positive finite amount from a numeric or numeric-text value.
 * @param value - catalog or argument value.
 * @returns the amount, or undefined when the value is missing, non-numeric, or not positive.
 */
export function positiveAmount(value: CommerceValue): number | undefined {
  const amount = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(amount) && amount > 0 ? amount : undefined
}

function asQuantity(value: CommerceValue): number {
  const quantity = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(quantity) ? Math.trunc(quantity) : 0
}

function percent(value: number): string {
  return `${String(Math.round(value * 10) / 10)}%`
}
