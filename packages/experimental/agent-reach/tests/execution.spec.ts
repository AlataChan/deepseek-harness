import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OwnedCommands,reachEnvironment } from '../src/execution.ts'

let ctx: Context
let directory: string
beforeEach(async () => {
  ctx = new Context()
  const provider = ctx.plugin(LocalSubprocessRuntime)
  await provider.await()
  directory = await fs.mkdtemp(path.join(os.tmpdir(),'reach-range-'))
})
afterEach(async () => {
  await ctx.fiber.dispose()
  await fs.rm(directory,{ recursive:true,force:true })
})
function run(script: string, options: { signal?: AbortSignal; timeoutMs?: number; maxStdoutBytes?: number } = {}) {
  return new OwnedCommands(ctx).run({
    argv:[process.execPath,'--input-type=module','-e',script],cwd:directory,
    stdio:{ stdin:'ignore',stdout:'pipe',stderr:'pipe' },graceMs:100,
  }, { timeoutMs:options.timeoutMs ?? 2000,maxStdoutBytes:options.maxStdoutBytes ?? 4096,maxStderrBytes:32,
    ...(options.signal ? { signal:options.signal } : {}),
  })
}
it('decodes split UTF-8 and bounds stderr while observing normal range exit', async () => {
  const result = await run("const bytes=Buffer.from('你好');process.stdout.write(bytes.subarray(0,2));setImmediate(()=>process.stdout.write(bytes.subarray(2)));process.stderr.write('x'.repeat(100))")
  expect(result.ok).toBe(true)
  expect(result.stdout).toBe('你好')
  expect(result.stderr.length).toBe(32)
})
it('terminates an overflowing producer and reports output failure', async () => {
  const result = await run("setInterval(()=>process.stdout.write('x'.repeat(4096)),1)",{ maxStdoutBytes:64 })
  expect(result.error?.code).toBe('OVERSIZED_OUTPUT')
})
it('reports a timeout even when SIGTERM is trapped as exit zero', async () => {
  const result = await run("import {writeFileSync} from 'node:fs';process.on('SIGTERM',()=>{writeFileSync('handled','yes');process.exit(0)});setInterval(()=>{},1000)",{ timeoutMs:300 })
  expect(result.error?.code).toBe('TIMEOUT')
  expect(await fs.readFile(path.join(directory,'handled'),'utf8')).toBe('yes')
})
it('rejects cancellation before dispatch without creating a range', async () => {
  const controller = new AbortController()
  controller.abort()
  const spawn = vi.spyOn(ctx.subprocess,'spawn')
  expect((await run("throw Error('must not execute')",{ signal:controller.signal })).error?.code).toBe('EXECUTION_CANCELLED')
  expect(spawn).not.toHaveBeenCalled()
})
it('retires inherited stdout holders after the direct child exits', async () => {
  const result = await run("import {spawn} from 'node:child_process';spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});process.exit(0)")
  expect(result.ok).toBe(true)
  expect(result.error).toBeUndefined()
})
it('fails explicitly for a missing executable', async () => {
  const result = await new OwnedCommands(ctx).run({ argv:[path.join(directory,'absent')],cwd:directory,
    stdio:{ stdin:'ignore',stdout:'pipe',stderr:'pipe' },graceMs:100,
  },{ timeoutMs:1000,maxStdoutBytes:1024,maxStderrBytes:1024 })
  expect(result.ok).toBe(false)
})

it('does not inherit ambient Python imports or an unrelated virtual environment',()=>{
  vi.stubEnv('PYTHONPATH','/private/unqualified')
  vi.stubEnv('VIRTUAL_ENV','/private/borrowed')
  try {
    const env=reachEnvironment()
    expect(env.PYTHONPATH).toBeUndefined()
    expect(env.VIRTUAL_ENV).toBeUndefined()
    expect(env.PYTHONNOUSERSITE).toBe('1')
    expect(env.REACH_API_SUPERVISED).toBe('1')
  } finally { vi.unstubAllEnvs() }
})
