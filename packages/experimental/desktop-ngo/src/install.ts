/**
 * Install or repair the packaged public-service preset.
 * A missing directory is copied whole; an existing directory keeps every file
 * it has, gains packaged files it is missing, and has only a composition this
 * runtime cannot mount replaced.
 * @module @deepseek-ai/dsh-experimental-desktop-ngo/install
 */

import { access, copyFile, cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** Preset id and user-home directory name. */
export const NGO_PRESET_ID = 'env-ngo-project-assistant'

/**
 * Locate the packaged preset directory.
 * @returns absolute package-asset directory.
 */
export function packagedPresetDirectory(): string {
  return fileURLToPath(new URL('../preset/env-ngo-project-assistant/', import.meta.url))
}

/**
 * Whether a composition cannot mount on this runtime.
 * @param composition - `agent.cordis.yml` text.
 * @returns true when the file must be replaced from the package.
 */
export function compositionNeedsRepair(composition: string): boolean {
  return composition.includes('@deepseek-ai/dsh-workflow-worker-thread')
    || /^\s*text:\s*>/m.test(composition)
}

/**
 * Copy the packaged preset when absent, add missing packaged files to an
 * existing directory, and replace only a composition this runtime cannot
 * mount. Existing files are never overwritten, so user edits survive.
 * @param ctx - Host context whose logger receives install diagnostics.
 * @param target - destination override used by tests.
 * @returns true when the preset directory is usable.
 */
export async function installNgoPreset(
  ctx: Context,
  target: string = dshHomePath('.agent-presets', NGO_PRESET_ID),
): Promise<boolean> {
  const packaged = packagedPresetDirectory()
  try {
    await access(target)
  } catch (error: unknown) {
    if (!isCode(error, 'ENOENT')) {
      ctx.logger.error(`desktop-ngo: cannot inspect ${target}: ${errorMessage(error)}`)
      return false
    }
    try {
      await mkdir(dirname(target), { recursive: true })
      await cp(packaged, target, { recursive: true })
      ctx.logger.info(`desktop-ngo: installed preset at ${target}`)
      return true
    } catch (copyError: unknown) {
      ctx.logger.error(`desktop-ngo: failed to install preset at ${target}: ${errorMessage(copyError)}`)
      return false
    }
  }
  const compositionPath = join(target, 'agent.cordis.yml')
  let composition = ''
  try {
    composition = await readFile(compositionPath, 'utf8')
  } catch (error: unknown) {
    if (!isCode(error, 'ENOENT')) {
      ctx.logger.error(`desktop-ngo: cannot read ${compositionPath}: ${errorMessage(error)}`)
      return false
    }
  }
  if (composition === '' || compositionNeedsRepair(composition)) {
    try {
      await writeFile(compositionPath, await readFile(join(packaged, 'agent.cordis.yml')))
      await writeFile(join(target, 'preset.yml'), await readFile(join(packaged, 'preset.yml')))
      ctx.logger.info(`desktop-ngo: replaced stale preset composition at ${target}`)
    } catch (error: unknown) {
      ctx.logger.error(`desktop-ngo: failed to repair ${target}: ${errorMessage(error)}`)
      return false
    }
  }
  try {
    await copyMissingFiles(packaged, target)
  } catch (error: unknown) {
    // A partial refresh degrades the preset but must not block its roster entry.
    ctx.logger.error(`desktop-ngo: failed to add missing preset files at ${target}: ${errorMessage(error)}`)
  }
  return true
}

/**
 * Copy packaged files the destination is missing, one directory level at a
 * time. Missing directories are created; an existing path is never replaced.
 * @param from - packaged preset directory.
 * @param to - live preset directory.
 */
async function copyMissingFiles(from: string, to: string): Promise<void> {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name)
    const destination = join(to, entry.name)
    if (entry.isDirectory()) {
      await mkdir(destination, { recursive: true })
      await copyMissingFiles(source, destination)
      continue
    }
    if (await exists(destination)) continue
    await copyFile(source, destination)
  }
}

/** Whether a path of any type exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    // Any stat failure means the path is absent or unreadable; copyFile reports a real write failure.
    return false
  }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
