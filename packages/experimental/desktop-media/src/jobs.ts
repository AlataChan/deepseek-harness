/**
 * Background media job hooks.
 * @module @deepseek-ai/dsh-experimental-desktop-media/jobs
 */

import type { JobHooks, JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MediaError } from './error.ts'

/** Start one owned media job. */
export interface MediaJobStart {
  readonly jobs: JobRegistry
  readonly owner: SessionId
  readonly label: string
  readonly work: (signal: AbortSignal) => Promise<string>
  /** Durable stop intent after an explicit kill. */
  readonly onStop?: () => Promise<void>
}

/**
 * Register a `media` job whose work uses a job-owned abort signal.
 * @param start - registry, owner, and work.
 * @returns process-local job id.
 */
export function startMediaJob(start: MediaJobStart): JobId {
  return start.jobs.start({
    kind: 'media',
    label: start.label,
    owner: start.owner,
    outputLimitBytes: 16_384,
    run: () => mediaJobHooks(start.work, start.onStop),
  })
}

/**
 * Build hooks for one media job.
 * @param work - job body.
 * @param onStop - durable stop intent after an explicit kill.
 * @returns cancel and done hooks.
 */
export function mediaJobHooks(
  work: (signal: AbortSignal) => Promise<string>,
  onStop?: () => Promise<void>,
): JobHooks {
  const controller = new AbortController()
  return {
    cancel(reason?: string) {
      controller.abort(reason ?? 'killed')
    },
    done: work(controller.signal).then(
      output => ({ status: 'completed' as const, output }),
      async (error: unknown) => {
        if (controller.signal.aborted) {
          if (onStop !== undefined) {
            try {
              await onStop()
            } catch {
              // Stop-event persistence failed; recovery may restart this request.
              return {
                status: 'killed' as const,
                detail: `${String(controller.signal.reason)}; stop intent uncertain`,
              }
            }
          }
          return { status: 'killed' as const, detail: String(controller.signal.reason) }
        }
        const detail = error instanceof MediaError
          ? error.message
          : error instanceof Error ? error.message : String(error)
        return { status: 'failed' as const, detail }
      },
    ),
  }
}

/**
 * Whether a jobs.start() failure means recovery must wait.
 * @param error - thrown by start().
 * @returns true when no controller serves the owner.
 */
export function isMissingJobController(error: unknown): boolean {
  return error instanceof Error && error.message.includes('no job controller')
}
