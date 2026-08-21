/** In-process terminal presentation plugin. @module @deepseek-ai/dsh-tui */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name. */
export const name = 'tui'

/** Services required before the terminal controller can start. */
export const inject = [
  'agentDefaultModel',
  'agents',
  'approval',
  'commands',
  'sessionQuery',
  'sessions',
  'userQuestions',
]

/** Validated terminal presentation limits. */
export interface Config {
  /** Width used when stdout exposes no positive integer column count. */
  terminalColumnsFallback?: number
  /** Maximum finalized transcript rows restored into terminal scrollback. */
  resumeTranscriptRows?: number
  /** Maximum sessions offered by the resume selector. */
  sessionSelectorLimit?: number
  /** Maximum bytes retained for one rendered tool output. */
  toolOutputDisplayBudget?: number
}

/** Terminal presentation configuration. */
export const Config: z<Config> = z.object({
  terminalColumnsFallback: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(80),
  resumeTranscriptRows: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(200),
  sessionSelectorLimit: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(50),
  toolOutputDisplayBudget: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(32_768),
})

/**
 * Mount the terminal presentation package.
 * @param _ctx - Cordis context that will own the terminal client lifecycle.
 */
export function apply(_ctx: Context, _config: Config): void {}
