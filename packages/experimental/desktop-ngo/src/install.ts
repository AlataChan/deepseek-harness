/**
 * Install or repair the packaged public-service preset.
 * An existing directory is left alone unless its composition still names a
 * package 0.2.1 removed, or its persona row still uses the old `text` key.
 * @module @deepseek-ai/dsh-experimental-desktop-ngo/install
 */

import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
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
 * Copy the packaged preset when absent, or replace only a composition this
 * runtime cannot mount. Skill files already on disk are kept.
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
  if (composition !== '' && !compositionNeedsRepair(composition)) return true
  try {
    await writeFile(compositionPath, await readFile(join(packaged, 'agent.cordis.yml')))
    await writeFile(join(target, 'preset.yml'), await readFile(join(packaged, 'preset.yml')))
    ctx.logger.info(`desktop-ngo: replaced stale preset composition at ${target}`)
    return true
  } catch (error: unknown) {
    ctx.logger.error(`desktop-ngo: failed to repair ${target}: ${errorMessage(error)}`)
    return false
  }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
