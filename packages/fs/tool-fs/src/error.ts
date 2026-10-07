/**
 * Model-facing diagnostics for guarded-mutation failures. Providers and
 * policies retain operation-specific causes, while this package owns the
 * stable message shown to the model.
 * @module @deepseek-ai/dsh-tool-fs/src/error
 */

import { FsError } from '@deepseek-ai/dsh-fs'
import type { Context } from '@deepseek-ai/cordis'
import type { FsErrorRemedyRequest, FsMutationOperation, FsTarget } from '@deepseek-ai/dsh-fs'

/**
 * Render the stable model-facing diagnostic for a guarded-mutation failure.
 * `FS_STALE_VERSION` keeps the provider's reason and appends its re-read
 * remedy. `FS_NOT_OBSERVED` replaces operation-specific policy/provider text
 * with one path-aware reason and read remedy. The original error remains the
 * cause, and both diagnostics preserve its code for machine routing. Anything
 * else passes through untouched.
 * @param error - the caught value from a write/edit execution.
 * @param displayPath - the resolved target path shown to the model.
 * @returns a remediated `FsError` for the two guarded-mutation codes, else the original value.
 */
export function remediateFsError(error: unknown, displayPath: string): unknown {
  if (!(error instanceof FsError)) return error
  if (error.code === 'FS_NOT_OBSERVED') {
    return new FsError(
      `cannot modify "${displayPath}": file has not been read — read the file, then retry`,
      error.code,
      { cause: error },
    )
  }
  if (error.code === 'FS_STALE_VERSION') {
    return new FsError(`${error.message} — re-read the file, then retry`, error.code, { cause: error })
  }
  return error
}

/**
 * Consult filesystem error-remedy listeners before applying the default
 * guarded-mutation diagnostic.
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
  const remedy = await ctx.waterfall('fs/error-remedy', request, () => undefined)
  if (remedy === undefined) return remediateFsError(error, target.displayPath)
  return new FsError(`${error.message} — ${remedy}`, error.code, { cause: error })
}
