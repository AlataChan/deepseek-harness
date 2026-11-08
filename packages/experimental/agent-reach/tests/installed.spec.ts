import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { expect, it } from 'vitest'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { AgentReachSetupService } from '../src/setup.ts'
import { AgentReachRunner } from '../src/runner.ts'

it.skipIf(process.env.AGENT_REACH_LIVE_INSTALL !== '1')('installs real frozen artifacts and runs the installed CLI without ambient Python', async () => {
  const restoreProxy = await installProxyFromEnvironment({ get(name) {
    const value = /^(http|https|all)_proxy$/i.test(name) ? process.env.AGENT_REACH_TEST_PROXY_URL : process.env[name]
    return value === undefined ? undefined : { value }
  } }, (message) => { console.log(message) })
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'reach-installed-'))
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountAgentLoopTestHarness(ctx)
    await ctx.plugin(LocalSubprocessRuntime).await()
    await ctx.plugin(ApprovalService, { policy: 'ask' }).await()
    const owner = await ctx.agents.create({ sessionId: SessionId('reach-real-setup') })
    owner.agent.session.append('turn/start', { turn: 1 })
    let approvals = 0
    ctx.on('approval/request', () => { approvals++; return Promise.resolve<ApprovalOutcome>('allowed-once') })
    const setup = new AgentReachSetupService(ctx, {}, home)
    const core = await setup.runSetup('v2ex', 'hot', undefined, { agent: owner.agent, callId: ToolCallId('reach-real-core-install') })
    expect(core.status, JSON.stringify(core.error ?? core.message)).toBe('installed')
    expect(approvals).toBe(1)
    const firstRuntime = new AgentReachRunner(ctx, {}, { dshHome: home }).resolveCliExecutable()
    if (!firstRuntime.found) throw new Error(firstRuntime.reason)
    expect((await setup.runSetup('v2ex', 'hot')).status).toBe('not_needed')
    const installed = await setup.runSetup('bilibili', 'read', 'bili-cli', { agent: owner.agent, callId: ToolCallId('reach-real-install') })
    expect(installed.status, JSON.stringify(installed.error ?? installed.message)).toBe('installed')
    expect(approvals).toBe(2)
    expect((await fs.stat(firstRuntime.executable)).isFile()).toBe(true)
    await owner.dispose()
    const runner = new AgentReachRunner(ctx, {}, { dshHome: home })
    const runtime = runner.resolveCliExecutable()
    expect(runtime.found).toBe(true)
    const version = await runner.spawnCli(['version'])
    expect(version.ok, JSON.stringify(version.error ?? version.stderr)).toBe(true)
    const parsed: unknown = JSON.parse(version.stdout)
    expect(parsed).toMatchObject({ result:{ version:'1.6.1' } })
    const status = await runner.status('v2ex')
    expect(status.ok).toBe(true)
    const reused=await new AgentReachSetupService(ctx,{},home).runSetup('bilibili','read')
    expect(reused.status).toBe('not_needed')
    console.log('INSTALLED_RUNTIME_HOME', home)
  } finally {
    await ctx.fiber.dispose()
    await restoreProxy()
    if (process.env.AGENT_REACH_KEEP_INSTALL !== '1') await fs.rm(home, { recursive: true, force: true })
  }
}, 900000)
