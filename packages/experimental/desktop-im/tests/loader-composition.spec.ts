import { expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as Include from '@deepseek-ai/cordis-plugin-include'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import Storage from '@deepseek-ai/dsh-storage'
import { LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import DesktopIm from '../src/index.ts'

it('boots the settings service through Loader and saves via the real Remote gateway without connecting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-im-loader-'))
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(Storage)
    await ctx.plugin(CredentialsLocal, { path: join(root, 'credentials.yaml') })
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(TypertGatewayService, {})
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(specifier: string): Promise<unknown> {
      if (specifier !== '@deepseek-ai/dsh-experimental-desktop-im') throw new Error('Unexpected Loader module')
      return { default: DesktopIm }
    } } as never
    const configFile = join(root, 'cordis.yml')
    await writeFile(configFile, JSON.stringify([{ id: 'desktop-im', name: '@deepseek-ai/dsh-experimental-desktop-im', config: { settingsDirectory: join(root, 'settings') } }]))
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configFile).href } })
    await ctx.loader.await()
    for (const row of ctx.loader.entries()) await row.fiber?.await()
    const rows = await ctx.typertGateway.invoke({ namespace: 'desktopIm', method: 'list', args: {} })
    expect(rows).toEqual([
      { channel: 'feishu', config: null, enabled: false, phase: 'off', error: null, secretConfigured: false },
      { channel: 'dingtalk', config: null, enabled: false, phase: 'off', error: null, secretConfigured: false },
    ])
    const saved = await ctx.typertGateway.invoke({ namespace: 'desktopIm', method: 'save', args: {
      channel: 'feishu', config: { appId: 'app', tenantId: 'org', chatId: 'chat', senderId: 'operator', cwd: root, provider: 'nonexistent', model: 'model' }, secret: 'synthetic-secret',
    } }).catch((error: unknown) => error)
    expect(saved).toBeInstanceOf(Error)
    expect(String(saved)).toContain('provider')
    // Invalid model routes must never create a saved enable choice or a platform socket.
    await expect(readFile(join(root, 'settings', 'feishu.json'))).rejects.toThrow()
    await ctx.typertGateway.invoke({ namespace: 'desktopIm', method: 'setEnabled', args: { channel: 'unsupported', enabled: true } }).then(() => { throw new Error('Unsupported platform was accepted') }, (error: unknown) => { expect(error).toBeInstanceOf(Error) })
    class FixtureAdapter extends LlmAdapter {
      async *stream(): AsyncIterable<StreamChunk> { throw new Error('Saving must not invoke the model') }
    }
    ctx.llm.registerAdapter(['fixture'], new FixtureAdapter())
    const valid = await ctx.typertGateway.invoke({ namespace: 'desktopIm', method: 'save', args: {
      channel: 'feishu', config: { appId: 'app', tenantId: 'org', chatId: 'chat', senderId: 'operator', cwd: root, provider: 'fixture', model: 'model' }, secret: 'synthetic-secret',
    } })
    expect(valid).toMatchObject({ enabled: false, secretConfigured: true, phase: 'off' })
    expect(JSON.stringify(valid)).not.toContain('synthetic-secret')
    expect(await readFile(join(root, 'credentials.yaml'), 'utf8')).toContain('synthetic-secret')
    expect(await readFile(join(root, 'settings', 'feishu.json'), 'utf8')).not.toContain('synthetic-secret')
    const desktopEntry = [...ctx.loader.entries()].find(row => row.options.name === '@deepseek-ai/dsh-experimental-desktop-im')
    expect(Boolean(desktopEntry?.fiber)).toBe(true)
    await desktopEntry?.fiber?.dispose()
    expect(ctx.get('desktopIm') === undefined).toBe(true)
  } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
}, 15000)
