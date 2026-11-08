import { runtimePlatformQualified } from '../src/runtime-lock.ts'
import * as fs from 'node:fs'
import { once } from 'node:events'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentReachSetupService } from '../src/setup.ts'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountAgentLoopTestDependencies,mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { computeSetupPlan } from '../src/setup-plan.ts'

describe.skipIf(!runtimePlatformQualified())('requires qualified macOS arm64: Agent-Reach Dependency Setup and Planning', () => {
  let ctx: Context
  let tempDir: string

  beforeEach(() => {
    ctx = new Context()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-reach-setup-test-'))
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('computes frozen installation plan for unprovisioned bilibili route', () => {
    const res = computeSetupPlan('bilibili', 'read', undefined, undefined, tempDir, false, new Set())
    expect(res.ok).toBe(true)
    if (res.ok) {
      const plan = res.plan
      expect(plan.channel).toBe('bilibili')
      expect(plan.action).toBe('read')
      expect(plan.needsCoreInstall).toBe(true)
      expect(plan.needsToolInstall).toBe(true)
      expect(plan.packages.map(p => p.name)).toContain('agent-reach')
      expect(plan.packages.map(p => p.name)).toContain('bilibili-cli')
      expect(plan.licenseSummary).toContain('MIT')
      expect(plan.isFullyProvisioned).toBe(false)
    }
  })

  it('detects when route is already fully provisioned', () => {
    const res = computeSetupPlan(
      'bilibili',
      'read',
      undefined,
      undefined,
      tempDir,
      true, // core installed
      new Set(['bili-cli']), // tool installed
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.plan.isFullyProvisioned).toBe(true)
      expect(res.plan.packages.length).toBe(0)
    }
  })

  it('runs setup in planOnly mode without touching disk or creating releases', async () => {
    const service = new AgentReachSetupService(ctx, {}, tempDir)
    const result = await service.runSetup('bilibili', 'read', undefined, { planOnly: true })

    expect(result.ok).toBe(true)
    expect(result.status).toBe('planned')
    expect(result.plan).toBeDefined()

    // No release directory should have been created on disk
    const releaseRoot = path.join(tempDir, 'runtimes', 'agent-reach', 'releases')
    expect(fs.existsSync(releaseRoot)).toBe(false)
  })

  it('declines installation when approval is required and no interactive confirmation is available', async () => {
    const service = new AgentReachSetupService(ctx, {}, tempDir)
    const result = await service.runSetup('bilibili', 'read', undefined, {})

    expect(result.ok).toBe(false)
    expect(result.status).toBe('declined')
    expect(result.error?.code).toBe('APPROVAL_DECLINED')
  })

  for (const policy of ['ask', 'never'] as const) {
    it(`uses actual approval policy ${policy} and downloads nothing after rejection`, async () => {
      await mountAgentLoopTestDependencies(ctx)
      await mountAgentLoopTestHarness(ctx)
      await ctx.plugin(ApprovalService, { policy })
      const sandbox = ctx.plugin(SandboxPolicyService,{ mode:'danger-full-access' })
      await sandbox.await()
      const owner = await ctx.agents.create({ sessionId:SessionId(`reach-approval-${policy}`) })
      owner.agent.session.append('turn/start',{ turn:1 })
      expect(ctx.sandboxPolicy.resolve({ session:owner.agent.session }).mode).toBe('danger-full-access')
      let asked = 0
      ctx.on('approval/request', () => {asked++; return Promise.resolve<ApprovalOutcome>('rejected')})
      const service = new AgentReachSetupService(ctx, {}, tempDir)
      const result = await service.runSetup('v2ex','hot',undefined,{ agent:owner.agent })
      expect(result.status).toBe('declined')
      expect(asked).toBe(policy === 'ask' ? 1 : 0)
      expect(owner.agent.session.snapshotEvents().filter(event => event.type === 'approval/asked')).toHaveLength(1)
      expect(fs.readdirSync(tempDir)).toEqual([])
      await owner.dispose()
    })
  }
})

it.skipIf(!runtimePlatformQualified())('honors real one-shot approval, rejects concurrent setup, and settles cancellation',async()=>{
  const { createServer }=await import('node:http')
  const { LocalSubprocessRuntime }=await import('@deepseek-ai/dsh-subprocess-local')
  const ctx=new Context()
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'reach-approved-'))
  const originalFetch=globalThis.fetch
  let ready!:()=>void
  const started=new Promise<void>((resolve)=>{ready=resolve})
  let downloads=0
  const server=createServer((_request,response)=>{downloads++;response.writeHead(200);response.write('stalled');ready()})
  server.listen(0,'127.0.0.1')
  await once(server,'listening')
  const address=server.address()
  if(!address||typeof address==='string')throw new Error('No fixture listener')
  globalThis.fetch=(_input,init)=>originalFetch(`http://127.0.0.1:${address.port}`,init)
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountAgentLoopTestHarness(ctx)
    await ctx.plugin(LocalSubprocessRuntime).await()
    await ctx.plugin(ApprovalService,{ policy:'ask' }).await()
    const owner=await ctx.agents.create({ sessionId:SessionId('reach-approved') })
    owner.agent.session.append('turn/start',{ turn:1 })
    let approvals=0
    ctx.on('approval/request',(request)=>{
      approvals++
      expect(request.reason).toContain('Frozen manifest:')
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    const service=new AgentReachSetupService(ctx,{},directory)
    const controller=new AbortController()
    const work=service.runSetup('v2ex','hot',undefined,{ agent:owner.agent,signal:controller.signal })
    await started
    const other=await service.runSetup('v2ex','hot',undefined,{ agent:owner.agent })
    expect(other.error?.code).toBe('BUSY')
    expect(approvals).toBe(1)
    expect(downloads).toBe(1)
    controller.abort()
    expect((await work).error?.code).toBe('CANCELLED')
    const planned=await service.runSetup('v2ex','hot',undefined,{ planOnly:true })
    expect(planned.status).toBe('planned')
    expect(downloads).toBe(1)
    await owner.dispose()
  }finally{
    globalThis.fetch=originalFetch
    await ctx.fiber.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve,reject)=>{server.close((error)=>{if(error)reject(error);else resolve()})})
    fs.rmSync(directory,{ recursive:true,force:true })
  }
})

it.skipIf(!runtimePlatformQualified())('requires a fresh approval if installation state changes during the question',async()=>{
  const ctx=new Context()
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'reach-plan-changed-'))
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountAgentLoopTestHarness(ctx)
    await ctx.plugin(ApprovalService,{ policy:'ask' }).await()
    const owner=await ctx.agents.create({ sessionId:SessionId('reach-plan-changed') })
    owner.agent.session.append('turn/start',{ turn:1 })
    const plan=computeSetupPlan('v2ex','hot',undefined,{},directory)
    if(!plan.ok)throw new Error(plan.error)
    ctx.on('approval/request',()=>{
      fs.mkdirSync(plan.plan.releaseRoot,{ recursive:true })
      fs.writeFileSync(path.join(plan.plan.releaseRoot,'installation-record.json'),'{}')
      return Promise.resolve<ApprovalOutcome>('allowed-once')
    })
    const service=new AgentReachSetupService(ctx,{},directory)
    const result=await service.runSetup('v2ex','hot',undefined,{ agent:owner.agent })
    expect(result.error?.code).toBe('PLAN_CHANGED')
    expect(fs.readdirSync(plan.plan.releaseRoot)).toEqual(['installation-record.json'])
    const corrupt=await service.runSetup('v2ex','hot',undefined,{ agent:owner.agent })
    expect(corrupt.status).toBe('failed')
    expect(corrupt.message).toContain('Corrupt installation record')
    await owner.dispose()
  }finally{await ctx.fiber.dispose();fs.rmSync(directory,{ recursive:true,force:true })}
})
it.skipIf(!runtimePlatformQualified())('does not mutate storage for a cancelled request or an invalid route',async()=>{
  const ctx=new Context()
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'reach-no-setup-'))
  try {
    const service=new AgentReachSetupService(ctx,{},directory)
    const signal=AbortSignal.abort()
    const cancelled=await service.runSetup('v2ex','hot',undefined,{ signal })
    expect(cancelled.error?.code).toBe('CANCELLED')
    const invalid=await service.runSetup('unknown','read')
    expect(invalid.error?.code).toBe('PLAN_FAILED')
    expect(fs.readdirSync(directory)).toEqual([])
  }finally{await ctx.fiber.dispose();fs.rmSync(directory,{ recursive:true,force:true })}
})

it.skipIf(!runtimePlatformQualified())('reports an actual acquisition failure after approval without promoting a runtime', async () => {
  const { createServer } = await import('node:http')
  const { installationTarget } = await import('../src/installer.ts')
  const ctx = new Context()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-download-failure-'))
  const originalFetch = globalThis.fetch
  const server = createServer((_request, response) => { response.writeHead(404).end() })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing HTTP listener')
  globalThis.fetch = (input, init) => {
    expect(input).toBe(installationTarget()?.uv.url)
    return originalFetch(`http://127.0.0.1:${address.port}`, init)
  }
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountAgentLoopTestHarness(ctx)
    await ctx.plugin(ApprovalService, { policy: 'ask' }).await()
    const owner = await ctx.agents.create({ sessionId: SessionId('reach-download-failure') })
    owner.agent.session.append('turn/start', { turn: 1 })
    ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
    const result = await new AgentReachSetupService(ctx, {}, directory).runSetup('v2ex', 'hot', undefined, { agent: owner.agent })
    expect(result).toMatchObject({ status: 'failed', error: { code: 'INSTALL_FAILED' } })
    expect(result.message).toContain('HTTP 404')
    if (!result.plan) throw new Error('Missing approved plan')
    expect(fs.existsSync(path.join(result.plan.releaseRoot, 'installation-record.json'))).toBe(false)
    expect(fs.existsSync(path.join(result.plan.releaseRoot, '.setup.lock'))).toBe(false)
    await owner.dispose()
  } finally {
    globalThis.fetch = originalFetch
    await ctx.fiber.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

it.skipIf(!runtimePlatformQualified())('refuses a second approved setup that overlaps an already active installation', async () => {
  const { createServer } = await import('node:http')
  const { installationTarget } = await import('../src/installer.ts')
  const ctx = new Context()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reach-overlapping-approvals-'))
  const cancel = new AbortController()
  const originalFetch = globalThis.fetch
  let signalDownload: () => void = () => { throw new Error('Missing download observer') }
  const downloaded = new Promise<void>((resolve) => { signalDownload = resolve })
  let signalQuestions: () => void = () => { throw new Error('Missing approval observer') }
  const questions = new Promise<void>((resolve) => { signalQuestions = resolve })
  const grants: Array<(outcome: ApprovalOutcome) => void> = []
  let downloads = 0
  const server = createServer((_request, response) => { downloads++; response.writeHead(200); response.write('stalled'); signalDownload() })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing HTTP listener')
  globalThis.fetch = (input, init) => {
    expect(input).toBe(installationTarget()?.uv.url)
    return originalFetch(`http://127.0.0.1:${address.port}`, init)
  }
  let pending: Promise<PromiseSettledResult<unknown>[]> = Promise.resolve([])
  try {
    await mountAgentLoopTestDependencies(ctx)
    await mountAgentLoopTestHarness(ctx)
    await ctx.plugin(ApprovalService, { policy: 'ask' }).await()
    const owner = await ctx.agents.create({ sessionId: SessionId('reach-overlapping-approvals') })
    owner.agent.session.append('turn/start', { turn: 1 })
    ctx.on('approval/request', () => new Promise<ApprovalOutcome>((resolve) => {
      grants.push(resolve)
      if (grants.length === 2) signalQuestions()
    }))
    const service = new AgentReachSetupService(ctx, {}, directory)
    const first = service.runSetup('v2ex', 'hot', undefined, { agent: owner.agent, signal: cancel.signal })
    const second = service.runSetup('v2ex', 'hot', undefined, { agent: owner.agent, signal: cancel.signal })
    pending = Promise.allSettled([first, second])
    await questions
    const firstGrant = grants[0]
    const secondGrant = grants[1]
    if (!firstGrant || !secondGrant) throw new Error('Both approvals must be pending')
    expect(downloads).toBe(0)
    firstGrant('allowed-once')
    await downloaded
    secondGrant('allowed-once')
    expect((await second).error?.code).toBe('BUSY')
    expect(downloads).toBe(1)
    cancel.abort()
    expect((await first).error?.code).toBe('CANCELLED')
    await owner.dispose()
  } finally {
    cancel.abort()
    globalThis.fetch = originalFetch
    await ctx.fiber.dispose()
    await pending
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
