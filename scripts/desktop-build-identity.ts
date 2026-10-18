/** Shared build identity for the packaged Host, Client graph, and release manifest. */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Runtime release identity, independent of the Tauri shell version. */
export interface DesktopBuildIdentity {
  /** Harness runtime version read from the CLI package. */
  readonly version: string
  /** Full lowercase source commit fixed at build time. */
  readonly commit: string
}

/** Source modification flags retained for internal artifact auditing. */
export interface DesktopSourceState {
  /** Whether Git reported modifications when the complete root build started. */
  readonly modifiedAtBuild: boolean
  /** Whether Git reported modifications when packaging read the build record. */
  readonly modifiedAtPackaging: boolean
}

/**
 * Validate a persisted or wire build identity.
 * @param value - decoded JSON value.
 * @returns runtime release fields without unrelated metadata.
 */
export function validateDesktopBuildIdentity(value: unknown): DesktopBuildIdentity {
  if (typeof value !== 'object' || value === null || !('version' in value) || !('commit' in value)
    || typeof value.version !== 'string' || value.version.trim() === ''
    || typeof value.commit !== 'string' || !/^[a-f0-9]{40}$/.test(value.commit)) {
    throw new Error('desktop build identity requires a runtime version and full source commit')
  }
  return { version: value.version, commit: value.commit }
}

/**
 * Resolve the source identity once before producing desktop resources.
 * @param root - source checkout root.
 * @returns the runtime version and exact Git commit; missing inputs fail the build.
 */
export function desktopBuildIdentity(root: string): DesktopBuildIdentity {
  const manifest: unknown = JSON.parse(readFileSync(join(root, 'apps/cli/package.json'), 'utf8'))
  const version = typeof manifest === 'object' && manifest !== null && 'version' in manifest ? manifest.version : undefined
  const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  return validateDesktopBuildIdentity({ version, commit })
}
