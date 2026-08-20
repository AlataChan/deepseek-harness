/** Stage and package the Marketplace extension without copying workspace runtime files. */

import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVSIX } from '@vscode/vsce'
import { verifyExtensionArchive, verifyExtensionDirectory } from './verify-extension-manifest.ts'

function findAppRoot(scriptFile: string): string {
  let candidate = dirname(scriptFile)
  while (candidate !== dirname(candidate)) {
    if (existsSync(resolve(candidate, 'manifest.vscode.json'))) return candidate
    candidate = dirname(candidate)
  }
  throw new Error(`stage-extension: cannot locate manifest.vscode.json from ${scriptFile}`)
}

const appRoot = findAppRoot(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(appRoot, '..', '..')
const artifactRoot = resolve(repositoryRoot, '.artifacts', 'vscode')
const defaultStagingRoot = resolve(artifactRoot, 'extension')
const defaultVsixPath = resolve(artifactRoot, 'harness-client.vsix')

/** Options for one clean Marketplace staging directory. */
export interface StageExtensionOptions {
  /** Marketplace publisher override; omitted values retain the gated source placeholder. */
  readonly publisher?: string
}

function parseObject(text: string, path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must contain a JSON object`)
  }
  return value as Record<string, unknown>
}

async function assertEmpty(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory)
  if (entries.length > 0) throw new Error(`extension staging directory must be empty: ${directory}`)
}

async function copyPayload(target: string): Promise<void> {
  await Promise.all([
    cp(resolve(appRoot, 'dist'), resolve(target, 'dist'), { recursive: true }),
    cp(resolve(appRoot, 'l10n'), resolve(target, 'l10n'), { recursive: true }),
    mkdir(resolve(target, 'media'), { recursive: true }),
  ])
  await Promise.all([
    cp(resolve(repositoryRoot, 'LICENSE'), resolve(target, 'LICENSE')),
    cp(resolve(appRoot, 'README.md'), resolve(target, 'README.md')),
    cp(resolve(appRoot, '.vscodeignore'), resolve(target, '.vscodeignore')),
    cp(resolve(appRoot, 'package.nls.json'), resolve(target, 'package.nls.json')),
    cp(resolve(appRoot, 'package.nls.zh-cn.json'), resolve(target, 'package.nls.zh-cn.json')),
    cp(resolve(appRoot, 'media', 'activity.svg'), resolve(target, 'media', 'activity.svg')),
    cp(resolve(appRoot, 'media', 'icon.png'), resolve(target, 'media', 'icon.png')),
  ])
}

/**
 * Build a clean extension directory from the source manifest and repository version.
 * @param target - Empty destination owned by the caller.
 * @param options - Optional Marketplace identity override for tests or release.
 * @returns The staged Marketplace manifest.
 */
export async function stageExtension(
  target: string,
  options: StageExtensionOptions = {},
): Promise<Record<string, unknown>> {
  await assertEmpty(target)
  const [manifestText, rootManifestText] = await Promise.all([
    readFile(resolve(appRoot, 'manifest.vscode.json'), 'utf8'),
    readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
  ])
  const manifest = parseObject(manifestText, 'manifest.vscode.json')
  const rootManifest = parseObject(rootManifestText, 'package.json')
  if (typeof rootManifest.version !== 'string' || rootManifest.version === '') {
    throw new Error('repository package.json must declare a version')
  }
  const stagedManifest = {
    ...manifest,
    version: rootManifest.version,
    ...options.publisher === undefined ? {} : { publisher: options.publisher },
  }
  await copyPayload(target)
  await writeFile(resolve(target, 'package.json'), `${JSON.stringify(stagedManifest, null, 2)}\n`)
  await verifyExtensionDirectory(target)
  return stagedManifest
}

async function packageExtension(): Promise<void> {
  await rm(artifactRoot, { recursive: true, force: true })
  await mkdir(artifactRoot, { recursive: true })
  const publisher = process.env.DSH_VSCODE_PUBLISHER
  const manifest = await stageExtension(defaultStagingRoot, {
    ...publisher === undefined || publisher === '' ? {} : { publisher },
  })
  const metadata = manifest.harnessClient
  const channel = metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).releaseChannel
    : undefined
  await createVSIX({
    cwd: defaultStagingRoot,
    packagePath: defaultVsixPath,
    preRelease: channel === 'pre-release',
    dependencies: false,
    allowMissingRepository: true,
  })
  await verifyExtensionArchive(defaultVsixPath)
  console.log(`stage-extension: packaged ${defaultVsixPath}`)
}

async function main(): Promise<void> {
  if (process.argv.includes('--package')) {
    await packageExtension()
    return
  }
  await rm(defaultStagingRoot, { recursive: true, force: true })
  const publisher = process.env.DSH_VSCODE_PUBLISHER
  await stageExtension(defaultStagingRoot, {
    ...publisher === undefined || publisher === '' ? {} : { publisher },
  })
  console.log(`stage-extension: staged ${defaultStagingRoot}`)
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
