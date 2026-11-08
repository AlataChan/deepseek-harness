/** Local status and refusal paths through real transient processes. */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { AgentReachRunner } from '../src/runner.ts'
import { RUNTIME_LOCK_ID,runtimePlatformQualified } from '../src/runtime-lock.ts'
let ctx:Context
let directory:string
beforeEach(async()=>{ctx=new Context();await ctx.plugin(LocalSubprocessRuntime).await();directory=fs.mkdtempSync(path.join(os.tmpdir(),'reach-status-'))})
afterEach(async()=>{await ctx.fiber.dispose();vi.unstubAllEnvs();fs.rmSync(directory,{ recursive:true,force:true })})
function cli(value:unknown,exit=0):string{
  const executable=path.join(directory,'fixture.mjs')
  fs.writeFileSync(executable,`#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(value))});process.exitCode=${exit}\n`,{ mode:0o700 })
  return executable
}
describe.skipIf(!runtimePlatformQualified())('requires qualified macOS arm64: status and route refusals',()=>{
  it('rejects an unknown status channel before spawning',async()=>{
    const runner=new AgentReachRunner(ctx,{}, { dshHome:directory })
    const spy=vi.spyOn(ctx.subprocess,'spawn')
    expect((await runner.status('unknown')).error?.code).toBe('BAD_INPUT')
    expect(spy).not.toHaveBeenCalled()
  })
  it('decodes doctor facts without treating cached status as a live probe',async()=>{
    const runner=new AgentReachRunner(ctx,{ runtimeOverride:cli({ schema_version:1,ok:true,result:{ version:'1.6.1',channels:[
      { channel:'v2ex',status:'ready',problems:['token=secret',12] },
      { channel:'youtube',status:'missing',problems:[] },
    ] } }) }, { dshHome:directory })
    const result=await runner.status('v2ex')
    expect(result).toMatchObject({ ok:true,version:'1.6.1',doctor:{ freshProbe:false,channels:[{ channel:'v2ex',status:'ready',enabled:true }] } })
    expect(JSON.stringify(result)).not.toContain('secret')
    const all=await runner.status()
    expect(all.ok).toBe(true)
  })
  for(const value of [
    { schema_version:2,ok:true,result:{ version:'1.6.1',channels:[] } },
    { schema_version:1,ok:true,result:{ version:'9.0',channels:[] } },
    { schema_version:1,ok:true,result:{ version:'1.6.1',channels:[{ channel:12,status:'ready' }] } },
  ])it('rejects incompatible or malformed doctor output',async()=>{
    const runner=new AgentReachRunner(ctx,{ runtimeOverride:cli(value) }, { dshHome:directory })
    expect((await runner.status()).error?.code).toBe('MALFORMED_OUTPUT')
  })
  it('refuses a shadowing native tool without altering it or spawning',async()=>{
    vi.stubEnv('HOME',directory)
    const target=path.join(directory,'.agent-reach/tools/bili-cli/venv/bin/bili')
    fs.mkdirSync(path.dirname(target),{ recursive:true });fs.writeFileSync(target,'private')
    const runner=new AgentReachRunner(ctx,{}, { dshHome:directory })
    const spy=vi.spyOn(ctx.subprocess,'spawn')
    expect((await runner.status('bilibili')).error?.code).toBe('SHADOWED_TOOL_CONFLICT')
    expect((await runner.query({ channel:'bilibili',action:'read',params:{ target:'BV1GJ411x7h7' } })).error?.code).toBe('SHADOWED_TOOL_CONFLICT')
    expect(fs.readFileSync(target,'utf8')).toBe('private')
    expect(spy).not.toHaveBeenCalled()
  })
  it('refuses invalid parameters before inspecting an executable',async()=>{
    const runner=new AgentReachRunner(ctx,{}, { dshHome:directory })
    const spy=vi.spyOn(ctx.subprocess,'spawn')
    expect((await runner.query({ channel:'v2ex',action:'hot',params:{ unexpected:'x' } })).error?.code).toBe('BAD_INPUT')
    expect(spy).not.toHaveBeenCalled()
  })
  it('does not start unqualified shared-browser backends even after route opt-in',async()=>{
    const runner=new AgentReachRunner(ctx,{ enabledChannels:['twitter'],allowExperimentalChannels:true,sessionAccessRoutes:['twitter/search/opencli'] }, { dshHome:directory })
    const spy=vi.spyOn(ctx.subprocess,'spawn')
    expect((await runner.query({ channel:'twitter',action:'search',backend:'opencli',params:{ query:'fixture' } })).error?.code).toBe('UNSUPPORTED')
    expect(spy).not.toHaveBeenCalled()
  })
  it('rejects absent administrator overrides and corrupt owner records',()=>{
    for(const runtimeOverride of ['relative-cli',path.join(directory,'missing')]){
      const runner=new AgentReachRunner(ctx,{ runtimeOverride },{ dshHome:directory })
      expect(runner.resolveCliExecutable().found).toBe(false)
    }
    const release=path.join(directory,'runtimes/agent-reach/releases',RUNTIME_LOCK_ID)
    fs.mkdirSync(release,{ recursive:true });fs.writeFileSync(path.join(release,'installation-record.json'),'{broken')
    const runner=new AgentReachRunner(ctx,{}, { dshHome:directory })
    const resolved=runner.resolveCliExecutable()
    expect(resolved.found).toBe(false)
    if(resolved.found)throw new Error('Unexpected runtime')
    expect(resolved.reason).toContain('Corrupt installation record')
  })
})
it.skipIf(!runtimePlatformQualified())('preserves default channel enablement for undefined SDK options and absent doctor diagnostics', async () => {
  const executable = cli({ schema_version: 1, ok: true, result: { version: '1.6.1', channels: [{ channel: 'v2ex', status: 'ready' }] } })
  const runner = new AgentReachRunner(ctx, { runtimeOverride: executable, enabledChannels: undefined }, { dshHome: directory })
  expect((await runner.status('v2ex'))).toMatchObject({ ok: true, doctor: { channels: [{ enabled: true, problems: [] }] } })
})
it.skipIf(!runtimePlatformQualified())('passes an explicit positive query deadline through the safe CLI arguments', async () => {
  const executable = cli({ schema_version: 1, ok: true, channel: 'v2ex', action: 'hot', items: [], meta: { attempts: [] } })
  const runner = new AgentReachRunner(ctx, { runtimeOverride: executable }, { dshHome: directory })
  expect((await runner.query({ channel: 'v2ex', action: 'hot', timeoutMs: 2000 })).ok).toBe(true)
})
it('keeps channel and session policy independent of the caller’s mutable input arrays', async () => {
  const channels = ['bilibili']
  const routes: string[] = []
  const runner = new AgentReachRunner(ctx, { enabledChannels: channels, sessionAccessRoutes: routes }, { dshHome: directory })
  channels.push('v2ex')
  routes.push('bilibili/subtitle/bili-cli')
  expect((await runner.query({ channel: 'v2ex', action: 'hot' })).error?.code).toBe('CHANNEL_DISABLED')
  expect((await runner.query({ channel: 'bilibili', action: 'subtitle', params: { target: 'BV1GJ411x7h7' } })).error?.code).toBe('SESSION_ROUTE_FORBIDDEN')
})
