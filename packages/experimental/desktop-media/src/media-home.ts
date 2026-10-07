/**
 * Resolve the managed media file root and the packaged media-runtime home.
 * @module @deepseek-ai/dsh-experimental-desktop-media/media-home
 */

import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { dshHomeDisplay, resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { MediaError } from './error.ts'

/** Filename under `$DSH_HOME/media` written by `scripts/install-media-runtime.sh`. */
export const USER_RUNTIME_HOME_FILE = 'user-runtime-home'

/** Plugin fields that can pin the media-runtime tree. */
export interface MediaRuntimeHomeConfig {
  /** Absolute media-runtime root. Empty falls through to `OCTOPUS_MEDIA_HOME`. */
  readonly mediaRuntimePath?: string
}

/**
 * Absolute managed media directory: `$DSH_HOME/media`.
 * @param env - process environment, injectable for tests.
 * @returns canonical absolute media root.
 */
export function resolveMediaHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveDshHome(undefined, env), 'media')
}

/**
 * Absolute media-runtime root (`bin/ffmpeg` and `bin/ffprobe` live under it).
 * @param config - plugin config.
 * @param env - process environment, injectable for tests.
 * @returns canonical absolute runtime home.
 */
export function resolveMediaRuntimeHome(
  config: MediaRuntimeHomeConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = config.mediaRuntimePath?.trim() ?? ''
  if (configured !== '') {
    if (!isAbsolute(configured)) {
      throw new MediaError('runtime-relative', 'mediaRuntimePath must be an absolute path')
    }
    return resolve(configured)
  }
  const fromEnv = env.OCTOPUS_MEDIA_HOME?.trim() ?? ''
  if (fromEnv !== '' && isAbsolute(fromEnv)) return resolve(fromEnv)
  const recorded = readUserRuntimeHomeSync(env)
  if (recorded !== undefined) return recorded
  throw new MediaError(
    'runtime-missing',
    'media runtime is missing; run scripts/install-media-runtime.sh',
  )
}

/**
 * Read the install-script marker synchronously.
 * @param env - process environment, injectable for tests.
 * @returns absolute runtime home, or undefined.
 */
export function readUserRuntimeHomeSync(env: NodeJS.ProcessEnv = process.env): string | undefined {
  let text: string
  try {
    text = readFileSync(userRuntimeHomeFile(env), 'utf8')
  } catch {
    // Missing or unreadable marker means no user-owned prefix is recorded.
    return undefined
  }
  const trimmed = text.trim()
  if (trimmed === '' || !isAbsolute(trimmed)) return undefined
  return resolve(trimmed)
}

/**
 * Absolute path of the user-runtime marker file.
 * @param env - process environment, injectable for tests.
 * @returns `$DSH_HOME/media/user-runtime-home`.
 */
export function userRuntimeHomeFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveMediaHome(env), USER_RUNTIME_HOME_FILE)
}

/**
 * Read a recorded user-runtime prefix if the marker file names an absolute path.
 * @param env - process environment, injectable for tests.
 * @param readText - injectable file reader.
 * @returns absolute runtime home, or undefined when unset.
 */
export async function readUserRuntimeHome(
  env: NodeJS.ProcessEnv = process.env,
  readText: (path: string) => Promise<string> = path => readFile(path, 'utf8'),
): Promise<string | undefined> {
  let text: string
  try {
    text = await readText(userRuntimeHomeFile(env))
  } catch {
    // Missing or unreadable marker means no user-owned prefix is recorded.
    return undefined
  }
  const trimmed = text.trim()
  if (trimmed === '' || !isAbsolute(trimmed)) return undefined
  return resolve(trimmed)
}

/**
 * Write the user-runtime marker used by the install script.
 * @param runtimeHome - absolute Homebrew or other user prefix.
 * @param env - process environment, injectable for tests.
 */
export async function writeUserRuntimeHome(
  runtimeHome: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!isAbsolute(runtimeHome)) {
    throw new MediaError('runtime-relative', 'user runtime home must be an absolute path')
  }
  const marker = userRuntimeHomeFile(env)
  await mkdir(resolveMediaHome(env), { recursive: true })
  await writeFile(marker, resolve(runtimeHome), 'utf8')
}

/**
 * Resolve a runtime home without throwing when none is configured.
 * @param config - plugin config.
 * @param env - process environment, injectable for tests.
 * @param readText - injectable marker-file reader.
 * @returns absolute runtime home, or undefined.
 */
export async function tryResolveMediaRuntimeHome(
  config: MediaRuntimeHomeConfig,
  env: NodeJS.ProcessEnv = process.env,
  readText: (path: string) => Promise<string> = path => readFile(path, 'utf8'),
): Promise<string | undefined> {
  const configured = config.mediaRuntimePath?.trim() ?? ''
  if (configured !== '') {
    if (!isAbsolute(configured)) {
      throw new MediaError('runtime-relative', 'mediaRuntimePath must be an absolute path')
    }
    return resolve(configured)
  }
  const fromEnv = env.OCTOPUS_MEDIA_HOME?.trim() ?? ''
  if (fromEnv !== '' && isAbsolute(fromEnv)) return resolve(fromEnv)
  return readUserRuntimeHome(env, readText)
}

/**
 * Conventional ffmpeg/ffprobe paths under a media-runtime home.
 * @param runtimeHome - absolute runtime root.
 * @returns absolute binary paths.
 */
export function mediaRuntimeBinaries(runtimeHome: string): { ffmpeg: string; ffprobe: string } {
  return {
    ffmpeg: join(runtimeHome, 'bin', 'ffmpeg'),
    ffprobe: join(runtimeHome, 'bin', 'ffprobe'),
  }
}

/**
 * Symbolic media-root label that never leaks a machine path.
 * @param env - process environment, injectable for tests.
 * @returns `~/.dsh/media` or `$DSH_HOME/media`.
 */
export function mediaHomeDisplay(env: NodeJS.ProcessEnv = process.env): string {
  return `${dshHomeDisplay(resolveDshHome(undefined, env))}/media`
}
