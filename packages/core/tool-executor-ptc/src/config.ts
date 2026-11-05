/**
 * PTC executor configuration.
 * @module
 */

import z from '@deepseek-ai/schemastery'

/** Limits for program subcalls. Root-call parallelism stays on the agent loop. */
export interface Config {
  /** Maximum overlapping program subcalls. */
  maxParallelSubCalls: number
}

/** Runtime schema. Omitted fields use the defaults. */
export const Config: z<Config> = z.object({
  maxParallelSubCalls: z.natural().min(1).default(10),
})

/**
 * Resolve an omitted subcall limit, then validate the complete config.
 * @param input - plugin or constructor fields. An omitted limit uses 10.
 * @returns the validated config.
 */
export function resolveConfig(input: { maxParallelSubCalls?: number } = {}): Config {
  return Config({ maxParallelSubCalls: input.maxParallelSubCalls ?? 10 })
}
