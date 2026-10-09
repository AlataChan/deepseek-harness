/**
 * Install the public-service preset and register it on the agent-preset roster.
 * @module @deepseek-ai/dsh-experimental-desktop-ngo
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { load } from 'js-yaml'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { installNgoPreset, NGO_PRESET_ID } from './install.ts'

/** Loader-facing plugin name. */
export const name = 'desktop-ngo'

/** Roster registration needs the preset registry. */
export const inject = ['agentPresets']

/**
 * Install or repair the packaged preset, then register it.
 * A composition that still will not mount is logged and skipped.
 * @param ctx - Host context holding the preset roster.
 */
export async function apply(ctx: Context): Promise<void> {
  const target = dshHomePath('.agent-presets', NGO_PRESET_ID)
  if (!await installNgoPreset(ctx, target)) return
  let plugins: PresetDefinition['plugins']
  try {
    plugins = load(await readFile(join(target, 'agent.cordis.yml'), 'utf8'), { schema: entryListSchema }) as PresetDefinition['plugins']
  } catch (cause: unknown) {
    ctx.logger.error(`desktop-ngo: cannot read preset composition: ${cause instanceof Error ? cause.message : String(cause)}`)
    return
  }
  const unregister = await ctx.agentPresets.register({
    id: NGO_PRESET_ID,
    name: '公益项目助手',
    description: '写项目书、台账周报、案例和传播初稿',
    order: 20,
    listed: false,
    plugins,
  })
  ctx.effect(() => unregister, 'desktop-ngo.definition')
}
