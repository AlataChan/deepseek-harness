/**
 * Maps `limits.ts` rule ids onto the five user-visible surfaces.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/client/limits-copy
 */

import { ASK_DATA_RULE_IDS } from '../limits.ts'
import { en, zh, type AskDataKey } from './locales.ts'

/** The five surfaces that must each name every rule id. */
export const LIMIT_SURFACE_KEYS = [
  'pageLead',
  'uploadHelper',
  'previewLimits',
  'failureLimits',
] as const

/** One of the four locale surfaces; the fifth is the model-visible paragraph. */
export type LimitSurfaceKey = (typeof LIMIT_SURFACE_KEYS)[number]

/**
 * Read one locale surface. Tests assert each surface contains every rule id.
 * @param locale - zh or en dictionary.
 * @param key - surface key.
 * @returns the surface string.
 */
export function limitSurface(
  locale: Record<AskDataKey, string>,
  key: LimitSurfaceKey,
): string {
  return locale[key]
}

/**
 * Every rule id that the five surfaces must contain.
 * @returns the closed id list.
 */
export function requiredLimitIds(): readonly string[] {
  return ASK_DATA_RULE_IDS
}

/** Locale dictionaries used by the five-surface assertion. */
export const LIMIT_LOCALES = { zh, en } as const
