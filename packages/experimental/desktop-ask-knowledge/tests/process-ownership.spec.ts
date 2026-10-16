/** Knowledge-service child ownership, environment and network refusal controls. */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgeProcessRunner } from '../src/sidecar.ts'
import { offlineConverterArgv } from '../src/converters/anydoc.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); vi.unstubAllEnvs() })

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'ak-owned-'))
  const runner = new KnowledgeProcessRunner()
  cleanups.push(async () => { await runner.dispose(); await rm(dir, { recursive: true, force: true }) })
  return { dir, runner }
}

async function waitForFile(path: string) {
  for (let i = 0; i < 300; i++) {
    if (await stat(path).then(() => true, () => false)) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('child never signalled readiness')
}

it('scrubs ambient credential and proxy variables while retaining deliberate credentials', async () => {
  const { runner, dir } = await fixture()
  vi.stubEnv('TEST_KEY', 'synthetic-private')
  vi.stubEnv('HTTP_PROXY', 'http://synthetic.invalid')
  const result = await runner.run({ argv: [process.execPath, '-e', 'process.stdout.write(JSON.stringify({key:process.env.TEST_KEY,proxy:process.env.HTTP_PROXY,explicit:process.env.EXPLICIT_KEY}))'], cwd: dir, env: { EXPLICIT_KEY: 'synthetic-approved' } })
  expect(JSON.parse(result.stdout)).toEqual({ explicit: 'synthetic-approved' })
})

it('aborts and joins descendants before returning a rejected job', async () => {
  const { runner, dir } = await fixture()
  const pidFile = join(dir, 'child.pid')
  const controller = new AbortController()
  const childSource = `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`
  const source = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{stdio:'ignore'});setInterval(()=>{},1000)`
  const work = runner.run({ argv: [process.execPath, '-e', source], cwd: dir, signal: controller.signal })
  // Attach rejection handling before issuing cancellation.
  const rejection = expect(work).rejects.toThrow('aborted')
  await waitForFile(pidFile)
  const pid = Number(await readFile(pidFile, 'utf8'))
  controller.abort()
  await rejection
  expect(() => process.kill(pid, 0)).toThrow()
})

it('unload settles active work and refuses new work', async () => {
  const { runner, dir } = await fixture()
  const ready = join(dir, 'ready')
  const work = runner.run({ argv: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)`], cwd: dir })
  const rejection = expect(work).rejects.toThrow('cancelled')
  await waitForFile(ready)
  await runner.dispose()
  await rejection
  await expect(runner.run({ argv: [process.execPath, '-e', ''], cwd: dir })).rejects.toThrow('disposed')
})

it.skipIf(process.platform !== 'darwin')('native converter OS policy prevents outbound loopback requests', async () => {
  const { runner, dir } = await fixture()
  let requests = 0
  const server = createServer((_request, response) => { requests++; response.end('unexpected') })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => { await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('missing listener')
  await expect(runner.run({ argv: offlineConverterArgv([process.execPath, '-e', `fetch('http://127.0.0.1:${address.port}').then(()=>process.exit(0),()=>process.exit(9))`]), cwd: dir })).rejects.toThrow('exited 9')
  expect(requests).toBe(0)
})

it.skipIf(process.platform !== 'darwin')('native worker reports a deliberately missing addon and does not fabricate extraction', async () => {
  const { runner, dir } = await fixture()
  const input = join(import.meta.dirname, 'fixtures', 'conversion', 'sample.docx')
  const resultPath = join(dir, 'native-result.json')
  const specPath = join(dir, 'spec.json')
  await writeFile(specPath, JSON.stringify({ protocol: 'file-result-v1', jobId: 'missing-addon-control', inputPath: input, outputPath: resultPath, format: 'docx' }))
  const worker = join(import.meta.dirname, '..', 'src', 'converter-worker.ts')
  const output = await runner.run({
    argv: offlineConverterArgv([process.execPath, '--import', import.meta.resolve('tsx/esm'), worker, specPath]),
    cwd: dir,
    env: { NAPI_RS_NATIVE_LIBRARY_PATH: join(dir, 'deliberately-missing.node') },
  })
  expect(JSON.parse(output.stdout)).toMatchObject({ ok: false, status: 'unsupported' })
  expect(JSON.parse(await readFile(resultPath, 'utf8'))).toMatchObject({ ok: false, code: 'missing_native_module', markdown: '' })
})
