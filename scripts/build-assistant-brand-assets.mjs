/** Encode approved character PNGs for offline Client bundles and desktop icons. */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const assetRoot = path.join(root, 'assets/assistant-brand')
const manifest = JSON.parse(readFileSync(path.join(assetRoot, 'manifest.json'), 'utf8'))
const portraits = {}
let brand
for (const image of manifest.images) {
  const source = path.join(assetRoot, image.file)
  if (createHash('sha256').update(readFileSync(source)).digest('hex') !== image.sha256) {
    throw new Error(`Approved image changed: ${image.file}`)
  }
  const bytes = execFileSync('magick', [source, '-resize', '256x256', '-strip', '-quality', '88', 'webp:-'])
  const uri = `data:image/webp;base64,${bytes.toString('base64')}`
  if (image.id === 'workbench-whale') brand = uri
  else portraits[image.id] = uri
}
writeFileSync(path.join(root, 'packages/experimental/client-ui-assistants/src/client/character-images.ts'),
  `/** Bundled approved portraits; regenerate with scripts/build-assistant-brand-assets.mjs. */\nexport const CHARACTER_IMAGES = ${JSON.stringify(portraits, null, 2)} as const\n`)
writeFileSync(path.join(root, 'packages/experimental/desktop-ask-data/src/client/octopus-mark-uri.ts'),
  `/** Approved white-background smiling whale; regenerate with scripts/build-assistant-brand-assets.mjs. */\nexport const OCTOPUS_MARK_URI = '${brand}'\n`)
const iconRoot = path.join(root, 'apps/desktop/src-tauri/icons')
execFileSync('magick', [path.join(assetRoot, 'workbench-whale.png'), '-resize', '1024x1024', '-strip', 'PNG32:' + path.join(iconRoot, 'octopus-dsh-icon.png')])
execFileSync('bash', [path.join(iconRoot, 'render.sh')], { stdio: 'inherit' })
console.log('Encoded 5 character portraits, the workbench mark, and PNG/ICNS/ICO desktop icons')
