// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import type { HeroAtmosphereInjected } from '../src/client/HeroAtmosphere.tsx'

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
})

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register(
    { name: 'root', children: { conversation: { kind: 'single', scope: 'root' } } } as never,
    () => null,
  )
  slots.register(
    { name: 'conversation', children: { 'conversation.atmosphere': { kind: 'single', scope: 'root' } } } as never,
    () => null,
  )
  return { ctx, slots }
}

describe('desktop-hero-atmosphere client apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('injects the plate into conversation.atmosphere', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('conversation.atmosphere')).toHaveLength(1)
    const injected = (b.slots.entries('conversation.atmosphere')[0]!.inject as unknown as () => HeroAtmosphereInjected)()
    expect(injected.posterUrl.endsWith('/media/poster.jpg')).toBe(true)
    expect(injected.driftUrl.endsWith('/media/k1.jpg')).toBe(true)
    expect(injected.videoUrl.endsWith('/media/hero.mp4')).toBe(true)
    expect(injected.hooks.reducedMotion.getSnapshot()).toBe(false)
  })
})
