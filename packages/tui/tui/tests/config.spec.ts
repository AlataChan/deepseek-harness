/**
 * Verification of TUI configuration validation, schema bounds, and fail-loud semantics.
 */

import { describe, expect, it } from 'vitest'
import { Config, resolveTuiConfig, TUI_CONFIG_BOUNDS } from '../src/config.ts'

describe('TUI Configuration & Fail-Loud Validation', () => {
  it('resolves explicit defaults matching authoritative bounds', () => {
    const resolved = resolveTuiConfig({})
    expect(resolved).toEqual({
      maxScrollbackLines: TUI_CONFIG_BOUNDS.maxScrollbackLines.default,
      maxScrollbackLineLength: TUI_CONFIG_BOUNDS.maxScrollbackLineLength.default,
      maxInputBytes: TUI_CONFIG_BOUNDS.maxInputBytes.default,
      maxPasteBytes: TUI_CONFIG_BOUNDS.maxPasteBytes.default,
      maxHistoryEntries: TUI_CONFIG_BOUNDS.maxHistoryEntries.default,
      maxStreamAccumulatorChars: TUI_CONFIG_BOUNDS.maxStreamAccumulatorChars.default,
      redrawIntervalMs: TUI_CONFIG_BOUNDS.redrawIntervalMs.default,
      locale: 'zh',
    })

    const fromSchema = Config({})
    expect(fromSchema).toEqual(resolved)
  })

  it('accepts valid custom values within bounds', () => {
    const custom = {
      maxScrollbackLines: 500,
      maxScrollbackLineLength: 1000,
      maxInputBytes: 1024,
      maxPasteBytes: 2048,
      maxHistoryEntries: 100,
      maxStreamAccumulatorChars: 4096,
      redrawIntervalMs: 50,
      locale: 'en' as const,
    }
    const resolved = resolveTuiConfig(custom)
    expect(resolved).toEqual(custom)
    expect(Config(custom)).toEqual(custom)
  })

  it('rejects values below minimum bounds fail-loud in both direct resolution and schema', () => {
    // maxScrollbackLines below min (10)
    expect(() => resolveTuiConfig({ maxScrollbackLines: 9 })).toThrow(RangeError)
    expect(() => Config({ maxScrollbackLines: 9 })).toThrow()

    // maxScrollbackLineLength below min (10)
    expect(() => resolveTuiConfig({ maxScrollbackLineLength: 9 })).toThrow(RangeError)
    expect(() => Config({ maxScrollbackLineLength: 9 })).toThrow()

    // maxInputBytes below min (64)
    expect(() => resolveTuiConfig({ maxInputBytes: 63 })).toThrow(RangeError)
    expect(() => Config({ maxInputBytes: 63 })).toThrow()

    // maxPasteBytes below min (64)
    expect(() => resolveTuiConfig({ maxPasteBytes: 63 })).toThrow(RangeError)
    expect(() => Config({ maxPasteBytes: 63 })).toThrow()

    // maxHistoryEntries below min (10)
    expect(() => resolveTuiConfig({ maxHistoryEntries: 9 })).toThrow(RangeError)
    expect(() => Config({ maxHistoryEntries: 9 })).toThrow()

    // maxStreamAccumulatorChars below min (256)
    expect(() => resolveTuiConfig({ maxStreamAccumulatorChars: 255 })).toThrow(RangeError)
    expect(() => Config({ maxStreamAccumulatorChars: 255 })).toThrow()

    // redrawIntervalMs below min (10)
    expect(() => resolveTuiConfig({ redrawIntervalMs: 9 })).toThrow(RangeError)
    expect(() => Config({ redrawIntervalMs: 9 })).toThrow()
  })

  it('rejects values above maximum bounds fail-loud in both direct resolution and schema', () => {
    // maxScrollbackLines above max (100,000)
    expect(() => resolveTuiConfig({ maxScrollbackLines: 100_001 })).toThrow(RangeError)
    expect(() => Config({ maxScrollbackLines: 100_001 })).toThrow()

    // maxScrollbackLineLength above max (65,536)
    expect(() => resolveTuiConfig({ maxScrollbackLineLength: 65_537 })).toThrow(RangeError)
    expect(() => Config({ maxScrollbackLineLength: 65_537 })).toThrow()

    // maxInputBytes above max (1,048,576)
    expect(() => resolveTuiConfig({ maxInputBytes: 1_048_577 })).toThrow(RangeError)
    expect(() => Config({ maxInputBytes: 1_048_577 })).toThrow()

    // maxPasteBytes above max (1,048,576)
    expect(() => resolveTuiConfig({ maxPasteBytes: 1_048_577 })).toThrow(RangeError)
    expect(() => Config({ maxPasteBytes: 1_048_577 })).toThrow()

    // maxHistoryEntries above max (10,000)
    expect(() => resolveTuiConfig({ maxHistoryEntries: 10_001 })).toThrow(RangeError)
    expect(() => Config({ maxHistoryEntries: 10_001 })).toThrow()

    // maxStreamAccumulatorChars above max (1,048,576)
    expect(() => resolveTuiConfig({ maxStreamAccumulatorChars: 1_048_577 })).toThrow(RangeError)
    expect(() => Config({ maxStreamAccumulatorChars: 1_048_577 })).toThrow()

    // redrawIntervalMs above max (1000)
    expect(() => resolveTuiConfig({ redrawIntervalMs: 1001 })).toThrow(RangeError)
    expect(() => Config({ redrawIntervalMs: 1001 })).toThrow()
  })

  it('rejects non-integer and NaN numeric values fail-loud', () => {
    expect(() => resolveTuiConfig({ maxScrollbackLines: 100.5 })).toThrow(TypeError)
    expect(() => Config({ maxScrollbackLines: 100.5 })).toThrow()

    expect(() => resolveTuiConfig({ maxScrollbackLines: NaN })).toThrow(TypeError)
    expect(() => Config({ maxScrollbackLines: NaN })).toThrow()

    expect(() => resolveTuiConfig({ redrawIntervalMs: 33.3 })).toThrow(TypeError)
    expect(() => Config({ redrawIntervalMs: 33.3 })).toThrow()
  })

  it('rejects invalid locale strings fail-loud', () => {
    // @ts-expect-error Testing invalid locale input
    expect(() => resolveTuiConfig({ locale: 'fr' })).toThrow(TypeError)
    // @ts-expect-error Testing invalid locale input
    expect(() => Config({ locale: 'fr' })).toThrow()
  })
})
