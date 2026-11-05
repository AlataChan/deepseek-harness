/** Effective execution directories for filesystem calls; confinement keeps its original root. */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'

/**
 * Resolve the execution directory, recovering a missing checkout before use.
 * @param ctx - injected directory service owner.
 * @param exec - calling Agent and cancellation.
 * @returns effective directory, or undefined for a non-agent caller.
 */
export async function sessionCwd(ctx: Context, exec: ToolExecution): Promise<string | undefined> {
  return exec.agent === undefined ? undefined : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
}

/**
 * Resolve paths in the effective directory and retain the caller's signal.
 * @param ctx - injected directory service owner.
 * @param exec - calling Agent and cancellation.
 * @returns provider resolution options; sandbox workspaceRoot is never used as cwd.
 */
export async function sessionResolveOptions(ctx: Context, exec: ToolExecution): Promise<{ cwd?: string; signal: AbortSignal }> {
  const cwd = await sessionCwd(ctx, exec)
  return { ...cwd === undefined ? {} : { cwd }, signal: exec.signal }
}
