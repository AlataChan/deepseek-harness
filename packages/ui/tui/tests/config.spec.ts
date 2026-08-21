import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

describe('tui configuration', () => {
  it('resolves every deployment tunable from one validated config', () => {
    expect(Config({})).toEqual({
      terminalColumnsFallback: 80,
      resumeTranscriptRows: 200,
      sessionSelectorLimit: 50,
      toolOutputDisplayBudget: 32_768,
    })
  })

  it.each([
    'terminalColumnsFallback',
    'resumeTranscriptRows',
    'sessionSelectorLimit',
    'toolOutputDisplayBudget',
  ] as const)('rejects invalid %s values', (field) => {
    expect(() => Config({ [field]: 0 })).toThrow()
    expect(() => Config({ [field]: 1.5 })).toThrow()
  })
})
