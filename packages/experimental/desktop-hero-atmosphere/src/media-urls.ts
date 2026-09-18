/**
 * Packaged Hero media URLs. Source tests resolve files next to this module.
 * The Client bundle replaces this module with inlined `data:` URLs so the
 * browser factory never evaluates Node `import.meta.url`.
 * @module @deepseek-ai/dsh-experimental-desktop-hero-atmosphere/media-urls
 */

/** Packaged blank-session poster (K0). */
export const HERO_POSTER_URL = new URL('../media/poster.jpg', import.meta.url).href
/** Packaged drifted still (K1) used when the video element cannot play. */
export const HERO_DRIFT_URL = new URL('../media/k1.jpg', import.meta.url).href
/** Packaged blank-session caustic loop. */
export const HERO_VIDEO_URL = new URL('../media/hero.mp4', import.meta.url).href
