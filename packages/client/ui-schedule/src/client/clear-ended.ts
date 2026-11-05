/** Clear ended tasks and request catalog data newer than the mutation. */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { ScheduleDeleteInactiveResult } from '@deepseek-ai/dsh-schedule/client'

/**
 * Settle the deletion before superseding any older catalog read.
 * @param remove - Human clear-ended Remote operation.
 * @param refresh - Request an authoritative read after the operation settled.
 * @returns Whether deletion was acknowledged; refresh failure remains catalog-owned.
 */
export async function clearEnded(
  remove: () => Promise<RemoteResult<ScheduleDeleteInactiveResult>>, refresh: () => Promise<void>,
): Promise<boolean> {
  try {
    const result = await remove()
    await refresh()
    return result.ok
  } catch (_error) {
    // Partial removal may have landed; its catalog still needs readback.
    await refresh()
    return false
  }
}
