import { describe, expect, it } from 'vitest'
import { assertBudgetAllows, ESTIMATE_CLONE_YUAN, ESTIMATE_TTS_YUAN, ESTIMATE_VIDEO_YUAN, spentBudget } from '../src/budget.ts'
import { MediaError } from '../src/error.ts'
import { emptyMediaState } from '../src/projection.ts'
import { MediaRequestId } from '../src/ids.ts'

describe('budget', () => {
  it('ignores proposed and approved spend', () => {
    expect(spentBudget(emptyMediaState())).toEqual({ calls: 0, yuan: 0 })
    expect(spentBudget({
      requests: {
        a: {
          requestId: MediaRequestId('r_a'),
          kind: 'video',
          stage: 'proposed',
          label: 'p',
          inputHashes: [],
          estimatedYuan: 9,
        },
        b: {
          requestId: MediaRequestId('r_b'),
          kind: 'video',
          stage: 'running',
          label: 'r',
          inputHashes: [],
          estimatedYuan: 2.5,
        },
      },
      artifacts: {},
    })).toEqual({ calls: 1, yuan: 2.5 })
  })

  it('rejects exhausted call and spend ceilings', () => {
    const config = { maxPaidCallsPerSession: 1, maxEstimatedSpendYuan: 3 }
    const empty = emptyMediaState()
    assertBudgetAllows(empty, config, ESTIMATE_TTS_YUAN)
    const spent = {
      requests: {
        b: {
          requestId: MediaRequestId('r_b'),
          kind: 'video',
          stage: 'running',
          label: 'r',
          inputHashes: [],
          estimatedYuan: 2.5,
        },
      },
      artifacts: {},
    }
    expect(() => assertBudgetAllows(spent, config, ESTIMATE_VIDEO_YUAN)).toThrow(MediaError)
    expect(() => assertBudgetAllows(empty, { maxPaidCallsPerSession: 8, maxEstimatedSpendYuan: 2 }, ESTIMATE_CLONE_YUAN))
      .toThrow(MediaError)
  })
})
