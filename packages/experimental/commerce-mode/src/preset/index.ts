/**
 * Commerce preset installation and preset-scoped tool mount for a deployment with an agent preset roster.
 * @module @deepseek-ai/dsh-experimental-commerce-mode/preset
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { load } from 'js-yaml'
import type z from '@deepseek-ai/schemastery'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
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

/** Directory the packaged commerce preset is installed to; its name is the preset id. */
const PRESET_ID = 'commerce'

/**
 * Read the installed commerce preset's declaration: `agent.cordis.yml` plugin
 * rows plus the optional `preset.yml` display metadata. The registry holds
 * only programmatic registrations, so this package declares its own preset
 * from the files it installs — a pre-seeded or hand-edited directory supplies
 * the definition exactly as the file-scanned roster once did.
 * @param ctx - Host context whose logger receives an unreadable-metadata note.
 * @param target - installed preset directory.
 * @returns the definition to register with the preset registry.
 */
async function readPresetDefinition(ctx: Context, target: string): Promise<PresetDefinition> {
  const composition = await readFile(join(target, 'agent.cordis.yml'), 'utf8')
  // The registry re-validates the parsed rows (entryListProblem) before mounting.
  const plugins = load(composition, { schema: entryListSchema }) as PresetDefinition['plugins']
  let metadata: { name?: string; description?: string; order?: number } = {}
  try {
    const raw = load(await readFile(join(target, 'preset.yml'), 'utf8'))
    if (typeof raw === 'object' && raw !== null) {
      const { name, description, order } = raw as Record<string, unknown>
      metadata = {
        ...(typeof name === 'string' && name.trim() !== '' ? { name: name.trim() } : {}),
        ...(typeof description === 'string' && description.trim() !== '' ? { description: description.trim() } : {}),
        ...(typeof order === 'number' ? { order } : {}),
      }
    }
  } catch {
    ctx.logger.info('commerce-mode: unreadable preset.yml; the preset registers without display metadata')
  }
  return { id: PRESET_ID, ...metadata, listed: false, plugins }
}

/**
 * Install the packaged `commerce` preset when absent, declare it to the preset
 * registry, then mount the commerce tools in its standing scope so only agents
 * joined to that preset see them. An unusable preset composition logs the
 * manual recovery step and mounts no tools.
 * @param ctx - Host context holding the preset roster and tool registries.
 * @param config - tool input, output, and read-record bounds.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!await installCommercePreset(ctx)) return
  const unregister = await ctx.agentPresets.register(await readPresetDefinition(ctx, dshHomePath('.agent-presets', PRESET_ID)))
  ctx.effect(() => unregister, 'commerce-preset.definition')
  let lease: { key: ScopeKey } & AsyncDisposable
  try {
    lease = await ctx.agentPresets.acquireScope(PRESET_ID)
  } catch (cause: unknown) {
    ctx.logger.error(
      `commerce-mode: cannot mount commerce tools because the commerce preset is unavailable: ${cause instanceof Error ? cause.message : String(cause)}; `
      + `repair the preset directory at ${dshHomePath('.agent-presets', PRESET_ID)} and restart the Host`,
    )
    return
  }
  const scope = createScope(ctx, lease.key)
  ctx.effect(() => async () => {
    await scope.rawDispose()
    await lease[Symbol.asyncDispose]()
  }, 'commerce-preset.tools-scope')
  await scope.ctx.plugin(CommerceTools, config).await()
}
