import { describe, expect, it } from 'vitest'
import { assertApprovalMatches, sameHashSet } from '../src/approval.ts'
import { MediaError } from '../src/error.ts'
import { MediaRequestId } from '../src/ids.ts'
import type { MediaRequestRecord } from '../src/types.ts'

const request: MediaRequestRecord = {
  requestId: MediaRequestId('r_1'),
  kind: 'video',
  stage: 'approved',
  label: 'pilot',
  inputHashes: ['aa', 'bb'],
  promptHash: 'p1',
  estimatedYuan: 2.5,
}

describe('approval', () => {
  it('treats hash lists as unordered sets', () => {
    expect(sameHashSet(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameHashSet(['a'], ['a', 'b'])).toBe(false)
    expect(sameHashSet(['a', 'b'], ['a', 'c'])).toBe(false)
  })

  it('accepts an unchanged binding and rejects each mismatch', () => {
    assertApprovalMatches(request, {
      requestId: 'r_1',
      inputHashes: ['bb', 'aa'],
      promptHash: 'p1',
      estimatedYuan: 2.5,
    })
    expect(() => assertApprovalMatches(request, {
      requestId: 'r_other',
      inputHashes: request.inputHashes,
      promptHash: 'p1',
      estimatedYuan: 2.5,
    })).toThrow(MediaError)
    expect(() => assertApprovalMatches(request, {
      requestId: 'r_1',
      inputHashes: request.inputHashes,
      promptHash: 'changed',
      estimatedYuan: 2.5,
    })).toThrow(MediaError)
    expect(() => assertApprovalMatches(request, {
      requestId: 'r_1',
      inputHashes: ['aa'],
      promptHash: 'p1',
      estimatedYuan: 2.5,
    })).toThrow(MediaError)
    expect(() => assertApprovalMatches(request, {
      requestId: 'r_1',
      inputHashes: request.inputHashes,
      promptHash: 'p1',
      estimatedYuan: 1,
    })).toThrow(MediaError)
  })
})
