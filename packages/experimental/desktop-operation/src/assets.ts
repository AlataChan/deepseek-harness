/**
 * Paths of the pinned native assets that travel with the installed plugin.
 * @module @deepseek-ai/dsh-experimental-desktop-operation/assets
 */

import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute paths of one staged agent-desktop asset set. */
export interface NativeAssets {
  /** Pinned `agent-desktop` executable. */
  readonly binary: string
  /** Sibling macOS helper. */
  readonly helper: string
  /** Apache-2.0 license copied beside the binaries. */
  readonly license: string
  /** Digest record for the unsigned binaries and the text assets. */
  readonly pin: string
  /** Pinned skill markdown. */
  readonly skill: string
}

/**
 * Resolve native assets from an absolute override or from `../native` beside this module.
 * @param assetDirectory - plugin `assetDirectory`; empty uses the installed plugin tree.
 * @param moduleUrl - `import.meta.url` of the host module.
 * @returns absolute asset paths. Missing files are reported by the supervisor, not here.
 * @throws {Error} when `assetDirectory` is relative.
 */
export function resolveNativeAssets(assetDirectory: string, moduleUrl: string): NativeAssets {
  const override = assetDirectory.trim()
  const root = override === '' ? fileURLToPath(new URL('../native/', moduleUrl)) : override
  if (!isAbsolute(root)) throw new Error('desktop-operation: assetDirectory must be absolute')
  return {
    binary: join(root, 'agent-desktop'),
    helper: join(root, 'agent-desktop-macos-helper'),
    license: join(root, 'LICENSE'),
    pin: join(root, 'PIN.json'),
    skill: join(root, 'skills', 'agent-desktop', 'SKILL.md'),
  }
}
