/** Knowledge-service child ownership, environment and network refusal controls. */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, get } from 'node:http'
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

it('scrubs ambient credentials while preserving resolved proxy policy, bypass entries, and deliberate credentials', async () => {
  const { runner, dir } = await fixture()
  vi.stubEnv('TEST_KEY', 'synthetic-private')
  vi.stubEnv('HTTPS_PROXY', 'http://proxy.example:8080')
  vi.stubEnv('NO_PROXY', 'corp.internal')
  const result = await runner.run({ argv: [process.execPath, '-e', 'process.stdout.write(JSON.stringify({key:process.env.TEST_KEY,httpsProxy:process.env.HTTPS_PROXY,noProxy:process.env.NO_PROXY,explicit:process.env.EXPLICIT_KEY}))'], cwd: dir, env: { EXPLICIT_KEY: 'synthetic-approved' } })
  expect(JSON.parse(result.stdout)).toEqual({
    httpsProxy: 'http://proxy.example:8080',
    noProxy: 'corp.internal,localhost,127.0.0.1,::1',
    explicit: 'synthetic-approved',
  })
})

it('authenticates through a configured proxy without forwarding unrelated credentials', async () => {
  const { runner, dir } = await fixture()
  const authorization = `Basic ${Buffer.from('review-user:review-password').toString('base64')}`
  const server = createServer((request, response) => {
    response.writeHead(request.headers['proxy-authorization'] === authorization ? 200 : 407)
    response.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => { await new Promise<void>(resolve => server.close(() => resolve())) })
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('missing listener')
  const endpoint = `http://127.0.0.1:${address.port}`
  const unauthenticatedStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(endpoint, (response) => {
      response.resume()
      response.on('end', () => resolve(response.statusCode))
    }).on('error', reject)
  })
  expect(unauthenticatedStatus).toBe(407)
  vi.stubEnv('http_proxy', endpoint.replace('://', '://review-user:review-password@'))
  vi.stubEnv('HTTP_PROXY', endpoint.replace('://', '://review-user:review-password@'))
  vi.stubEnv('TEST_KEY', 'unrelated-synthetic-credential')
  const source = `
    const http = require('node:http');
    const proxy = new URL(process.env.HTTP_PROXY);
    const authorization = 'Basic ' + Buffer.from(decodeURIComponent(proxy.username) + ':' + decodeURIComponent(proxy.password)).toString('base64');
    const request = http.request({ hostname: proxy.hostname, port: proxy.port, path: 'http://review-target.invalid/v1', headers: { 'Proxy-Authorization': authorization } }, response => {
      response.resume();
      response.on('end', () => process.stdout.write(JSON.stringify({ status: response.statusCode, ambientCredentialPresent: process.env.TEST_KEY !== undefined })));
    });
    request.on('error', () => process.exit(1));
    request.end();
  `
  const result = await runner.run({ argv: [process.execPath, '-e', source], cwd: dir })
  expect(JSON.parse(result.stdout)).toEqual({ status: 200, ambientCredentialPresent: false })
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
