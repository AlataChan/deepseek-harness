/** Provider-reported I/O and observation failures; real OS containment remains in containment.spec.ts. */
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle,SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { OwnedCommands } from '../src/execution.ts'
let ctx:Context
const spec={ argv:['fixture'],cwd:process.cwd(),stdio:{ stdin:'ignore',stdout:'pipe',stderr:'pipe' },graceMs:100 } as const
const limits={ timeoutMs:1000,maxStdoutBytes:1024,maxStderrBytes:1024 }
const outcome:SubprocessOutcome={ exitCode:0,signal:null }
beforeEach(async()=>{ctx=new Context();await ctx.plugin(LocalSubprocessRuntime).await()})
afterEach(async()=>{await ctx.fiber.dispose();vi.restoreAllMocks()})
function handle(overrides:Partial<SubprocessHandle>={}):SubprocessHandle{
  return { stdin:undefined,stdout:undefined,stderr:undefined,control:undefined,collected:{},done:Promise.resolve(outcome),
    terminate:vi.fn(),waitForExit:async()=>true,...overrides }
}
it('accepts absent pipe streams and decodes providers that emit text chunks',async()=>{
  const commands=new OwnedCommands(ctx)
  vi.spyOn(ctx.subprocess,'spawn').mockReturnValueOnce(handle()).mockReturnValueOnce(handle({ stdout:Readable.from(['text']),stderr:Readable.from(['diagnostic']) }))
  expect((await commands.run(spec,limits)).stdout).toBe('')
  const text=await commands.run(spec,limits)
  expect(text.stdout).toBe('text')
  expect(text.stderr).toBe('diagnostic')
})
for(const failure of ['false','throws','outcome'] as const){
  it(`reports quiescence failure when the provider ${failure}`,async()=>{
    const terminate = vi.fn()
    const failed=handle({ terminate,
      done:failure==='outcome'?Promise.reject(new Error('provider lost')):Promise.resolve(outcome),
      waitForExit:async()=>{if(failure==='throws')throw new Error('range observer lost');return false},
    })
    vi.spyOn(ctx.subprocess,'spawn').mockReturnValue(failed)
    expect((await new OwnedCommands(ctx).run(spec,limits)).error?.code).toBe('QUIESCENCE_FAILED')
    expect(terminate).toHaveBeenCalled()
  })
}
it('settles a stream error after retiring the provider range',async()=>{
  let finish!:(value:SubprocessOutcome)=>void
  const done=new Promise<SubprocessOutcome>((resolve)=>{finish=resolve})
  const stdout=new Readable({ read(){this.destroy(new Error('pipe failed'))} })
  const failed=handle({ stdout,done,terminate:()=>{finish(outcome)} })
  vi.spyOn(ctx.subprocess,'spawn').mockReturnValue(failed)
  const result=await new OwnedCommands(ctx).run(spec,limits)
  expect(result.error?.code).toBe('EXECUTION_FAILED')
  expect(result.error?.message).toContain('pipe failed')
})
it('classifies a deadline as timeout even if the provider reports normal exit zero',async()=>{
  let finish!:(value:SubprocessOutcome)=>void
  const done=new Promise<SubprocessOutcome>((resolve)=>{finish=resolve})
  vi.spyOn(ctx.subprocess,'spawn').mockImplementation((request)=>{
    request.signal?.addEventListener('abort',()=>{finish(outcome)},{ once:true })
    return handle({ done })
  })
  expect((await new OwnedCommands(ctx).run(spec,{ ...limits,timeoutMs:10 })).error?.code).toBe('TIMEOUT')
})
it('rejects reuse after the owning plugin has unloaded without touching the provider',async()=>{
  let commands:OwnedCommands|undefined
  const owner=ctx.plugin({ inject:['subprocess'],apply(scope){commands=new OwnedCommands(scope)} })
  await owner.await()
  if(!commands)throw new Error('No owner')
  await owner.dispose()
  const spawn=vi.spyOn(ctx.subprocess,'spawn')
  expect((await commands.run(spec,limits)).error?.code).toBe('EXECUTION_CANCELLED')
  expect(spawn).not.toHaveBeenCalled()
})
it('classifies a provider refusal before handle creation',async()=>{
  vi.spyOn(ctx.subprocess,'spawn').mockImplementation(()=>{throw new Error('provider refused allocation')})
  expect((await new OwnedCommands(ctx).run(spec,limits)).error?.code).toBe('EXECUTION_FAILED')
})
for(const mode of ['timeout','cancel'] as const){
  it(`keeps ${mode} classification when a provider pipe fails during abort`,async()=>{
    let finish!:(value:SubprocessOutcome)=>void
    const done=new Promise<SubprocessOutcome>((resolve)=>{finish=resolve})
    const stdout=new Readable({ read(){} })
    vi.spyOn(ctx.subprocess,'spawn').mockImplementation((request)=>{
      request.signal?.addEventListener('abort',()=>{stdout.destroy(new Error('aborted pipe'));finish(outcome)},{ once:true })
      return handle({ stdout,done })
    })
    const controller=new AbortController()
    const work=new OwnedCommands(ctx).run(spec,{ ...limits,timeoutMs:mode==='timeout'?10:1000,signal:controller.signal })
    if(mode==='cancel')controller.abort()
    expect((await work).error?.code).toBe(mode==='timeout'?'TIMEOUT':'EXECUTION_CANCELLED')
  })
}
for(const quiescent of [true,false]){
  it(`observes unload and reports provider range settlement ${quiescent}`,async()=>{
    let finish!:(value:SubprocessOutcome)=>void
    const done=new Promise<SubprocessOutcome>((resolve)=>{finish=resolve})
    const errors:string[]=[]
    ctx.logger.exporter({ export(message){if(message.type==='error')message.args.forEach((value:unknown)=>{errors.push(String(value))})} })
    vi.spyOn(ctx.subprocess,'spawn').mockReturnValue(handle({ done,terminate:()=>{finish(outcome)},waitForExit:async()=>quiescent }))
    let commands:OwnedCommands|undefined
    const owner=ctx.plugin({ inject:['subprocess'],apply(scope){commands=new OwnedCommands(scope)} })
    await owner.await()
    if(!commands)throw new Error('No owner')
    const work=commands.run(spec,limits)
    await owner.dispose()
    expect((await work).error?.code).toBe(quiescent?'EXECUTION_CANCELLED':'QUIESCENCE_FAILED')
    expect(errors.some(value=>value.includes('range did not settle on unload'))).toBe(!quiescent)
  })
}
