/** Browser entry binding the generated session-decisions Remote artifact to its Client UI. */

import decisionsRemote from '@deepseek-ai/dsh-experimental-session-decisions/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { mountQuestionsUi } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Mount the generated session-decisions Remote contribution and its browser UI.
 * @param ctx - browser client context.
 * @returns cleanup disposer.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return await mountQuestionsUi(ctx, decisionsRemote)
}
