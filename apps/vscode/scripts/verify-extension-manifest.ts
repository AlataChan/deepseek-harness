/** Validate Marketplace identity, localization, and the staged or packed VS Code payload. */

import { readdir, readFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const REQUIRED_FILES = [
  'LICENSE',
  'README.md',
  'dist/extension.js',
  'l10n/bundle.l10n.json',
  'l10n/bundle.l10n.zh-cn.json',
  'media/activity.svg',
  'package.json',
  'package.nls.json',
  'package.nls.zh-cn.json',
] as const

const MARKETPLACE_ICON_SIZE = 128

type ReadPayloadFile = (path: string) => Promise<Uint8Array>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function placeholder(value: unknown): boolean {
  return typeof value !== 'string' || value === '' || /^__.+__$/.test(value) || /(?:placeholder|\btodo\b)/i.test(value)
}

function parseJson(bytes: Uint8Array, path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`)
  return parsed
}

function normalize(path: string): string {
  return path.split(sep).join('/')
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, path))
    } else if (entry.isFile()) {
      files.push(normalize(relative(root, path)))
    } else {
      throw new Error(`staged extension must not contain links: ${normalize(relative(root, path))}`)
    }
  }
  return files.sort()
}

function verifyPayloadFiles(files: readonly string[]): string[] {
  const errors: string[] = []
  const fileSet = new Set(files)
  for (const required of REQUIRED_FILES) {
    if (!fileSet.has(required)) errors.push(`${required} is missing from the extension payload`)
  }

  const runtime = files.filter(file =>
    file === 'cordis.patch.yml'
    || file.startsWith('node_modules/')
    || file.startsWith('packages/')
    || file.startsWith('apps/cli/')
    || file.startsWith('runtime/'))
  if (runtime.length > 0) {
    errors.push(`extension must not bundle the Harness runtime: ${runtime.join(', ')}`)
  }

  for (const file of files) {
    if (file.endsWith('.map')
      || file.endsWith('.ts')
      || file.endsWith('.tsx')
      || file === 'manifest.vscode.json'
      || file.startsWith('src/')
      || file.startsWith('test/')
      || file.startsWith('tests/')
      || file.includes('/tests/')
      || file === '.env'
      || file.startsWith('.env.')) {
      errors.push(`extension payload contains forbidden source or private file: ${file}`)
      continue
    }
    if (runtime.includes(file)) continue
    if (file === 'LICENSE'
      || file === 'README.md'
      || file === 'package.json'
      || file === 'package.nls.json'
      || file === 'package.nls.zh-cn.json'
      || file === 'media/activity.svg'
      || file === 'media/icon.png'
      || /^l10n\/bundle\.l10n(?:\.zh-cn)?\.json$/.test(file)
      || /^dist\/extension\.js$/.test(file)
      || /^dist\/webview\/[^/]+\.(?:css|js)$/.test(file)) {
      continue
    }
    errors.push(`extension payload contains an undeclared file: ${file}`)
  }
  return errors
}

function verifyIdentity(manifest: Record<string, unknown>, files: ReadonlySet<string>): string[] {
  const errors: string[] = []
  if (placeholder(manifest.publisher)) errors.push('publisher remains a placeholder')
  if (placeholder(manifest.displayName)) errors.push('displayName remains a placeholder')
  if (placeholder(manifest.icon)) {
    errors.push('icon remains a placeholder')
  } else if (!files.has(String(manifest.icon))) {
    errors.push(`icon file is missing: ${String(manifest.icon)}`)
  }

  const metadata = manifest.harnessClient
  const releaseChannel = isRecord(metadata) ? metadata.releaseChannel : undefined
  if (placeholder(releaseChannel)) {
    errors.push('releaseChannel remains a placeholder')
  } else if (releaseChannel !== 'stable' && releaseChannel !== 'pre-release') {
    errors.push('releaseChannel must be stable or pre-release')
  }

  const companion = isRecord(metadata) ? metadata.companion : undefined
  if (!isRecord(companion)
    || companion.required !== true
    || companion.package !== '@deepseek-ai/dsh'
    || companion.profile !== 'vscode'
    || companion.bundled !== false) {
    errors.push('manifest must declare the installed companion requirement')
  }
  return errors
}

async function verifyLocalization(
  manifest: Record<string, unknown>,
  readPayloadFile: ReadPayloadFile,
): Promise<string[]> {
  const errors: string[] = []
  let english: Record<string, unknown>
  let chinese: Record<string, unknown>
  try {
    english = parseJson(await readPayloadFile('package.nls.json'), 'package.nls.json')
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
  try {
    chinese = parseJson(await readPayloadFile('package.nls.zh-cn.json'), 'package.nls.zh-cn.json')
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
  const references = [...JSON.stringify(manifest).matchAll(/%([^%]+)%/g)]
    .map(match => match[1])
    .filter(key => key !== undefined)
  for (const key of references) {
    if (!Object.hasOwn(english, key)) errors.push(`${key} is absent from package.nls.json`)
    if (!Object.hasOwn(chinese, key)) errors.push(`${key} is absent from package.nls.zh-cn.json`)
  }
  return errors
}

async function verifyIcon(readPayloadFile: ReadPayloadFile): Promise<string[]> {
  try {
    const icon = Buffer.from(await readPayloadFile('media/icon.png'))
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    if (icon.length < 24 || !icon.subarray(0, 8).equals(signature)) {
      return ['media/icon.png must be a PNG image']
    }
    const width = icon.readUInt32BE(16)
    const height = icon.readUInt32BE(20)
    if (width !== MARKETPLACE_ICON_SIZE || height !== MARKETPLACE_ICON_SIZE) {
      return [`media/icon.png must be ${String(MARKETPLACE_ICON_SIZE)}x${String(MARKETPLACE_ICON_SIZE)}, got ${String(width)}x${String(height)}`]
    }
    return []
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
}

async function verifyWebviewScripts(
  files: readonly string[],
  readPayloadFile: ReadPayloadFile,
): Promise<string[]> {
  const errors: string[] = []
  for (const file of files.filter(file => /^dist\/webview\/[^/]+\.js$/.test(file))) {
    const source = new TextDecoder().decode(await readPayloadFile(file))
    if (/\bnew\s+Function\s*\(/.test(source) || /\beval\s*\(/.test(source)) {
      errors.push(`${file}: Webview script contains CSP-forbidden dynamic code`)
    }
    if (/\bprocess\s*(?:\.|\[)/.test(source)) {
      errors.push(`${file}: Webview script contains the Node process global`)
    }
  }
  return errors
}

async function verifyPayload(files: readonly string[], readPayloadFile: ReadPayloadFile): Promise<void> {
  const errors = verifyPayloadFiles(files)
  let manifest: Record<string, unknown> | undefined
  try {
    manifest = parseJson(await readPayloadFile('package.json'), 'package.json')
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  if (manifest !== undefined) {
    errors.push(...verifyIdentity(manifest, new Set(files)))
    errors.push(...await verifyLocalization(manifest, readPayloadFile))
  }
  errors.push(...await verifyIcon(readPayloadFile))
  errors.push(...await verifyWebviewScripts(files, readPayloadFile))
  if (errors.length > 0) throw new Error(`VS Code extension verification failed:\n${errors.map(error => `- ${error}`).join('\n')}`)
}

/**
 * Verify a staged extension directory before VSIX creation.
 * @param root - Absolute or current-directory-relative staging root.
 * @returns A promise that rejects with every payload violation.
 */
export async function verifyExtensionDirectory(root: string): Promise<void> {
  const absoluteRoot = resolve(root)
  const files = (await listFiles(absoluteRoot)).filter(file => file !== '.vscodeignore')
  await verifyPayload(files, path => readFile(resolve(absoluteRoot, path)))
}

/**
 * Verify the actual files stored in a VSIX archive.
 * @param path - Absolute or current-directory-relative VSIX path.
 * @returns A promise that rejects with every payload violation.
 */
export async function verifyExtensionArchive(path: string): Promise<void> {
  const archive = unzipSync(new Uint8Array(await readFile(resolve(path))))
  const entries = new Map<string, Uint8Array>()
  for (const [entry, bytes] of Object.entries(archive)) {
    if (!entry.startsWith('extension/') || entry.endsWith('/')) continue
    const relativePath = entry.slice('extension/'.length)
    const payloadPath = relativePath === 'LICENSE.txt'
      ? 'LICENSE'
      : relativePath === 'readme.md'
        ? 'README.md'
        : relativePath
    if (entries.has(payloadPath)) throw new Error(`VSIX contains duplicate payload path: ${payloadPath}`)
    entries.set(payloadPath, bytes)
  }
  await verifyPayload([...entries.keys()].sort(), async (entry) => {
    const bytes = entries.get(entry)
    if (bytes === undefined) throw new Error(`${entry} is missing from the VSIX`)
    return bytes
  })
}

async function main(): Promise<void> {
  const vsixIndex = process.argv.indexOf('--vsix')
  if (vsixIndex >= 0) {
    const path = process.argv[vsixIndex + 1]
    if (path === undefined) throw new Error('usage: verify-extension-manifest.ts --vsix <path>')
    await verifyExtensionArchive(path)
    console.log(`verify-extension-manifest: verified ${path}`)
    return
  }
  const root = process.argv[2]
  if (root === undefined) throw new Error('usage: verify-extension-manifest.ts <staged-directory>')
  await verifyExtensionDirectory(root)
  console.log(`verify-extension-manifest: verified ${root}`)
}

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
