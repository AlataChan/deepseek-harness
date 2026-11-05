/** Keyless model dispatch records directory tool results and reconstructable context. */
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createDirectoryFixtureAgent } from '@deepseek-ai/dsh-working-directory-testkit'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as DirectoryTool from '../src/index.ts'

describe('working_directory tool', () => {
  it('changes cwd through actual model dispatch and replays each model request from the log', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'directory-tool-')))
    const child = join(root, 'child')
    await mkdir(child)
    const ctx = new Context()
    try {
      const agent = await createDirectoryFixtureAgent(ctx, SessionId('directory-tool'), root, { provider: 'mock', model: 'mock' })
      const adapter = new MockAdapter([toolCallResponse('directory-switch', 'working_directory', { cd: 'child' }), textResponse('changed')])
      ctx.llm.registerAdapter(['mock'], adapter)
      await ctx.plugin(DirectoryTool)
      ctx.on('llm/stream', (request, next) => {
        const cold = Session.create(agent.id, agent.session.snapshotEvents(), agent.session.header)
        expect(request.messages).toEqual(cold.deriveMessages())
        return next()
      })
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Enter child.' }] }))
      await agent.whenIdle()
      expect(adapter.requests).toHaveLength(2)
      expect(adapter.requests[0]?.tools?.map(tool => tool.name)).toContain('working_directory')
      expect(JSON.stringify(adapter.requests[1]?.messages)).toContain(child)
      expect(ctx.workingDirectory.get(agent.session)).toBe(child)
      expect(agent.session.header.cwd).toBe(root)
      expect(agent.session.snapshotEvents().findLast(event => event.type === 'tool/result')?.data.message.isError).toBe(false)
      const read = await ctx.tools.execute({ name: 'working_directory', arguments: {}, agent, callId: ToolCallId('directory-read'), signal: new AbortController().signal })
      expect(read.isError).toBe(false)
      if (read.isError) throw new Error('directory read failed')
      expect(read.value).toEqual({ cwd: child })
      const absent = await ctx.tools.execute({ name: 'working_directory', arguments: {}, callId: ToolCallId('directory-no-owner'), signal: new AbortController().signal })
      expect(absent.isError).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
