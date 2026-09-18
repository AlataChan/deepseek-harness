// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  createReducedMotionSource,
  type ReducedMotionQuery,
} from '../src/client/reduced-motion.ts'

function mediaQuery(matches: boolean): ReducedMotionQuery & {
  listeners: Set<() => void>
  setMatches: (next: boolean) => void
} {
  const listeners = new Set<() => void>()
  const query = {
    matches,
    listeners,
    addEventListener: (_type: 'change', listener: () => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: 'change', listener: () => void) => {
      listeners.delete(listener)
    },
    setMatches: (next: boolean) => {
      query.matches = next
      for (const listener of listeners) listener()
    },
  }
  return query
}

describe('createReducedMotionSource', () => {
  it('reads the live query and unsubscribes', () => {
    const media = mediaQuery(false)
    const source = createReducedMotionSource(media)
    expect(source.getSnapshot()).toBe(false)
    const listener = vi.fn()
    const dispose = source.subscribe(listener)
    media.setMatches(true)
    expect(source.getSnapshot()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    dispose()
    media.setMatches(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('defaults to the window reduced-motion query', () => {
    const media = mediaQuery(true)
    const matchMedia = vi.fn(() => media)
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: matchMedia })
    const source = createReducedMotionSource()
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    expect(source.getSnapshot()).toBe(true)
  })
})
