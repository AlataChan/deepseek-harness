import AgentRegistry, { type Agent, type AgentOptions } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
/** Explicit real working-directory setup for execution-consumer fixtures. */
import type { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
/**
 * Mount real directory services without replacing an owner's filesystem provider.
 * Callers own Context disposal and any temporary directory supplied here.
 * @param ctx - fixture context; generic AgentLoop fixtures remain unaffected.
 * @param defaultDirectory - explicit existing absolute fixture directory.
 * @returns after the real directory owner and prerequisites activate.
 */
export async function mountDirectoryFixture(ctx: Context, defaultDirectory: string): Promise<void> {
  if (ctx.get('systemPrompt') === undefined) await ctx.plugin(SystemPrompt)
  if (ctx.get('sessionProjections') === undefined) await ctx.plugin(SessionProjectionRegistry)
  if (ctx.get('fs') === undefined) await ctx.plugin(LocalFileSystem, { cwd: defaultDirectory })
  if (ctx.get('workingDirectory') === undefined) await ctx.plugin(WorkingDirectory, { defaultDirectory })
}

/**
 * Create an idle production Agent for a tool fixture without invoking a model.
 * @param ctx - explicitly opted-in fixture context.
 * @param id - unique fixture Session identity.
 * @param cwd - existing original project directory.
 * @param options - fixture-owned model selection and loop options; no model is executed.
 * @returns the initialized real Agent and its durable Session.
 */
export async function createDirectoryFixtureAgent(ctx: Context, id: SessionId, cwd: string, options: AgentOptions = {}): Promise<Agent> {
  await mountDirectoryFixture(ctx, cwd)
  if (ctx.get('llm') === undefined) await ctx.plugin(LlmRuntime)
  if (ctx.get('sessions') === undefined) await ctx.plugin(SessionStore)
  if (ctx.get('tools') === undefined) await ctx.plugin(ToolRuntime)
  if (ctx.get('agents') === undefined) await ctx.plugin(AgentRegistry)
  if (ctx.get('agentLoop') === undefined) await ctx.plugin(AgentLoop, { agents: [] })
  return await ctx.agentLoop.create(id, options, { cwd })
}
