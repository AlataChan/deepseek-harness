/**
 * Open or reveal a Host-resolved media file through the system desktop.
 * @module @deepseek-ai/dsh-experimental-desktop-media/local-open
 */

import { stat } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import {
  canOpenNativePath,
  openNativePath,
  runNativeCommand,
  type NativeCommandRunner,
  type PathOpenerInternals,
} from '@deepseek-ai/dsh-native-command'
import { MediaError } from './error.ts'

/** Model-visible wording after a successful system-open request. */
export const SYSTEM_OPEN_REQUESTED = 'Requested the system to open the file.'

/** Injectable open/reveal boundary. */
export interface MediaOpenInternals extends PathOpenerInternals {
  /** Override default-application open. */
  readonly openPath?: (path: string, signal: AbortSignal) => Promise<void>
}

/**
 * Reject model-supplied URLs and relative paths before any native command.
 * @param path - candidate filesystem path.
 */
export function assertAbsoluteMediaPath(path: string): void {
  const lower = path.toLowerCase()
  if (lower.startsWith('file:') || lower.startsWith('http:') || lower.startsWith('https:')) {
    throw new MediaError('path-not-absolute', 'media open accepts only a Host-resolved filesystem path')
  }
  if (!isAbsolute(path)) {
    throw new MediaError('path-not-absolute', 'media open accepts only an absolute filesystem path')
  }
}

/**
 * Confirm the path names an existing regular file.
 * @param path - absolute filesystem path.
 */
export async function assertExistingMediaFile(path: string): Promise<void> {
  assertAbsoluteMediaPath(path)
  let info
  try {
    info = await stat(path)
  } catch {
    throw new MediaError('input-missing', 'media file is missing')
  }
  if (!info.isFile()) {
    throw new MediaError('path-not-a-file', 'media open requires a regular file')
  }
}

/**
 * Hand one registered local file to the default application.
 * Success means the opener accepted the path, not that playback occurred.
 * @param path - Host-resolved absolute file path.
 * @param signal - caller lifetime.
 * @param internals - injectable opener.
 */
export async function openMediaFile(
  path: string,
  signal: AbortSignal,
  internals: MediaOpenInternals = {},
): Promise<void> {
  await assertExistingMediaFile(path)
  const open = internals.openPath ?? ((target, openSignal) => openNativePath(target, openSignal, internals))
  await open(path, signal)
}

/**
 * Reveal one registered local file in the file manager.
 * @param path - Host-resolved absolute file path.
 * @param signal - caller lifetime.
 * @param internals - injectable platform and runner.
 */
export async function revealMediaFile(
  path: string,
  signal: AbortSignal,
  internals: MediaOpenInternals = {},
): Promise<void> {
  await assertExistingMediaFile(path)
  const platform = internals.platform ?? process.platform
  const run: NativeCommandRunner = internals.run ?? runNativeCommand
  if (platform === 'darwin') {
    await run('open', ['-R', path], signal)
    return
  }
  if (platform === 'win32') {
    await run('explorer.exe', [`/select,${path}`], signal)
    return
  }
  if (platform === 'linux') {
    await run('xdg-open', [dirname(path)], signal)
    return
  }
  throw new MediaError('open-unsupported', `reveal is unsupported on ${platform}`)
}

/**
 * Whether this Host can hand a path to a desktop opener.
 * @param internals - injectable platform facts.
 * @returns true when a desktop target is plausible.
 */
export function canOpenMediaFile(internals: PathOpenerInternals = {}): boolean {
  return canOpenNativePath(internals)
}
