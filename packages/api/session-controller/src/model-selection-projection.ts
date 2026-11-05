/** Session Controller participation in the core model-selection projection. */

import type { Context } from '@deepseek-ai/cordis'
import { modelSelectionProjectionDefinition } from '@deepseek-ai/dsh-agent'

/**
 * Register the core `modelSelection` unit at stateVersion 4.
 * A second registration shares that version; the retired v2 fold is not installed.
 * @param ctx - Session Controller context.
 * @returns completion of the registration handoff.
 */
export async function installModelSelectionProjection(ctx: Context): Promise<void> {
  await ctx.effect(async () => {
    const handle = await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
    return () => handle.dispose()
  }, 'session-controller model selection projection')
}
