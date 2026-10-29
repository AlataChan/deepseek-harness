/**
 * Runtime configuration validation and resolution for the TUI subsystem.
 * Enforces fail-loud validation, explicit defaults, and single authoritative bounds.
 *
 * @module @deepseek-ai/dsh-tui/config
 */

import z from '@deepseek-ai/schemastery'
import type { ResolvedTuiConfig, TuiConfig } from './types.ts'

/** Single authoritative configuration bounds and defaults for TUI options. */
export const TUI_CONFIG_BOUNDS = {
  maxScrollbackLines: { min: 10, max: 100_000, default: 2000 },
  maxScrollbackLineLength: { min: 10, max: 65_536, default: 4096 },
  maxInputBytes: { min: 64, max: 1_048_576, default: 32_768 },
  maxPasteBytes: { min: 64, max: 1_048_576, default: 65_536 },
  maxHistoryEntries: { min: 10, max: 10_000, default: 500 },
  maxStreamAccumulatorChars: { min: 256, max: 1_048_576, default: 32_768 },
  redrawIntervalMs: { min: 10, max: 1000, default: 33 },
} as const

/** Validated Cosmokit schema for TUI configuration. */
export const Config: z<TuiConfig> = z.object({
  maxScrollbackLines: z.natural()
    .min(TUI_CONFIG_BOUNDS.maxScrollbackLines.min)
    .max(TUI_CONFIG_BOUNDS.maxScrollbackLines.max)
    .default(TUI_CONFIG_BOUNDS.maxScrollbackLines.default),
  maxScrollbackLineLength: z.natural()
    .min(TUI_CONFIG_BOUNDS.maxScrollbackLineLength.min)
    .max(TUI_CONFIG_BOUNDS.maxScrollbackLineLength.max)
    .default(TUI_CONFIG_BOUNDS.maxScrollbackLineLength.default),
  maxInputBytes: z.natural()
    .min(TUI_CONFIG_BOUNDS.maxInputBytes.min)
    .max(TUI_CONFIG_BOUNDS.maxInputBytes.max)
    .default(TUI_CONFIG_BOUNDS.maxInputBytes.default),
  maxPasteBytes: z.natural()
    .min(TUI_CONFIG_BOUNDS.maxPasteBytes.min)
    .max(TUI_CONFIG_BOUNDS.maxPasteBytes.max)
    .default(TUI_CONFIG_BOUNDS.maxPasteBytes.default),
  maxHistoryEntries: z.natural()
    .min(TUI_CONFIG_BOUNDS.maxHistoryEntries.min)
    .max(TUI_CONFIG_BOUNDS.maxHistoryEntries.max)
    .default(TUI_CONFIG_BOUNDS.maxHistoryEntries.default),
  maxStreamAccumulatorChars: z.natural()
    .min(TUI_CONFIG_BOUNDS.maxStreamAccumulatorChars.min)
    .max(TUI_CONFIG_BOUNDS.maxStreamAccumulatorChars.max)
    .default(TUI_CONFIG_BOUNDS.maxStreamAccumulatorChars.default),
  redrawIntervalMs: z.natural()
    .min(TUI_CONFIG_BOUNDS.redrawIntervalMs.min)
    .max(TUI_CONFIG_BOUNDS.redrawIntervalMs.max)
    .default(TUI_CONFIG_BOUNDS.redrawIntervalMs.default),
  locale: z.union(['zh', 'en'] as const).default('zh'),
})

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable]'
  }
}

/**
 * Validates a numeric configuration property ensuring it is a safe integer within the prescribed bounds.
 * @param name - Configuration key name.
 * @param value - Provided raw value.
 * @param min - Inclusive lower bound.
 * @param max - Inclusive upper bound.
 * @param defaultVal - Fallback default when undefined.
 * @returns Validated finite integer.
 * @throws TypeError when value is not a safe integer.
 * @throws RangeError when value is outside [min, max].
 */
function validateBoundedInteger(name: string, value: unknown, min: number, max: number, defaultVal: number): number {
  if (value === undefined) return defaultVal
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`tui: config "${name}" must be a safe integer, got ${formatValue(value)}`)
  }
  if (value < min || value > max) {
    throw new RangeError(`tui: config "${name}" must be between ${min} and ${max}, got ${value}`)
  }
  return value
}

/**
 * Validates the configured UI locale.
 * @param value - Provided locale value.
 * @param defaultVal - Default fallback locale.
 * @returns Validated locale string.
 * @throws TypeError when value is not 'zh' or 'en'.
 */
function validateLocale(value: unknown, defaultVal: 'zh' | 'en'): 'zh' | 'en' {
  if (value === undefined) return defaultVal
  if (value !== 'zh' && value !== 'en') {
    throw new TypeError(`tui: config "locale" must be "zh" or "en", got ${formatValue(value)}`)
  }
  return value
}

/**
 * Resolve deployment-varying configuration with fail-loud validation and authoritative bounds.
 * Never silently clamps or coerces invalid inputs.
 * @param rawConfig - User or deployment provided configuration overrides.
 * @returns Fully populated, immutable runtime spec.
 * @throws TypeError or RangeError on invalid deployment inputs.
 */
export function resolveTuiConfig(rawConfig: TuiConfig = {}): ResolvedTuiConfig {
  return {
    maxScrollbackLines: validateBoundedInteger(
      'maxScrollbackLines',
      rawConfig.maxScrollbackLines,
      TUI_CONFIG_BOUNDS.maxScrollbackLines.min,
      TUI_CONFIG_BOUNDS.maxScrollbackLines.max,
      TUI_CONFIG_BOUNDS.maxScrollbackLines.default,
    ),
    maxScrollbackLineLength: validateBoundedInteger(
      'maxScrollbackLineLength',
      rawConfig.maxScrollbackLineLength,
      TUI_CONFIG_BOUNDS.maxScrollbackLineLength.min,
      TUI_CONFIG_BOUNDS.maxScrollbackLineLength.max,
      TUI_CONFIG_BOUNDS.maxScrollbackLineLength.default,
    ),
    maxInputBytes: validateBoundedInteger(
      'maxInputBytes',
      rawConfig.maxInputBytes,
      TUI_CONFIG_BOUNDS.maxInputBytes.min,
      TUI_CONFIG_BOUNDS.maxInputBytes.max,
      TUI_CONFIG_BOUNDS.maxInputBytes.default,
    ),
    maxPasteBytes: validateBoundedInteger(
      'maxPasteBytes',
      rawConfig.maxPasteBytes,
      TUI_CONFIG_BOUNDS.maxPasteBytes.min,
      TUI_CONFIG_BOUNDS.maxPasteBytes.max,
      TUI_CONFIG_BOUNDS.maxPasteBytes.default,
    ),
    maxHistoryEntries: validateBoundedInteger(
      'maxHistoryEntries',
      rawConfig.maxHistoryEntries,
      TUI_CONFIG_BOUNDS.maxHistoryEntries.min,
      TUI_CONFIG_BOUNDS.maxHistoryEntries.max,
      TUI_CONFIG_BOUNDS.maxHistoryEntries.default,
    ),
    maxStreamAccumulatorChars: validateBoundedInteger(
      'maxStreamAccumulatorChars',
      rawConfig.maxStreamAccumulatorChars,
      TUI_CONFIG_BOUNDS.maxStreamAccumulatorChars.min,
      TUI_CONFIG_BOUNDS.maxStreamAccumulatorChars.max,
      TUI_CONFIG_BOUNDS.maxStreamAccumulatorChars.default,
    ),
    redrawIntervalMs: validateBoundedInteger(
      'redrawIntervalMs',
      rawConfig.redrawIntervalMs,
      TUI_CONFIG_BOUNDS.redrawIntervalMs.min,
      TUI_CONFIG_BOUNDS.redrawIntervalMs.max,
      TUI_CONFIG_BOUNDS.redrawIntervalMs.default,
    ),
    locale: validateLocale(rawConfig.locale, 'zh'),
  }
}
