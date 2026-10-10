/** The browser half of desktop-speech-transcribe registers nothing. */
import { describe, expect, it } from 'vitest'
import * as client from '../src/client/index.ts'

describe('speech transcribe client half', () => {
  it('declares no services and no registration', () => {
    expect(client.inject).toEqual([])
    expect(() => { client.apply() }).not.toThrow()
  })
})
