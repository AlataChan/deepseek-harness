/**
 * The browser entry registers nothing. The roster card is the Host preset.
 */
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

describe('desktop-operation client entry', () => {
  it('exports an empty inject list and a no-op apply', () => {
    expect(inject).toEqual([])
    function observeApply(): unknown {
      const invoke: () => unknown = apply
      return invoke()
    }
    expect(observeApply()).toBeUndefined()
  })
})
