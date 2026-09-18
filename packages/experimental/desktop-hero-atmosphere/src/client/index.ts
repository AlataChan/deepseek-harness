/**
 * Browser half of the desktop Hero atmosphere plate.
 * @module @deepseek-ai/dsh-experimental-desktop-hero-atmosphere/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { HERO_DRIFT_URL, HERO_POSTER_URL, HERO_VIDEO_URL } from '../media-urls.ts'
import { HeroAtmosphere } from './HeroAtmosphere.tsx'
import type { HeroAtmosphereInjected } from './HeroAtmosphere.tsx'
import { createReducedMotionSource } from './reduced-motion.ts'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Occupy `conversation.atmosphere` with the baked shallow-water loop.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const reducedMotion = createReducedMotionSource()
  ctx.slots.inject('conversation.atmosphere', () => ctx.slots.register({
    name: 'conversation.atmosphere',
    inject: (): HeroAtmosphereInjected => ({
      posterUrl: HERO_POSTER_URL,
      driftUrl: HERO_DRIFT_URL,
      videoUrl: HERO_VIDEO_URL,
      hooks: { reducedMotion },
    }),
  }, HeroAtmosphere))
}
