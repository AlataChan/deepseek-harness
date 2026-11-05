/** Browser entry binding the generated local worktree Remote to one Changes tab. */
import type { Context } from '@deepseek-ai/cordis'
import contribution from '@deepseek-ai/dsh-experimental-client-ui-forge/remote'
import { mountLocalReviewUi } from './mount.ts'
export { inject } from './mount.ts'
/**
 * Activate the local review Client plugin.
 * @param ctx - browser composition context.
 * @returns disposer for the Remote and all UI effects.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountLocalReviewUi(ctx, contribution)
}
