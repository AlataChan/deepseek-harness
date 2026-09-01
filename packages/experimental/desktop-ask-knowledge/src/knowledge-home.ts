/**
 * Resolve the knowledge-bases root. Config wins, then OCTOPUS_APP_DATA.
 * Missing both fails the ask-knowledge method, not companion boot.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/knowledge-home
 */

import { isAbsolute, resolve } from 'node:path'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'

/** Validated plugin configuration. */
export interface AskKnowledgeHomeConfig {
  /** Absolute Tauri app-data directory. Empty falls through to `OCTOPUS_APP_DATA`. */
  readonly knowledgeHome?: string
  /** Absolute sidecar runtime root. Empty falls through to `OCTOPUS_SIDECAR_HOME`. */
  readonly sidecarRuntimePath?: string
}

/**
 * Absolute knowledge-bases parent (`…/knowledge-bases` lives under this).
 * @param config - plugin config.
 * @param env - process environment, injectable for tests.
 * @returns canonical absolute app-data directory.
 */
export function resolveKnowledgeHome(
  config: AskKnowledgeHomeConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = config.knowledgeHome?.trim() ?? ''
  if (configured !== '') {
    if (!isAbsolute(configured)) {
      throw new AskKnowledgeError('knowledge-home-missing', 'knowledgeHome must be an absolute path')
    }
    return resolve(configured)
  }
  const fromEnv = env.OCTOPUS_APP_DATA?.trim() ?? ''
  if (fromEnv === '' || !isAbsolute(fromEnv)) {
    throw new AskKnowledgeError(
      'knowledge-home-missing',
      'OCTOPUS_APP_DATA is missing; ask-knowledge cannot open the catalog',
    )
  }
  return resolve(fromEnv)
}

/**
 * Absolute sidecar runtime root.
 * @param config - plugin config.
 * @param env - process environment, injectable for tests.
 * @returns canonical absolute sidecar home.
 */
export function resolveSidecarHome(
  config: AskKnowledgeHomeConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = config.sidecarRuntimePath?.trim() ?? ''
  if (configured !== '') {
    if (!isAbsolute(configured)) {
      throw new AskKnowledgeError('sidecar-home-missing', 'sidecarRuntimePath must be an absolute path')
    }
    return resolve(configured)
  }
  const fromEnv = env.OCTOPUS_SIDECAR_HOME?.trim() ?? ''
  if (fromEnv === '' || !isAbsolute(fromEnv)) {
    throw new AskKnowledgeError(
      'sidecar-home-missing',
      'OCTOPUS_SIDECAR_HOME is missing; ask-knowledge cannot start the sidecar',
    )
  }
  return resolve(fromEnv)
}
