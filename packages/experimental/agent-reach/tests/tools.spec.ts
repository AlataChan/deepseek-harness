import { runtimePlatformQualified } from '../src/runtime-lock.ts'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import { AgentReachRunner } from '../src/runner.ts'
import { AgentReachSetupService } from '../src/setup.ts'
import { registerReachTools } from '../src/tools.ts'

let ctx: Context
let home: string
beforeEach(async () => {
  ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(LocalSubprocessRuntime)
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'reach-tools-'))
})
afterEach(async () => {
  await ctx.fiber.dispose()
  await fs.rm(home, { recursive:true,force:true })
})
function register(enableSetupTool = true): () => void {
  const runner = new AgentReachRunner(ctx, {}, { dshHome:home })
  return registerReachTools(ctx,runner,new AgentReachSetupService(ctx,{},home),{ enableSetupTool })
}
async function execute(name: string, args: unknown = {}) {
  return await ctx.tools.execute({ name,arguments:args,callId:ToolCallId(`test-${name}`),signal:new AbortController().signal })
}
it('registers four real tool schemas and disposes without leaks', () => {
  const dispose = register()
  expect(ctx.tools.schemas().filter(tool => tool.name.startsWith('reach_'))).toHaveLength(4)
  dispose()
  expect(ctx.tools.schemas().filter(tool => tool.name.startsWith('reach_'))).toHaveLength(0)
})
it('omits setup when intentionally disabled', () => {
  register(false)
  expect(ctx.tools.get('reach_setup')).toBeUndefined()
  expect(ctx.tools.schemas().filter(tool => tool.name.startsWith('reach_'))).toHaveLength(3)
})
it('exposes actionable catalog, parameters, enablement and effect classifications through the real pipeline', async () => {
  register()
  const result = await execute('reach_channels')
  expect(result.isError).toBe(false)
  const text = result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  expect(text).toContain('Discovered 14 Agent-Reach channels')
  expect(text).toContain('Channel: bilibili [default; enabled=true]')
  expect(text).toContain('Action: search')
  expect(text).toContain('query (string, required)')
  expect(text).toContain('cookie-import')
  expect(result.meta).toMatchObject({ kind:'channels',channelCount:14 })
})
it('returns NEED_SETUP from actual status without an installed runtime', async () => {
  register()
  const result = await execute('reach_status')
  expect(result.isError).toBe(false)
  expect(result.value).toMatchObject({ ok:false,error:{ code:'NEED_SETUP' } })
})
it('rejects session effects before any process dispatch', async () => {
  register()
  const spawn = vi.spyOn(ctx.subprocess,'spawn')
  const result = await execute('reach_query',{ channel:'bilibili',action:'subtitle',params:{ target:'BV1GJ411x7h7' } })
  expect(result.value).toMatchObject({ ok:false,error:{ code:'SESSION_ROUTE_FORBIDDEN' } })
  expect(spawn).not.toHaveBeenCalled()
})
it('renders a frozen setup preview without downloading or changing the home', async () => {
  register()
  const result = await execute('reach_setup',{ channel:'v2ex',action:'hot',planOnly:true })
  expect(result.isError).toBe(false)
  expect(result.value).toMatchObject(runtimePlatformQualified() ? { ok:true,status:'planned' } : { ok:false,status:'unsupported' })
  expect(await fs.readdir(home)).toEqual([])
})
it('loads, unloads and reloads the real plugin without duplicate tool registrations', async () => {
  const first = ctx.plugin(plugin,{})
  await first.await()
  expect(ctx.tools.schemas().filter(tool => tool.name.startsWith('reach_'))).toHaveLength(4)
  await first.dispose()
  expect(ctx.tools.schemas().filter(tool => tool.name.startsWith('reach_'))).toHaveLength(0)
  const second = ctx.plugin(plugin,{})
  await second.await()
  expect(ctx.tools.schemas().filter(tool => tool.name.startsWith('reach_'))).toHaveLength(4)
  await second.dispose()
})

it('matches real prompt guidance to installer availability and removes it on unload',async()=>{
  const { renderPrompt }=await import('@deepseek-ai/dsh-system-prompt')
  const first=ctx.plugin(plugin,{ enableSetupTool:false })
  await first.await()
  const readOnly=renderPrompt(await ctx.systemPrompt.assemble())
  expect(readOnly).toContain('administrator-managed setup')
  expect(readOnly).not.toContain('`reach_setup`')
  await first.dispose()
  const removed=renderPrompt(await ctx.systemPrompt.assemble())
  expect(removed).not.toContain('Agent-Reach')
  const second=ctx.plugin(plugin,{ enableSetupTool:true })
  await second.await()
  expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('`reach_setup`')
})
it('rejects invalid deployment configuration before registering anything',()=>{
  expect(()=>{ plugin.apply(ctx,{ sessionAccessRoutes:['*'] }) }).toThrow('Invalid agent-reach configuration')
  expect(ctx.tools.schemas().filter(tool=>tool.name.startsWith('reach_'))).toEqual([])
})
it('fails loudly when a standalone consumer has no tool runtime',()=>{
  const absent=new Context()
  const runner=new AgentReachRunner(absent,{}, { dshHome:home })
  const setup=new AgentReachSetupService(absent,{},home)
  expect(()=>registerReachTools(absent,runner,setup)).toThrow()
  return absent.fiber.dispose()
})

it('validates replayed discovery values before projection instead of guessing missing fields',async()=>{
  const { validateJsonSchemaValue }=await import('@deepseek-ai/dsh-tools')
  register()
  const tool=ctx.tools.get('reach_channels')
  if(!tool)throw new Error('Missing discovery tool')
  const value={ ok:true,channels:[{ name:'fixture',enabled:true,description:'Local catalog',level:'optional',actions:[
    { name:'read',help:'Read',backends:[],params:[] },
  ] }] }
  expect(validateJsonSchemaValue(tool.output.schema,value,'value')).toEqual([])
  expect(tool.output.render({},value)).toEqual([{ type:'text',text:'Discovered 1 Agent-Reach channels.\n\nChannel: fixture [optional; enabled=true] - Local catalog\n  Action: read - Read' }])
  for(const malformed of [{ ok:true,channels:[null] },{ ok:true,channels:[{}] }]){
    expect(validateJsonSchemaValue(tool.output.schema,malformed,'value').length).toBeGreaterThan(0)
  }
})
it('runs successful status and read values through the real tool pipeline',async()=>{
  const executable=path.join(home,'cli.mjs')
  const doctor={ schema_version:1,ok:true,result:{ version:'1.6.1',channels:[{ channel:'v2ex',status:'ready',problems:[] }] } }
  const read={ schema_version:1,ok:true,channel:'v2ex',action:'hot',backend:'v2ex-api',items:[{ title:'Topic',url:'https://example.com/topic',author:'Author',date:'2026-11-01',text:'Public text' }],meta:{ elapsed_ms:1,attempts:[],access:{ mode:'public',completeness_verified:false } } }
  await fs.writeFile(executable,`#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.includes('doctor')?${JSON.stringify(doctor)}:${JSON.stringify(read)}))\n`,{ mode:0o700 })
  registerReachTools(ctx,new AgentReachRunner(ctx,{ runtimeOverride:executable },{ dshHome:home }),new AgentReachSetupService(ctx,{},home))
  const status=await execute('reach_status',{ channel:'v2ex' })
  expect(status.isError).toBe(false)
  expect(status.value).toMatchObject({ ok:true,version:'1.6.1' })
  const result=await execute('reach_query',{ channel:'v2ex',action:'hot',backend:'v2ex-api' })
  expect(result.isError).toBe(false)
  expect(result.value).toMatchObject({ ok:true })
  expect(result.value).toHaveProperty('items.0.title','Topic')
})
it('returns a bounded setup failure through the tool pipeline for unknown actions',async()=>{
  register()
  const result=await execute('reach_setup',{ channel:'unknown',action:'unknown' })
  expect(result.isError).toBe(false)
  expect(result.value).toMatchObject({ ok:false,status:'failed',error:{ code:'PLAN_FAILED' } })
})
it('round-trips optional catalog fields and status diagnostics from a typed adapter',async()=>{
  const { validateJsonSchemaValue }=await import('@deepseek-ai/dsh-tools')
  class CatalogAdapter extends AgentReachRunner {
    override channels():ReturnType<AgentReachRunner['channels']>{
      return Promise.resolve({ ok:true,channels:[{ name:'v2ex',description:'Fixture',level:'default',actions:[
        { name:'hot',help:'Read',params:[{ name:'target',type:'string',required:true,help:'Target' }],backends:[] },
      ] }] })
    }
    override status():ReturnType<AgentReachRunner['status']>{return Promise.resolve({ ok:false,error:{ code:'NEED_SETUP',message:'Unavailable',hint:'Inspect the installation' } })}
  }
  registerReachTools(ctx,new CatalogAdapter(ctx,{ enabledChannels:undefined },{ dshHome:home }),new AgentReachSetupService(ctx,{},home))
  const channels=await execute('reach_channels')
  expect(channels.isError).toBe(false)
  expect(channels.value).toHaveProperty('channels.0.enabled',true)
  const status=await execute('reach_status')
  expect(status.value).toHaveProperty('error.hint','Inspect the installation')
  const tool=ctx.tools.get('reach_status')
  if(!tool)throw new Error('No status tool')
  for(const value of [{ ok:true },{ ok:false }]){
    expect(validateJsonSchemaValue(tool.output.schema,value,'value')).toEqual([])
    const text=tool.output.render({},value).flatMap(block=>block.type==='text'?[block.text]:[]).join('\n')
    expect(text).toMatch(/unknown|Not ready/)
  }
})
it('preserves sanitized login hints and only the item fields actually returned',async()=>{
  const executable=path.join(home,'login.mjs')
  const raw={ schema_version:1,ok:false,items:[{ url:'https://example.com/topic' },{ text:'Public excerpt' }],
    meta:{ elapsed_ms:1,attempts:[] },error:{ code:'NEED_LOGIN',message:'More content requires login',hint:'token=secret' } }
  await fs.writeFile(executable,`#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(raw))});process.exitCode=1\n`,{ mode:0o700 })
  registerReachTools(ctx,new AgentReachRunner(ctx,{ runtimeOverride:executable },{ dshHome:home }),new AgentReachSetupService(ctx,{},home))
  const result=await execute('reach_query',{ channel:'v2ex',action:'hot' })
  expect(result.isError).toBe(false)
  expect(result.value).toHaveProperty('error.code','NEED_LOGIN')
  expect(JSON.stringify(result.value)).not.toContain('secret')
  expect(result.value).toHaveProperty('items.1.text','Public excerpt')
})
it('discloses the exact selected native tool in a backend-specific setup preview',async()=>{
  register()
  const result=await execute('reach_setup',{ channel:'bilibili',action:'read',backend:'bili-cli',planOnly:true })
  expect(result.isError).toBe(false)
  expect(result.value).toHaveProperty('plan.backend','bili-cli')
  expect(JSON.stringify(result.value)).toContain('"toolKey":"bili-cli"')
})
it('disables all query routes only for an explicit empty channel list', async () => {
  registerReachTools(ctx, new AgentReachRunner(ctx, { enabledChannels: [] }, { dshHome: home }), new AgentReachSetupService(ctx, {}, home))
  const channels = await execute('reach_channels')
  expect(channels.value).toHaveProperty('channels.0.enabled', false)
  const result = await execute('reach_query', { channel: 'v2ex', action: 'hot' })
  expect(result.value).toHaveProperty('error.code', 'CHANNEL_DISABLED')
})
