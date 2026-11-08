import { runtimePlatformQualified } from '../src/runtime-lock.ts'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { acquireArtifact } from '../src/installer.ts'

let server: http.Server
let url: string
let directory: string
let requests: number
let acceptedType: string | undefined
const bytes = Buffer.from('qualified fixture artifact')
const digest = createHash('sha256').update(bytes).digest('hex')
beforeEach(async () => {
  requests = 0
  acceptedType = undefined
  directory = await fs.mkdtemp(path.join(os.tmpdir(),'reach-acquire-'))
  server = http.createServer((request,response) => {
    requests++
    acceptedType = request.headers.accept
    if (request.url === '/empty') {response.writeHead(204).end(); return}
    if (request.url === '/missing') {response.writeHead(404).end(); return}
    response.end(bytes)
  })
  server.listen(0,'127.0.0.1')
  await once(server,'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture failed to bind')
  url = `http://127.0.0.1:${address.port}`
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve,reject) => {server.close((error) => {if (error) reject(error); else resolve()})})
  await fs.rm(directory,{ recursive:true,force:true })
})
it('writes only the bytes whose digest is verified', async () => {
  const destination = path.join(directory,'artifact')
  await acquireArtifact(url,digest,destination,new AbortController().signal)
  expect(await fs.readFile(destination)).toEqual(bytes)
  expect(acceptedType).toBe('application/octet-stream')
})
it('rejects changed bytes and never produces an owner record', async () => {
  await expect(acquireArtifact(url,'0'.repeat(64),path.join(directory,'artifact'),new AbortController().signal)).rejects.toThrow('SHA-256 mismatch')
  await expect(fs.stat(path.join(directory,'installation-record.json'))).rejects.toMatchObject({ code:'ENOENT' })
})
it('rejects cancellation before making a network request', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(acquireArtifact(url,digest,path.join(directory,'artifact'),controller.signal)).rejects.toThrow()
  expect(requests).toBe(0)
})
it('rejects missing artifacts before creating an executable file', async () => {
  await expect(acquireArtifact(url+'/missing',digest,path.join(directory,'artifact'),new AbortController().signal)).rejects.toThrow('HTTP 404')
  expect(await fs.readdir(directory)).toEqual([])
})

for (const stop of ['cancel','timeout','unload'] as const) {
  it.skipIf(!runtimePlatformQualified())(`requires qualified macOS arm64: settles staged acquisition and removes only its generation after ${stop}`, async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const { LocalSubprocessRuntime } = await import('@deepseek-ai/dsh-subprocess-local')
    const { ReachInstaller,installationTarget } = await import('../src/installer.ts')
    const { computeSetupPlan } = await import('../src/setup-plan.ts')
    const ctx = new Context()
    const originalFetch = globalThis.fetch
    let ready!: () => void
    const started = new Promise<void>((resolve)=>{ready=resolve})
    server.removeAllListeners('request')
    server.on('request',(_request,response)=>{response.writeHead(200);response.write('stalled-artifact');ready()})
    globalThis.fetch = (input,init) => {
      expect(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).toBe(installationTarget()?.uv.url)
      return originalFetch(url,init)
    }
    try {
      await ctx.plugin(LocalSubprocessRuntime).await()
      let installer: InstanceType<typeof ReachInstaller> | undefined
      const owner = ctx.plugin({ inject:['subprocess'],apply(scope){installer=new ReachInstaller(scope)} })
      await owner.await()
      const result = computeSetupPlan('v2ex','hot',undefined,{},directory)
      if (!result.ok || !installer) throw new Error('Missing qualified installation fixture')
      const controller = new AbortController()
      const work = installer.install(result.plan,stop === 'timeout' ? 1000 : 10000,controller.signal)
      const rejected = expect(work).rejects.toThrow()
      await started
      if (stop === 'cancel') controller.abort(new Error('Caller cancelled'))
      if (stop === 'unload') await owner.dispose()
      await rejected
      expect(await fs.readdir(result.plan.releaseRoot)).toEqual(['generations'])
      expect(await fs.readdir(path.join(result.plan.releaseRoot,'generations'))).toEqual([])
    } finally {
      globalThis.fetch=originalFetch
      await ctx.fiber.dispose()
    }
  })
}

it('rejects a successful HTTP response with no artifact body', async () => {
  await expect(acquireArtifact(url + '/empty', digest, path.join(directory, 'empty'), new AbortController().signal)).rejects.toThrow('HTTP 204')
  expect(await fs.readdir(directory)).toEqual([])
})
it('rejects an oversized artifact chunk before writing it to the file', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(Buffer.alloc(512 * 1024 * 1024 + 1))
    controller.close()
  } }))
  const destination = path.join(directory, 'oversized')
  try {
    await expect(acquireArtifact(url, digest, destination, new AbortController().signal)).rejects.toThrow('acquisition limit')
    expect((await fs.stat(destination)).size).toBe(0)
    expect(requests).toBe(0)
  } finally { globalThis.fetch = original }
})
