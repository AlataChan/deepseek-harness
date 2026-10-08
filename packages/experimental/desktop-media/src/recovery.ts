/**
 * Re-register known provider tasks for a live session owner.
 * @module @deepseek-ai/dsh-experimental-desktop-media/recovery
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import { isMissingJobController, startMediaJob } from './jobs.ts'
import type { MediaProjectionState, MediaRequestRecord } from './types.ts'

/** Recoverable request: known provider task, no stop intent, no artifact. */
export type RecoverableRequest = MediaRequestRecord & { readonly providerTaskId: string }

/**
 * Select known provider tasks that are not stopped or complete.
 * @param state - folded media projection.
 * @returns requests that still have a provider task and no artifact.
 */
export function recoverableRequests(
  state: MediaProjectionState,
): readonly RecoverableRequest[] {
  return Object.values(state.requests).filter((request): request is RecoverableRequest => (
    request.providerTaskId !== undefined
    && request.stopIntent !== true
    && request.artifactId === undefined
    && request.stage !== 'stopped'
    && request.stage !== 'failed'
  ))
}

/** Work used to resume one known provider task. */
export type RecoverWork = (
  request: MediaRequestRecord,
  signal: AbortSignal,
) => Promise<string>

/**
 * Start owned media jobs for recoverable requests.
 * @param jobs - process-local registry.
 * @param owner - live agent for this session.
 * @param state - folded media projection.
 * @param work - resume body for one request.
 * @param onStop - durable stop after an explicit kill of a recovered job.
 * @returns started job ids, or empty when the controller is missing.
 */
export function recoverMediaJobs(
  jobs: JobRegistry,
  owner: Agent,
  state: MediaProjectionState,
  work: RecoverWork,
  onStop?: (request: MediaRequestRecord) => Promise<void>,
): readonly JobId[] {
  const ids: JobId[] = []
  const seenTasks = new Set<string>()
  for (const request of recoverableRequests(state)) {
    if (seenTasks.has(request.providerTaskId)) continue
    seenTasks.add(request.providerTaskId)
    try {
      ids.push(startMediaJob({
        jobs,
        owner,
        label: request.label,
        work: signal => work(request, signal),
        ...onStop === undefined ? {} : { onStop: () => onStop(request) },
      }))
    } catch (error: unknown) {
      if (isMissingJobController(error)) return []
      throw error
    }
  }
  return ids
}
