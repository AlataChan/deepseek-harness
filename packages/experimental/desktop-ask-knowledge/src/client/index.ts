/** Browser entry binding generated document Remotes to the source-safe UI. */
import askKnowledgeRemote from '@deepseek-ai/dsh-experimental-desktop-ask-knowledge/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { mountAskKnowledgeUi } from './mount.ts'

export * from './mount.ts'

/**
 * Register document Remotes before mounting library, ingestion and document UI.
 * @param ctx - browser service context.
 * @returns disposer for both UI registrations and the mounted Remote contribution.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return await mountAskKnowledgeUi(ctx, askKnowledgeRemote)
}
