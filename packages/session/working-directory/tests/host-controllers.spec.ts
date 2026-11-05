/** Source Loader composition and JSONL cold replay of a keyless model-driven directory change. */
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Projections from '@deepseek-ai/dsh-session-projection'
import LocalFiles from '@deepseek-ai/dsh-fs-local'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as DirectoryTool from '@deepseek-ai/dsh-tool-working-directory'
import { expect, it } from 'vitest'
import WorkingDirectory from '../src/index.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { directoryScript } from './fixtures/recorded.ts'

it('loads the source graph, records model-visible facts, and reopens a required directory event from JSONL', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'directory-loader-')))
  await mkdir(join(root, 'selected'))
  const ctx = new Context()
  const cold = new Context()
  try {
    await ctx.plugin(Loader)
    Object.assign(ctx.loader.builtins, {
      include: Include, prompt: SystemPrompt, llm: LlmRuntime, sessions: SessionStore,
      tools: ToolRuntime, agents: AgentRegistry, projections: Projections, files: LocalFiles,
      directory: WorkingDirectory, directoryTool: DirectoryTool, loop: AgentLoop,
    })
    await ctx.loader.create({ name: 'cordis:include', config: {
      path: pathToFileURL(join(process.cwd(), 'packages/session/working-directory/tests/fixtures/cordis.yml')).href,
    } })
    await ctx.loader.await()
    const adapter = new MockAdapter(directoryScript())
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('source-directory'), { provider: 'mock', model: 'mock' }, { cwd: root })
    ctx.on('llm/stream', (request, next) => {
      expect(request.messages).toEqual(Session.create(agent.id, agent.session.snapshotEvents(), agent.session.header).deriveMessages())
      return next()
    })
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Select the execution directory.' }] }))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    expect(ctx.workingDirectory.get(agent.session)).toBe(join(root, 'selected'))
    await ctx.plugin(JsonlPersistence, { root: join(root, 'logs'), compression: 'none' })
    const stored = await ctx.sessionPersistence.create(agent.session.header)
    await stored.append(agent.session.snapshotEvents())
    await stored.close()
    await cold.plugin(JsonlPersistence, { root: join(root, 'logs'), compression: 'none' })
    const reader = await cold.sessionPersistence.open(agent.id, 'read')
    const log = await reader.read()
    await reader.close()
    const replay = Session.create(agent.id, log.events, reader.header)
    expect(replay.deriveMessages()).toEqual(agent.session.deriveMessages())
    expect(ctx.workingDirectory.get(replay)).toBe(join(root, 'selected'))
    expect(replay.header.cwd).toBe(root)
  } finally {
    await cold.fiber.dispose()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
