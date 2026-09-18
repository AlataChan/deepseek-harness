// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { HeroAtmosphere, type HeroAtmosphereProps } from '../src/client/HeroAtmosphere.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
})

function mount(options: {
  hero?: boolean
  reduced?: boolean
} = {}) {
  const props = {
    hero: options.hero ?? true,
    posterUrl: 'poster.jpg',
    driftUrl: 'k1.jpg',
    videoUrl: 'hero.mp4',
    useReducedMotion: (select: (value: boolean) => boolean) => select(options.reduced ?? false),
  } as HeroAtmosphereProps
  return render(<HeroAtmosphere {...props} />)
}

describe('HeroAtmosphere', () => {
  it('plays the loop on the visible Hero', () => {
    const view = mount()
    const plate = view.container.querySelector('[data-hero-atmosphere]')
    expect(plate?.getAttribute('data-visible')).toBe('true')
    expect(plate?.getAttribute('data-reduced')).toBe('false')
    expect([...view.container.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual([
      'poster.jpg',
      'k1.jpg',
    ])
    expect(view.container.querySelector('video')?.getAttribute('src')).toBe('hero.mp4')
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('keeps the poster and omits the video when reduced motion is on', () => {
    const view = mount({ reduced: true })
    const plate = view.container.querySelector('[data-hero-atmosphere]')
    expect(plate?.getAttribute('data-reduced')).toBe('true')
    const images = [...view.container.querySelectorAll('img')]
    expect(images.map(img => img.getAttribute('src'))).toEqual(['poster.jpg'])
    expect(view.container.querySelector('video')).toBeNull()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })

  it('hides the plate and pauses when the shell leaves Hero', () => {
    const view = mount({ hero: false })
    expect(view.container.querySelector('[data-hero-atmosphere]')?.getAttribute('data-visible')).toBe('false')
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })

  it('falls back to the poster when playback rejects', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('autoplay'))
    const view = mount()
    await waitFor(() => {
      expect(view.container.querySelector('[data-hero-atmosphere]')?.getAttribute('data-failed')).toBe('true')
    })
    expect(view.container.querySelector('video')).toBeNull()
  })

  it('falls back to the poster when the video errors', async () => {
    const view = mount()
    const video = view.container.querySelector('video')
    expect(video).not.toBeNull()
    fireEvent.error(video!)
    await waitFor(() => {
      expect(view.container.querySelector('[data-hero-atmosphere]')?.getAttribute('data-failed')).toBe('true')
    })
    expect(view.container.querySelector('video')).toBeNull()
  })
})
