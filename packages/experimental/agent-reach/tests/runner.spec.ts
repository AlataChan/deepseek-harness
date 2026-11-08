import { runtimePlatformQualified } from '../src/runtime-lock.ts'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentReachRunner, checkShadowedTools } from '../src/runner.ts'

describe.skipIf(!runtimePlatformQualified())('requires qualified macOS arm64: AgentReachRunner Unit and Subprocess Behavior', () => {
  let ctx: Context
  let tempDir: string

  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime)
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-reach-runner-test-'))
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns NEED_SETUP when executable is absent without spawning any process', async () => {
    let spawnCalled = false
    const origSpawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    ctx.subprocess.spawn = (spec) => {
      spawnCalled = true
      return origSpawn(spec)
    }

    const runner = new AgentReachRunner(ctx, {}, { dshHome: tempDir })
    const res = await runner.query({
      channel: 'bilibili',
      action: 'read',
      params: { target: 'BV1GJ411x7h7' },
    })

    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('NEED_SETUP')
    expect(spawnCalled).toBe(false)
  })

  it('pre-validates routes and blocks forbidden effectful routes with zero spawn calls', async () => {
    let spawnCalled = false
    const origSpawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    ctx.subprocess.spawn = (spec) => {
      spawnCalled = true
      return origSpawn(spec)
    }

    const runner = new AgentReachRunner(
      ctx,
      {
        enabledChannels: ['bilibili'],
        sessionAccessRoutes: [], // empty -> subtitle forbidden
      },
      { dshHome: tempDir },
    )

    const res = await runner.query({
      channel: 'bilibili',
      action: 'subtitle',
      params: { target: 'BV1GJ411x7h7' },
    })

    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('SESSION_ROUTE_FORBIDDEN')
    expect(spawnCalled).toBe(false)
  })

  it('detects shadowing tool collision using upstream tool command names (bili) without modifying user files', () => {
    const fakeHome = path.join(tempDir, 'user-home')
    const toolsDir = path.join(fakeHome, '.agent-reach', 'tools')
    fs.mkdirSync(toolsDir, { recursive: true })
    const fakeBili = path.join(toolsDir, 'bili')
    fs.writeFileSync(fakeBili, '#!/bin/sh\necho shadowing\n')

    const check = checkShadowedTools(['bili-cli'], fakeHome)
    expect(check.found).toBe(true)
    expect(check.isShadowedConflict).toBe(true)
    if (!check.found) throw new Error('Expected a conflicting executable')
    expect(check.shadowPath).toBe(fakeBili)
    expect(fs.existsSync(fakeBili)).toBe(true) // file remains untouched
  })

  it('fails closed when shadowing tool inspection directory cannot be read', () => {
    const fakeFileAsDir = path.join(tempDir, 'unreadable-home')
    fs.mkdirSync(fakeFileAsDir)
    const blockedTools = path.join(fakeFileAsDir, '.agent-reach')
    // Create a regular file where a directory is expected, or unreadable permissions
    fs.writeFileSync(blockedTools, 'not a dir')

    const check = checkShadowedTools(['bili-cli'], fakeFileAsDir)
    expect(check.inspectionError).toBe(true)
  })

  it('enforces maxConcurrentQueries and returns BUSY on overflow', async () => {
    const runner = new AgentReachRunner(
      ctx,
      { maxConcurrentQueries: 0 },
      { dshHome: tempDir },
    )

    const res = await runner.query({
      channel: 'bilibili',
      action: 'read',
      params: { target: 'BV1GJ411x7h7' },
    })

    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('BUSY')
  })

  it('terminates execution and returns OVERSIZED_OUTPUT when output exceeds maxStdoutBytes', async () => {
    const mockBin = path.join(tempDir, 'mock-agent-reach')
    const scriptContent = process.platform === 'win32'
      ? '@echo off\r\nfor /L %%i in (1,1,1000) do echo AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\r\n'
      : '#!/bin/sh\nwhile true; do echo "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; done\n'
    fs.writeFileSync(mockBin, scriptContent, { mode: 0o755 })

    const runner = new AgentReachRunner(
      ctx,
      {
        runtimeOverride: mockBin,
        maxStdoutBytes: 100,
        queryTimeoutMs: 5000,
      },
      { dshHome: tempDir },
    )

    const spawnRes = await runner.spawnCli(['channels'])
    expect(spawnRes.ok).toBe(false)
    expect(spawnRes.error?.code).toBe('OVERSIZED_OUTPUT')
  })

  it('parses valid upstream error envelope and scrubs credentials in diagnostics', async () => {
    const mockBin = path.join(tempDir, 'mock-agent-reach-error')
    const errorJson = JSON.stringify({
      schema_version: 1,
      ok: false,
      channel: 'bilibili',
      action: 'subtitle',
      error: {
        code: 'NEED_LOGIN',
        message: 'Bilibili is not logged in',
        hint: 'Please login with token=secret123 and SESSDATA=abcde',
      },
    })

    const scriptContent = process.platform === 'win32'
      ? `@echo off\r\necho ${errorJson.replace(/"/g, '\"')}\r\nexit /b 1\r\n`
      : `#!/bin/sh\necho '${errorJson}'\nexit 1\n`
    fs.writeFileSync(mockBin, scriptContent, { mode: 0o755 })

    const runner = new AgentReachRunner(
      ctx,
      {
        runtimeOverride: mockBin,
        enabledChannels: ['bilibili'],
        sessionAccessRoutes: ['bilibili/subtitle/bili-cli'],
      },
      { dshHome: tempDir },
    )

    const res = await runner.query({
      channel: 'bilibili',
      action: 'subtitle',
      params: { target: 'BV1GJ411x7h7' },
    })

    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('NEED_LOGIN')
    expect(res.error?.message).toBe('Bilibili is not logged in')
    expect(res.error?.hint).not.toContain('secret123')
    expect(res.error?.hint).not.toContain('abcde')
    expect(res.error?.hint).toContain('[REDACTED]')
  })

  it('rejects a success envelope with nonzero exit code as ADAPTER_ERROR', async () => {
    const mockBin = path.join(tempDir, 'mock-agent-reach-bad-exit')
    const okJson = JSON.stringify({
      schema_version: 1,
      ok: true,
      channel: 'bilibili',
      action: 'read',
      items: [{ title: 'Valid Video' }],
      meta: { elapsed_ms: 10, attempts: [] },
    })

    const scriptContent = process.platform === 'win32'
      ? `@echo off\r\necho ${okJson.replace(/"/g, '\"')}\r\nexit /b 1\r\n`
      : `#!/bin/sh\necho '${okJson}'\nexit 1\n`
    fs.writeFileSync(mockBin, scriptContent, { mode: 0o755 })

    const runner = new AgentReachRunner(
      ctx,
      {
        runtimeOverride: mockBin,
        enabledChannels: ['bilibili'],
      },
      { dshHome: tempDir },
    )

    const res = await runner.query({
      channel: 'bilibili',
      action: 'read',
      params: { target: 'BV1GJ411x7h7' },
    })

    expect(res.ok).toBe(false)
    expect(res.error?.code).toBe('ADAPTER_ERROR')
    expect(res.error?.message).toContain('Command exited with status 1 but returned ok:true envelope')
  })
})

it.skipIf(process.platform !== 'darwin' || process.arch !== 'arm64')('releases a real query slot after cancellation while rejecting a second caller',async()=>{
  const ctx=new Context()
  await ctx.plugin(LocalSubprocessRuntime).await()
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'reach-concurrent-'))
  try {
    const ready=path.join(directory,'ready')
    const executable=path.join(directory,'fixture.mjs')
    const output={ schema_version:1,ok:true,channel:'v2ex',action:'hot',items:[{ url:'https://example.com/topic',text:'Public fixture' }],meta:{ elapsed_ms:1,attempts:[] } }
    fs.writeFileSync(executable,`#!${process.execPath}\nimport fs from 'node:fs';\nif(fs.existsSync(${JSON.stringify(ready)})){console.log(${JSON.stringify(JSON.stringify(output))})}else{fs.writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000)}\n`,{ mode:0o700 })
    const runner=new AgentReachRunner(ctx,{ runtimeOverride:executable,maxConcurrentQueries:1,queryTimeoutMs:10000,terminateGraceMs:100 })
    const cancel=new AbortController()
    let markReady: () => void = () => { throw new Error('Readiness observer not initialized') }
    const started = new Promise<void>((resolve) => { markReady = resolve })
    const watcher = fs.watch(directory, (_event, filename) => {
      if (filename === 'ready' && fs.existsSync(ready)) markReady()
    })
    const first=runner.query({ channel:'v2ex',action:'hot',signal:cancel.signal })
    try {
      await Promise.race([started, first.then((result) => { throw new Error(`Query ended before readiness: ${JSON.stringify(result)}`) })])
      expect(fs.existsSync(ready)).toBe(true)
    } finally { watcher.close() }
    expect((await runner.query({ channel:'v2ex',action:'hot' })).error?.code).toBe('BUSY')
    cancel.abort()
    expect((await first).error?.code).toBe('EXECUTION_CANCELLED')
    const next=await runner.query({ channel:'v2ex',action:'hot' })
    expect(next.ok).toBe(true)
    expect(next.items[0]?.url).toBe('https://example.com/topic')
  }finally{await ctx.fiber.dispose();fs.rmSync(directory,{ recursive:true,force:true })}
})
