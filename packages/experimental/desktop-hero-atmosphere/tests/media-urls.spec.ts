import { describe, expect, it } from 'vitest'
import { HERO_DRIFT_URL, HERO_POSTER_URL, HERO_VIDEO_URL } from '../src/media-urls.ts'

describe('hero media URLs', () => {
  it('resolve the packaged poster, drift still, and loop', () => {
    expect(HERO_POSTER_URL.endsWith('/media/poster.jpg')).toBe(true)
    expect(HERO_DRIFT_URL.endsWith('/media/k1.jpg')).toBe(true)
    expect(HERO_VIDEO_URL.endsWith('/media/hero.mp4')).toBe(true)
  })
})
