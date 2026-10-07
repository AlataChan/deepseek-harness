import { describe, expect, it } from 'vitest'
import { MEDIA_CREATION_PROMPT } from '../src/prompt.ts'

describe('prompt', () => {
  it('tells the model not to claim playback', () => {
    expect(MEDIA_CREATION_PROMPT).toContain('media_create_video')
    expect(MEDIA_CREATION_PROMPT).toContain('Do not claim playback')
  })
})
