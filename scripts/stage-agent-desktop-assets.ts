/**
 * Stage the pinned agent-desktop archive into an installed plugin tree.
 * The archive hash is checked before extract. This script does not download.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** sha256 of the pinned v1.2.0 aarch64 macOS archive. */
export const ARCHIVE_SHA256 = '219813428bb1ad8decae172faed05c5964a2415170df402e2786ccfa6452ba82'

/**
 * Verify the archive, extract the two binaries, and copy the text assets and flock addon.
 * @param options - archive path, destination plugin root, and repository roots.
 * @returns when `dest/native` holds the staged files.
 * @throws {Error} when the archive digest does not match the pin.
 */
export async function stageAssets(options: {
  readonly archive: string
  readonly dest: string
  readonly packageRoot: string
  readonly repoRoot: string
}): Promise<void> {
  const digest = await sha256(options.archive)
  if (digest !== ARCHIVE_SHA256) {
    throw new Error(`desktop-operation: archive digest mismatch: ${digest}`)
  }
  const temp = await mkdtemp(join(tmpdir(), 'ad01-stage-'))
  try {
    const extracted = spawnSync('tar', ['-xzf', options.archive, '-C', temp], { encoding: 'utf8' })
    if (extracted.status !== 0) throw new Error(`desktop-operation: tar failed: ${extracted.stderr}`)
    const native = join(options.dest, 'native')
    await mkdir(join(native, 'skills', 'agent-desktop'), { recursive: true })
    await copyFile(join(temp, 'agent-desktop'), join(native, 'agent-desktop'))
    await copyFile(join(temp, 'agent-desktop-macos-helper'), join(native, 'agent-desktop-macos-helper'))
    await chmod(join(native, 'agent-desktop'), 0o755)
    await chmod(join(native, 'agent-desktop-macos-helper'), 0o755)
    await copyFile(join(options.packageRoot, 'native', 'LICENSE'), join(native, 'LICENSE'))
    await copyFile(join(options.packageRoot, 'native', 'PIN.json'), join(native, 'PIN.json'))
    await copyFile(
      join(options.packageRoot, 'preset', 'desktop-operation', 'skills', 'agent-desktop', 'SKILL.md'),
      join(native, 'skills', 'agent-desktop', 'SKILL.md'),
    )
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
  await copyAddonRuntime(options.repoRoot, options.dest)
}

const ENTRY_RUNTIME = ['package.json', 'lib/flock.js'] as const
const PLATFORM_RUNTIME = ['package.json', 'LICENSE', 'bin/system.node'] as const

/**
 * Copy the built flock runtime into an installed plugin tree.
 * The list is the files `flock.js` loads. Source, tests, and build info stay out.
 * @param repoRoot - repository root that contains `native/system/packages`.
 * @param dest - plugin directory that will contain `node_modules`.
 * @returns when both packages have been copied.
 * @throws {Error} when a built runtime file is absent.
 */
export async function copyAddonRuntime(repoRoot: string, dest: string): Promise<void> {
  const scope = join(dest, 'node_modules', '@deepseek-ai')
  await copyRuntime(
    join(repoRoot, 'native', 'system', 'packages', 'entry'),
    join(scope, 'node-addon-system'),
    ENTRY_RUNTIME,
  )
  await copyRuntime(
    join(repoRoot, 'native', 'system', 'packages', 'darwin-arm64'),
    join(scope, 'node-addon-system-darwin-arm64'),
    PLATFORM_RUNTIME,
  )
}

async function copyRuntime(source: string, dest: string, files: readonly string[]): Promise<void> {
  for (const relative of files) {
    const from = join(source, relative)
    try {
      await stat(from)
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') throw new Error(`desktop-operation: built runtime is absent: ${relative}`)
      throw error
    }
    const target = join(dest, relative)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(from, target)
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path).on('error', reject).on('data', (chunk) => { hash.update(chunk) }).on('end', () => { resolve(hash.digest('hex')) })
  })
}

function argument(flag: string): string {
  const index = process.argv.indexOf(flag)
  const value = process.argv[index + 1]
  if (index < 0 || value === undefined || value.startsWith('--')) throw new Error(`desktop-operation: missing ${flag}`)
  return value
}

const entry = process.argv[1]
if (entry !== undefined && (basename(entry) === 'stage-agent-desktop-assets.ts' || basename(entry) === 'stage-agent-desktop-assets.js')) {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url))
  void stageAssets({
    archive: argument('--archive'),
    dest: argument('--dest'),
    packageRoot: join(repoRoot, 'packages', 'experimental', 'desktop-operation'),
    repoRoot,
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
