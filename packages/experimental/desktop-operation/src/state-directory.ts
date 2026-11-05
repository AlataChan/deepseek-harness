/**
 * App-data paths for the shared desktop state directory and lock file.
 * This module does not read or write `HOME`.
 * @module @deepseek-ai/dsh-experimental-desktop-operation/state-directory
 */

import { isAbsolute, join } from 'node:path'

/**
 * Resolve the absolute app-data directory.
 * An empty config uses `OCTOPUS_APP_DATA` when that value is absolute.
 * A missing environment value stays unset so the host can publish unavailable.
 * A relative config value or a relative environment value is misconfiguration.
 * @param configured - plugin `appDataDirectory`.
 * @param env - environment to read `OCTOPUS_APP_DATA` from.
 * @returns the absolute directory, or undefined when both values are empty.
 * @throws {Error} when a provided path is not absolute.
 */
export function resolveAppDataDirectory(configured: string, env: NodeJS.ProcessEnv): string | undefined {
  const configuredValue = configured.trim()
  if (configuredValue !== '') {
    if (!isAbsolute(configuredValue)) throw new Error('desktop-operation: appDataDirectory must be absolute')
    return configuredValue
  }
  const fromEnv = env.OCTOPUS_APP_DATA?.trim() ?? ''
  if (fromEnv === '') return undefined
  if (!isAbsolute(fromEnv)) throw new Error('desktop-operation: OCTOPUS_APP_DATA must be absolute')
  return fromEnv
}

/**
 * State directory passed to the native binary as `AGENT_DESKTOP_HOME`.
 * @param appDataDirectory - absolute app-data directory.
 * @returns `<appDataDirectory>/agent-desktop`.
 */
export function stateDirectory(appDataDirectory: string): string {
  return join(appDataDirectory, 'agent-desktop')
}

/**
 * Stable lock path for the shared desktop lease.
 * @param appDataDirectory - absolute app-data directory.
 * @returns `<appDataDirectory>/agent-desktop.lock`.
 */
export function lockFilePath(appDataDirectory: string): string {
  return join(appDataDirectory, 'agent-desktop.lock')
}
