import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clientBundle } from '../../client/tsdown.client.ts'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const preset = clientBundle(
  '@deepseek-ai/dsh-experimental-desktop-hero-atmosphere',
  ['lib/types/index.js'],
)

/**
 * Client-face tsdown reads `lib/types/media-urls.js` (tsc emit). A source-only
 * `load` miss lets CJS rewrite `import.meta.url` to Node `require("url")`.
 */
function isHeroMediaModule(id: string): boolean {
  const normalized = (id.replaceAll('\\', '/').split('?')[0] ?? '')
  return normalized.endsWith('/src/media-urls.ts')
    || normalized.endsWith('/lib/types/media-urls.js')
}

/**
 * Inline the packaged plate as `data:` URLs. The dynamic Client factory is
 * CJS and would otherwise rewrite `import.meta.url` to Node `require("url")`.
 */
function inlineHeroMedia() {
  return {
    name: 'inline-hero-media',
    load(id: string) {
      if (!isHeroMediaModule(id)) return null
      const poster = readFileSync(resolve(packageRoot, 'media/poster.jpg')).toString('base64')
      const drift = readFileSync(resolve(packageRoot, 'media/k1.jpg')).toString('base64')
      const video = readFileSync(resolve(packageRoot, 'media/hero.mp4')).toString('base64')
      return [
        `export const HERO_POSTER_URL = ${JSON.stringify(`data:image/jpeg;base64,${poster}`)}`,
        `export const HERO_DRIFT_URL = ${JSON.stringify(`data:image/jpeg;base64,${drift}`)}`,
        `export const HERO_VIDEO_URL = ${JSON.stringify(`data:video/mp4;base64,${video}`)}`,
      ].join('\n')
    },
  }
}

export default (
  inlineConfig: { env?: Record<string, string> },
) => preset(inlineConfig).map(config => {
  if (config.name !== '@deepseek-ai/dsh-experimental-desktop-hero-atmosphere/client') {
    return config
  }
  return {
    ...config,
    plugins: [inlineHeroMedia(), ...config.plugins ?? []],
  }
})
