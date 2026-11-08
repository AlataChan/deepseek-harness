/** Immutable identity of the complete runtime recipe, separate from upstream source version. */
import { createHash } from 'node:crypto'
import lock from '../dependency-lock.json' with { type: 'json' }

/** SHA-256 of the checked-in acquisition and build recipe. */
export const RUNTIME_MANIFEST_DIGEST = createHash('sha256').update(JSON.stringify(lock)).digest('hex')
/** Directory identifier changes whenever any qualified artifact or recipe changes. */
export const RUNTIME_LOCK_ID = RUNTIME_MANIFEST_DIGEST.slice(0, 12)

/**
 * Whether real transient-descendant and installation checks qualify this host.
 * @returns True only for the currently verified target.
 */
export function runtimePlatformQualified(): boolean {
  return process.platform === 'darwin' && process.arch === 'arm64'
}
