/**
 * Non-destructive installation of the packaged commerce agent preset.
 * @module @deepseek-ai/dsh-experimental-commerce-mode/install
 */

import { access, cp, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/**
 * Locate the packaged commerce preset directory.
 * @returns absolute package-asset directory.
 */
export function packagedPresetDirectory(): string {
  return fileURLToPath(new URL('../preset/commerce/', import.meta.url))
}

/**
 * Copy the packaged preset only when the destination is absent. Installation
 * failure is non-fatal and logs the exact manual copy operation.
 * @param ctx - Host context whose logger receives installation diagnostics.
 * @param target - destination override used by isolated tests.
 * @returns true when the preset is installed or already exists; false on failure.
 */
export async function installCommercePreset(
  ctx: Context,
  target: string = dshHomePath('.agent-presets', 'commerce'),
): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch (error: unknown) {
    if (!isNotFound(error)) {
      ctx.logger.error(`commerce-mode: cannot inspect preset destination ${target}: ${errorMessage(error)}; copy ${packagedPresetDirectory()} to ${target} manually`)
      return false
    }
  }
  try {
    await mkdir(dirname(target), { recursive: true })
    await cp(packagedPresetDirectory(), target, {
      recursive: true,
      force: false,
      errorOnExist: true,
    })
    ctx.logger.info(`commerce-mode: installed commerce preset at ${target}`)
    return true
  } catch (error: unknown) {
    if (isAlreadyExists(error)) return true
    ctx.logger.error(`commerce-mode: failed to install preset at ${target}: ${errorMessage(error)}; copy ${packagedPresetDirectory()} to ${target} manually`)
    return false
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
