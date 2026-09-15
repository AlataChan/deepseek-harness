/**
 * Commerce preset installation and preset-scoped tool mount for a deployment with an agent preset roster.
 * @module @deepseek-ai/dsh-experimental-commerce-mode/preset
 */

import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import { installCommercePreset } from '../install.ts'
import * as CommerceTools from '../tools/index.ts'

/** Loader-facing plugin name. */
export const name = 'commerce-preset'
/** The scope creator must hold every service the scoped tool Consumer injects. */
export const inject = ['commerce', 'agentPresets', 'fs', 'tools', 'sessionProjections', 'approval', 'sandboxPolicy']

/** Tool bounds for the preset-scoped `./tools` Consumer. */
export type Config = CommerceTools.Config
/** Schemastery validation shared with a root `./tools` row. */
export const Config: z<Config> = CommerceTools.Config

/**
 * Install the packaged `commerce` preset when absent, then mount the commerce
 * tools in its standing scope so only agents joined to that preset see them.
 * An unavailable preset logs the manual recovery step and mounts no tools.
 * @param ctx - Host context holding the preset roster and tool registries.
 * @param config - tool input, output, and provenance bounds.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!await installCommercePreset(ctx)) return
  let key: ScopeKey
  try {
    key = await ctx.agentPresets.standingKeyFor('commerce')
  } catch (cause: unknown) {
    ctx.logger.error(
      `commerce-mode: cannot mount commerce tools because the commerce preset is unavailable: ${cause instanceof Error ? cause.message : String(cause)}; `
      + 'copy the packaged commerce preset to .agent-presets/commerce and restart the Host',
    )
    return
  }
  const scope = createScope(ctx, key)
  ctx.effect(() => scope.rawDispose, 'commerce-preset.tools-scope')
  await scope.ctx.plugin(CommerceTools, config).await()
}
