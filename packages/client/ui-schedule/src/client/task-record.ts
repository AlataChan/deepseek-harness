/** Destination interpretation shared by task lists and editors. */
import type { ScheduleCatalogEntry, ScheduleTarget, ScheduleTargetRequest } from '@deepseek-ai/dsh-schedule/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Existing or reserved destination, absent for a fresh Session on every run.
 * @param task - Retained task.
 * @returns Destination identity when the task has one.
 */
export function targetSessionId(task: ScheduleCatalogEntry): SessionId | undefined {
  return task.target.kind === 'new' ? undefined : task.target.sessionId
}

/** Editable target without a Host-reserved identity.
 * @param target - Stored destination.
 * @returns Creation request accepted by create and edit.
 */
export function targetRequest(target: ScheduleTarget): ScheduleTargetRequest {
  return target.kind === 'session' ? target : { kind: target.kind, create: { ...target.create } }
}
