import { describe, expect, it } from 'vitest'
import { MediaArtifactId, MediaRequestId, MediaVoiceId, mintMediaId } from '../src/ids.ts'

describe('ids', () => {
  it('brands and mints opaque ids', () => {
    expect(MediaRequestId('r_1')).toBe('r_1')
    expect(MediaArtifactId('a_1')).toBe('a_1')
    expect(MediaVoiceId('v_1')).toBe('v_1')
    expect(mintMediaId('r')).toMatch(/^r_/)
    expect(mintMediaId('a')).toMatch(/^a_/)
    expect(mintMediaId('v')).toMatch(/^v_/)
  })
})
