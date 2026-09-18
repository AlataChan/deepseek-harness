import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('desktop-hero-atmosphere host apply', () => {
  it('is a no-op Host row', () => {
    expect(() => { apply() }).not.toThrow()
  })
})
