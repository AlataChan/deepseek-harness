/**
 * Model-facing remediation for guarded-mutation failures. The provider's
 * `FS_STALE_VERSION` and `FS_NOT_OBSERVED` messages state the condition but
 * not the only correct recovery (re-read / read the file), so this package
 * appends the remedy at the model boundary; provider messages stay
 * machine-oriented and unchanged.
 * @module @deepseek-ai/dsh-tool-fs/src/error
 */

import { FsError } from '@deepseek-ai/dsh-fs'
import type { Context } from '@deepseek-ai/cordis'
import type { FsErrorCode, FsErrorRemedyRequest, FsMutationOperation, FsTarget } from '@deepseek-ai/dsh-fs'

/** The remedy appended to each remediable failure code's message. */
const REMEDIES: Partial<Record<FsErrorCode, string>> = {
  FS_STALE_VERSION: 're-read the file, then retry',
  FS_NOT_OBSERVED: 'read the file, then retry',
}

/**
 * Append the correct recovery instruction to a guarded-mutation failure's
 * message. `FS_STALE_VERSION` (the file changed since this session's last
 * observation, including a missing target) recovers only by re-reading;
 * `FS_NOT_OBSERVED` (no prior read by this session) by reading. The `FsError`
 * code is preserved so retry/permission/UI layers keep routing on it, and the
 * original error chains as `cause`. Anything else passes through untouched.
 * @param error - the caught value from a write/edit execution.
 * @returns a remediated `FsError` for the two guarded-mutation codes, else the original value.
 */
export function remediateFsError(error: unknown): unknown {
  if (!(error instanceof FsError)) return error
  const remedy = REMEDIES[error.code]
  if (!remedy) return error
  return new FsError(`${error.message} — ${remedy}`, error.code, { cause: error })
}

/**
 * Consult filesystem error-remedy listeners before appending the default
 * guarded-mutation recovery instruction.
 * @param ctx - tool execution context for the waterfall dispatch.
 * @param error - the caught value from a write/edit execution after sandbox mapping.
 * @param target - the resolved target that was being mutated.
 * @param operation - which mutation operation failed.
 * @param actor - the opaque tool-execution context.
 * @returns a remediated `FsError`, or the original value for non-remediable inputs.
 */
export async function remediateFsToolError(
  ctx: Context,
  error: unknown,
  target: FsTarget,
  operation: FsMutationOperation,
  actor: object | undefined,
): Promise<unknown> {
  if (!(error instanceof FsError)) return error
  const request: FsErrorRemedyRequest = { error, target, operation, actor }
  const remedy = await ctx.waterfall('fs/error-remedy', request, () => REMEDIES[error.code])
  if (remedy === undefined) return error
  return new FsError(`${error.message} — ${remedy}`, error.code, { cause: error })
}
