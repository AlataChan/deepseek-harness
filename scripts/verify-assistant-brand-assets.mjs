/** Reject stale application icons or missing portraits in the packaged Client plugins. */
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const app = process.argv[2]
const windows = process.argv[3] === '--windows'
if (!app) throw new Error('Usage: node scripts/verify-assistant-brand-assets.mjs <app-directory> [--windows]')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
if (windows) {
  const binary = ['dsh-desktop.exe', 'octopus_DSH.exe'].map(name => path.join(app, name)).find(file => existsSync(file))
  if (!binary) throw new Error('Installed Windows application binary is missing')
  const quote = text => `'${text.replaceAll("'", "''")}'`
  const icon = path.join(root, 'apps/desktop/src-tauri/icons/icon.ico')
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Drawing
$expectedIcon=[System.Drawing.Icon]::new(${quote(icon)},32,32)
$actualIcon=[System.Drawing.Icon]::ExtractAssociatedIcon(${quote(binary)})
$expected=$expectedIcon.ToBitmap(); $actual=$actualIcon.ToBitmap()
try {
  if ($actual.Width -ne 32 -or $actual.Height -ne 32) { throw 'Unexpected installed application icon dimensions' }
  for ($y=0; $y -lt 32; $y++) { for ($x=0; $x -lt 32; $x++) {
    $a=$actual.GetPixel($x,$y); $e=$expected.GetPixel($x,$y)
    if ($a.A -ne $e.A -or ($a.A -gt 0 -and $a.ToArgb() -ne $e.ToArgb())) { throw 'Installed Windows application icon is stale' }
  } }
} finally { $expected.Dispose(); $actual.Dispose(); $expectedIcon.Dispose(); $actualIcon.Dispose() }`
  const probe = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30000 })
  if (probe.error) throw probe.error
  if (probe.status !== 0) throw new Error(probe.stderr || probe.stdout || 'Installed Windows application icon verification failed')
} else {
  const sourceIcon = readFileSync(path.join(root, 'apps/desktop/src-tauri/icons/icon.icns'))
  const packagedIcon = readFileSync(path.join(app, 'Contents/Resources/icon.icns'))
  if (digest(sourceIcon) !== digest(packagedIcon)) throw new Error('Packaged application icon is stale; rebuild the Tauri bundle')
}

const resources = windows ? path.join(app, 'resources') : path.join(app, 'Contents/Resources/resources')
const source = [
  ['client-ui-assistants', 'character-images.ts', 5],
  ['desktop-ask-data', 'brand-marks.ts', 3],
]
for (const [name, file, count] of source) {
  const text = readFileSync(path.join(root, 'packages/experimental', name, 'src/client', file), 'utf8')
  const images = text.match(/data:image\/webp;base64,[A-Za-z0-9+/=]+/g) ?? []
  if (new Set(images).size !== count) throw new Error(`Expected ${count} unique approved images in ${file}`)
  const packageName = `@deepseek-ai/dsh-experimental-${name}`
  const directories = [path.join(resources, 'profile-plugins', packageName)]
  const runtimeCopy = path.join(resources, 'harness/node_modules', packageName)
  // Client plugins ship in the seed; also inspect a runtime copy when a Host dependency includes one.
  if (existsSync(runtimeCopy)) directories.push(runtimeCopy)
  for (const dir of directories) {
    const client = readFileSync(path.join(dir, 'lib/client.js'), 'utf8')
    for (const image of images) {
      const bytes = Buffer.from(image.split(',')[1], 'base64')
      if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`Invalid WebP in ${file}`)
      if (!client.includes(image)) throw new Error(`Missing approved image in ${dir}/lib/client.js; rebuild and reseed the Client bundle`)
    }
  }
}
console.log('Approved application icon and all eight embedded images match the packaged Client plugins')
