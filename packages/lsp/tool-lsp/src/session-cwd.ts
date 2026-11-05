/** Execution-directory resolution for a language-server call. */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'

/**
 * Resolve the current language-server workspace.
 * @param ctx - injected directory service owner.
 * @param exec - calling Agent and cancellation.
 * @returns current directory, or undefined for a call without an Agent.
 */
export async function sessionCwd(ctx: Context, exec: ToolExecution): Promise<string | undefined> {
  return exec.agent === undefined ? undefined : await ctx.workingDirectory.ensure(exec.agent, exec.signal)
}
