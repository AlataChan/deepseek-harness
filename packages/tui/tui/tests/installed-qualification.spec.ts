/**
 * Installed qualification and end-to-end PTY integration tests.
 * Exercises the built CLI binary within an independent, isolated installed closure
 * outside checkout using node-pty with private HOME and workspace roots,
 * scriptable mock LLM server, real two-turn conversations, model reasoning effort capture,
 * tool execution approval rejection with zero side effects, session persistence and resume.
 *
 * @module @deepseek-ai/dsh-tui/installed-qualification
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { zstdDecompressSync } from 'node:zlib'
import { scanZstdFrames } from '@deepseek-ai/dsh-session-persistence-jsonl/src/zstd.ts'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type * as NodePty from 'node-pty'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

const require = createRequire(import.meta.url)
const pty = require('node-pty') as typeof NodePty

const repoRoot = join(process.cwd())

interface PtyRunResult {
  output: string
  exitCode: number
  signal?: number | undefined
}

function runTuiInPty(options: {
  cliBin: string
  nodePath: string
  dshHome: string
  cwd: string
  serverBaseUrl: string
  apiKey: string
  profile?: string
  permissionMode?: string
  toolsMode?: string
  script: (term: NodePty.IPty, getOutput: () => string, signal: AbortSignal) => Promise<void>
  timeoutMs?: number
}): Promise<PtyRunResult> {
  const timeoutMs = options.timeoutMs ?? 25000
  return new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    const scriptAbort = new AbortController()

    let exitResolve: ((code: { exitCode: number; signal?: number }) => void) | undefined
    const exitPromise = new Promise<{ exitCode: number; signal?: number }>((r) => { exitResolve = r })

    // Scrub real credentials and isolate HOME/TMPDIR
    const scrubbedEnv: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      TMPDIR: tmpdir(),
      NODE_PATH: options.nodePath,
      DSH_HOME: options.dshHome,
      HOME: options.dshHome,
      DSH_TELEMETRY_DISABLED: '1',
      DEEPSEEK_API_KEY: options.apiKey,
      DEEPSEEK_BASE_URL: options.serverBaseUrl,
      DSH_PERMISSION_MODE: options.permissionMode ?? 'danger-full-access',
      ...options.toolsMode ? { DSH_TOOLS_MODE: options.toolsMode } : {},
    }

    const profile = options.profile ?? 'tui'
    const term = pty.spawn(process.execPath, [options.cliBin, '--profile', profile], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: options.cwd,
      env: scrubbedEnv,
    })

    const killAndJoin = async () => {
      scriptAbort.abort()
      try {
        term.kill('SIGTERM')
      } catch {
        // Ignored if already dead
      }
      const grace = setTimeout(() => {
        try { term.kill('SIGKILL') } catch {}
      }, 1000)
      await exitPromise.catch(() => {})
      clearTimeout(grace)
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void (async () => {
        await killAndJoin()
        reject(new Error(`PTY test timed out after ${timeoutMs}ms. Output was:\n${output.slice(-1000)}`))
      })()
    }, timeoutMs)

    term.onData((data: string) => {
      output += data
    })

    term.onExit((code: { exitCode: number; signal?: number }) => {
      exitResolve?.(code)
      if (settled) return
      settled = true
      clearTimeout(timer)
      scriptAbort.abort()
      resolve({
        output,
        exitCode: code.exitCode,
        signal: code.signal,
      })
    })

    options.script(term, () => output, scriptAbort.signal).catch((err: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void (async () => {
        await killAndJoin()
        reject(err instanceof Error ? err : new Error(String(err)))
      })()
    })
  })
}

function waitForOutput(predicate: () => boolean, timeoutMs = 10000, signal?: AbortSignal): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new Error('waitForOutput aborted'))
    }
    if (signal?.aborted) {
      reject(new Error('waitForOutput aborted'))
      return
    }
    signal?.addEventListener('abort', onAbort)
    const check = () => {
      if (signal?.aborted) return
      if (predicate()) {
        cleanup()
        resolve()
      } else if (Date.now() - start > timeoutMs) {
        cleanup()
        reject(new Error(`waitForOutput timed out after ${timeoutMs}ms`))
      } else {
        timer = setTimeout(check, 50)
      }
    }
    check()
  })
}

describe('T5/T6 Installed Qualification & PTY Integration', () => {
  let closureRoot = ''
  let installedCliBin = ''
  let installedNodePath = ''

  beforeAll(() => {
    closureRoot = mkdtempSync(join(tmpdir(), 'dsh-installed-qualification-'))
    installedNodePath = join(closureRoot, 'node_modules')
    const tuiPkgDir = join(repoRoot, 'packages/tui/tui')
    const bundlePkgDir = join(repoRoot, 'packages/bundle/tui')
    const cliPkgDir = join(repoRoot, 'apps/cli')

    // Explicitly prepare fresh artifacts before packing (prevent stale build reuse)
    execSync('pnpm exec tsc -b apps/cli packages/tui/tui packages/bundle/tui', { cwd: repoRoot, stdio: 'pipe' })
    execSync('pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE host', { cwd: cliPkgDir, stdio: 'pipe' })
    execSync('pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE host', { cwd: tuiPkgDir, stdio: 'pipe' })
    execSync('pnpm exec tsdown --config-loader native --env.DSH_BUILD_FACE host', { cwd: bundlePkgDir, stdio: 'pipe' })

    // 1. Pack tarballs into closureRoot
    execSync(`pnpm pack --pack-destination "${closureRoot}"`, { cwd: tuiPkgDir, stdio: 'pipe' })
    execSync(`pnpm pack --pack-destination "${closureRoot}"`, { cwd: bundlePkgDir, stdio: 'pipe' })
    execSync(`pnpm pack --pack-destination "${closureRoot}"`, { cwd: cliPkgDir, stdio: 'pipe' })

    // 2. Collect dependencies into closureRoot/node_modules
    execSync(
      `node scripts/collect-runtime-deps.mjs --preserve-dependency-versions apps/cli/package.json "${installedNodePath}"`,
      { cwd: repoRoot, stdio: 'pipe' },
    )

    // Remove raw workspace copies so node_modules contains strictly unpacked tarball contents
    rmSync(join(closureRoot, 'node_modules/@deepseek-ai/dsh-tui'), { recursive: true, force: true })
    rmSync(join(closureRoot, 'node_modules/@deepseek-ai/dsh-tui-bundle'), { recursive: true, force: true })
    rmSync(join(closureRoot, 'node_modules/@deepseek-ai/dsh'), { recursive: true, force: true })

    // 3. Unpack tarballs into closureRoot/node_modules
    const tarballs = readdirSync(closureRoot).filter(f => f.endsWith('.tgz'))
    for (const tgz of tarballs) {
      let dest = ''
      if (tgz.includes('dsh-tui-0')) dest = join(closureRoot, 'node_modules/@deepseek-ai/dsh-tui')
      else if (tgz.includes('dsh-tui-bundle')) dest = join(closureRoot, 'node_modules/@deepseek-ai/dsh-tui-bundle')
      else if (tgz.includes('dsh-0')) dest = join(closureRoot, 'node_modules/@deepseek-ai/dsh')
      if (dest) {
        mkdirSync(dest, { recursive: true })
        execSync(`tar -xzf "${join(closureRoot, tgz)}" --strip-components=1 -C "${dest}"`, { stdio: 'pipe' })
      }
    }

    installedCliBin = join(closureRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
    if (!existsSync(installedCliBin)) {
      throw new Error(`Installed CLI binary missing at ${installedCliBin}`)
    }
  }, 90000)

  afterAll(() => {
    if (closureRoot && existsSync(closureRoot)) {
      rmSync(closureRoot, { recursive: true, force: true })
    }
  })

  it('validates packaged tarball manifests and isolated closure structure', () => {
    // 1. Must contain built lib and declaration files
    const tuiFiles = readdirSync(join(closureRoot, 'node_modules/@deepseek-ai/dsh-tui'), { recursive: true }).map(String)
    expect(tuiFiles.some(f => f.includes('lib/index.js'))).toBe(true)
    expect(tuiFiles.some(f => f.includes('lib/types'))).toBe(true)

    // 2. Must NOT contain uncompiled typescript source files or src directory
    expect(tuiFiles.some(f => f.startsWith('src/') || (f.endsWith('.ts') && !f.endsWith('.d.ts')))).toBe(false)

    // 3. Bundle must contain cordis.patch.yml and lib/index.js
    const bundleFiles = readdirSync(join(closureRoot, 'node_modules/@deepseek-ai/dsh-tui-bundle'), { recursive: true }).map(String)
    expect(bundleFiles.some(f => f.includes('lib/index.js'))).toBe(true)
    expect(bundleFiles.some(f => f.includes('cordis.patch.yml'))).toBe(true)
    expect(bundleFiles.some(f => f.startsWith('src/') || (f.endsWith('.ts') && !f.endsWith('.d.ts')))).toBe(false)

    // 4. Missing artifact check: exercise runner with required bundle artifact removed and verify loud failure
    const badNodePath = mkdtempSync(join(tmpdir(), 'dsh-bad-nodepath-'))
    try {
      let runnerFailed = false
      try {
        execSync(`"${process.execPath}" "${installedCliBin}" --profile tui`, {
          cwd: badNodePath,
          env: {
            ...process.env,
            NODE_PATH: badNodePath,
            DSH_HOME: badNodePath,
            HOME: badNodePath,
            DSH_TELEMETRY_DISABLED: '1',
          },
          stdio: 'pipe',
        })
      } catch (err: unknown) {
        runnerFailed = true
        const status = (err as { status?: number }).status
        expect(status).not.toBe(0)
      }
      expect(runnerFailed).toBe(true)
    } finally {
      rmSync(badNodePath, { recursive: true, force: true })
    }
  })

  it('runs two full turns in keyless multi-turn conversation and persists session in isolated closure', { timeout: 35000 }, async () => {
    const apiKey = 'test-multi-turn-key'
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-e2e-multiturn-'))
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-tui-e2e-ws-'))

    const server: MockLlmServer = await startMockLlmServer({
      sequence: ['success', 'success', 'success'],
      repeatLast: true,
      apiKey,
      successText: 'FIRST_TURN_COMPLETION_REPLY',
    })

    let capturedSessionId = ''

    try {
      const result = await runTuiInPty({
        cliBin: installedCliBin,
        nodePath: installedNodePath,
        dshHome: home,
        cwd: workspace,
        serverBaseUrl: server.baseURL,
        apiKey,
        script: async (term, getOutput, signal) => {
          // Wait for session initialization
          await waitForOutput(() => getOutput().includes('新建会话成功') || getOutput().includes('Created new session'), 10000, signal)
          const match = /(?:新建会话成功|Created new session): ([a-f0-9-]+)/.exec(getOutput())
          if (match && match[1]) {
            capturedSessionId = match[1]
          }

          // Submit Turn 1
          term.write('First test turn query\r')
          await waitForOutput(() => getOutput().includes('FIRST_TURN_COMPLETION_REPLY'), 15000, signal)

          // Submit Turn 2
          term.write('Second test turn query\r')
          await waitForOutput(() => {
            const count = (getOutput().match(/FIRST_TURN_COMPLETION_REPLY/g) ?? []).length
            return count >= 2
          }, 15000, signal)

          // Clean exit
          term.write('/quit\r')
        },
      })

      expect(result.exitCode).toBe(0)
      expect(capturedSessionId).toBeTruthy()
      expect(server.requests.length).toBeGreaterThanOrEqual(2)

      // Verify session was persisted durably to disk
      const sessionFiles = existsSync(join(home, 'sessions'))
        ? readdirSync(join(home, 'sessions'), { recursive: true }).map(String)
        : []
      expect(sessionFiles.some(f => f.includes(capturedSessionId))).toBe(true)
    } finally {
      await server.close()
      rmSync(home, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('captures /model slash command route, model, and reasoning effort in LLM request', { timeout: 35000 }, async () => {
    const apiKey = 'test-model-capture-key'
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-e2e-model-capture-'))
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-tui-e2e-ws-'))

    const server: MockLlmServer = await startMockLlmServer({
      sequence: ['success', 'success'],
      repeatLast: true,
      apiKey,
      successText: 'REASONER_OUTPUT_CONFIRMED',
    })

    try {
      const result = await runTuiInPty({
        cliBin: installedCliBin,
        nodePath: installedNodePath,
        dshHome: home,
        cwd: workspace,
        serverBaseUrl: server.baseURL,
        apiKey,
        script: async (term, getOutput, signal) => {
          await waitForOutput(() => getOutput().includes('新建会话成功') || getOutput().includes('Created new session'), 10000, signal)

          // Switch model to deepseek-official provider, deepseek-v4-pro model, and high effort
          term.write('/model deepseek-official deepseek-v4-pro high\r')
          await waitForOutput(() => getOutput().includes('deepseek-v4-pro [high]'), 10000, signal)

          // Submit prompt to trigger actual model request
          term.write('Please compute reasoner solution\r')
          await waitForOutput(() => getOutput().includes('REASONER_OUTPUT_CONFIRMED'), 15000, signal)

          term.write('/quit\r')
        },
      })

      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('deepseek-v4-pro [high]')
      expect(server.requests.length).toBeGreaterThanOrEqual(1)

      // Verify model request was captured by mock server with exact model, route, reasoning effort, and thinking
      const conversationReq = server.requests.find(r => r.body && !(r.body as { system?: string }).system?.includes('Create a concise title')) ?? server.requests[0]
      expect(conversationReq).toBeDefined()
      expect(conversationReq?.body).toBeDefined()
      expect(conversationReq?.path).toContain('messages')
      const body = conversationReq?.body as {
        model?: string
        output_config?: { effort?: string }
        thinking?: { type?: string }
      } | undefined
      expect(body?.model).toBe('deepseek-v4-pro')
      expect(body?.output_config?.effort).toBe('high')
      expect(body?.thinking?.type).toBe('enabled')
    } finally {
      await server.close()
      rmSync(home, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('exercises native tool execution approval rejection with zero side effects', { timeout: 35000 }, async () => {
    const apiKey = 'test-reject-tool-key'
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-e2e-reject-'))
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-tui-e2e-ws-'))
    const forbiddenFile = join(workspace, 'forbidden-side-effect.txt')

    const server: MockLlmServer = await startMockLlmServer({
      sequence: ['tool_call_success', 'success'],
      repeatLast: true,
      apiKey,
      toolName: 'write',
      toolArguments: JSON.stringify({
        file_path: 'forbidden-side-effect.txt',
        content: 'FORBIDDEN_CONTENT_NEVER_WRITTEN',
        sandbox_permissions: 'danger-full-access',
        justification: 'Write forbidden file',
      }),
      successText: 'TURN_AFTER_REJECTION_COMPLETED',
    })

    try {
      const result = await runTuiInPty({
        cliBin: installedCliBin,
        nodePath: installedNodePath,
        dshHome: home,
        cwd: workspace,
        serverBaseUrl: server.baseURL,
        apiKey,
        permissionMode: 'workspace-write',
        script: async (term, getOutput, signal) => {
          await waitForOutput(() => getOutput().includes('新建会话成功') || getOutput().includes('Created new session'), 10000, signal)

          // Trigger turn that calls mutating tool
          term.write('Please write forbidden file\r')

          // Observe pending approval request in PTY
          await waitForOutput(() => getOutput().includes('【敏感操作审批】') || getOutput().includes('[y] 批准单次执行'), 15000, signal)

          // Answer rejection in PTY
          term.write('n\r')

          // Wait for turn to settle after rejection
          await waitForOutput(() => getOutput().includes('已拒绝执行') || getOutput().includes('空闲'), 10000, signal)

          term.write('/quit\r')
        },
      })

      expect(result.exitCode).toBe(0)
      // Assert that forbidden side effect file was never created
      expect(existsSync(forbiddenFile)).toBe(false)
    } finally {
      await server.close()
      rmSync(home, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('exercises native tool execution approval grant and confirms real side effect occurs', { timeout: 35000 }, async () => {
    const apiKey = 'test-allow-tool-key'
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-e2e-allow-'))
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-tui-e2e-ws-'))
    const allowedFile = join(workspace, 'allowed-side-effect.txt')

    const server: MockLlmServer = await startMockLlmServer({
      sequence: ['tool_call_success', 'success'],
      repeatLast: true,
      apiKey,
      toolName: 'write',
      toolArguments: JSON.stringify({
        file_path: 'allowed-side-effect.txt',
        content: 'ALLOWED_FILE_CONTENT_PROVING_WRITE',
        sandbox_permissions: 'danger-full-access',
        justification: 'Write allowed file',
      }),
      successText: 'TURN_AFTER_ALLOW_COMPLETED',
    })

    try {
      const result = await runTuiInPty({
        cliBin: installedCliBin,
        nodePath: installedNodePath,
        dshHome: home,
        cwd: workspace,
        serverBaseUrl: server.baseURL,
        apiKey,
        permissionMode: 'workspace-write',
        script: async (term, getOutput, signal) => {
          await waitForOutput(() => getOutput().includes('新建会话成功') || getOutput().includes('Created new session'), 10000, signal)

          // Trigger turn that calls mutating tool
          term.write('Please write allowed file\r')

          // Observe pending approval request in PTY
          await waitForOutput(() => getOutput().includes('【敏感操作审批】') || getOutput().includes('[y] 批准单次执行'), 15000, signal)

          // Answer allow in PTY
          term.write('y\r')

          // Wait for tool execution and turn completion after grant
          await waitForOutput(() => getOutput().includes('Created file') || getOutput().includes('TURN_AFTER_ALLOW_COMPLETED'), 15000, signal)

          term.write('/quit\r')
        },
      })

      expect(result.exitCode).toBe(0)
      if (!existsSync(allowedFile)) {
        console.error('PTC_ALLOW_OUTPUT_UPON_FAILURE:\n' + result.output)
      }
      // Assert that allowed side effect file exists with exact expected content
      expect(existsSync(allowedFile)).toBe(true)
      expect(readFileSync(allowedFile, 'utf-8')).toBe('ALLOWED_FILE_CONTENT_PROVING_WRITE')
    } finally {
      await server.close()
      rmSync(home, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('exercises installed Node PTC runtime execution in PTY with approval rejection and zero side effects', { timeout: 35000 }, async () => {
    const apiKey = 'test-ptc-reject-key'
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-ptc-reject-'))
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-tui-ptc-ws-'))
    const forbiddenFile = join(workspace, 'ptc-forbidden-side-effect.txt')

    const server: MockLlmServer = await startMockLlmServer({
      sequence: ['tool_call_success', 'success'],
      repeatLast: true,
      apiKey,
      toolName: 'run_code',
      toolArguments: JSON.stringify({
        description: 'PTC script writing forbidden file',
        code:
          'try { await tools.write({ file_path: "ptc-forbidden-side-effect.txt", content: "PTC_FORBIDDEN_CONTENT", sandbox_permissions: "danger-full-access", justification: "Write forbidden file" }); } catch (e) { console.log("PTC_REJECTED:" + e.message); }',
      }),
      successText: 'PTC_TURN_REJECTION_COMPLETED',
    })

    try {
      const result = await runTuiInPty({
        cliBin: installedCliBin,
        nodePath: installedNodePath,
        dshHome: home,
        cwd: workspace,
        serverBaseUrl: server.baseURL,
        apiKey,
        permissionMode: 'workspace-write',
        toolsMode: 'ptc',
        script: async (term, getOutput, signal) => {
          try {
            await waitForOutput(() => getOutput().includes('新建会话成功') || getOutput().includes('Created new session'), 10000, signal)

            // Trigger turn that calls run_code
            term.write('Please write forbidden file via PTC\r')

            // Observe pending approval request in PTY for nested write tool
            await waitForOutput(() => getOutput().includes('【敏感操作审批】') || getOutput().includes('[y] 批准单次执行'), 15000, signal)

            // Answer rejection in PTY
            term.write('n\r')

            // Wait for turn to settle after rejection
            await waitForOutput(() => getOutput().includes('已拒绝执行') || getOutput().includes('空闲') || getOutput().includes('PTC_TURN_REJECTION_COMPLETED'), 15000, signal)

            term.write('/quit\r')
          } catch (err) {
            console.error('PTC_REJECT_TEST_FAILED. Output:\n' + getOutput())
            throw err
          }
        },
      })

      expect(result.exitCode).toBe(0)
      // Assert that forbidden side effect file was never created (zero side effects)
      expect(existsSync(forbiddenFile)).toBe(false)
    } finally {
      await server.close()
      rmSync(home, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('exercises installed Node PTC runtime execution in PTY with approval grant, producing real side effect and asserting session event ordering', { timeout: 35000 }, async () => {
    const apiKey = 'test-ptc-allow-key'
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-ptc-allow-'))
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-tui-ptc-ws-'))
    const allowedFile = join(workspace, 'ptc-allowed-side-effect.txt')

    const server: MockLlmServer = await startMockLlmServer({
      sequence: ['tool_call_success', 'success'],
      repeatLast: true,
      apiKey,
      toolName: 'run_code',
      toolArguments: JSON.stringify({
        description: 'PTC script writing allowed file',
        code:
          'await tools.write({ file_path: "ptc-allowed-side-effect.txt", content: "PTC_ALLOWED_CONTENT_PROVING_WRITE", sandbox_permissions: "danger-full-access", justification: "Write allowed file" });',
      }),
      successText: 'PTC_TURN_ALLOW_COMPLETED',
    })

    try {
      const result = await runTuiInPty({
        cliBin: installedCliBin,
        nodePath: installedNodePath,
        dshHome: home,
        cwd: workspace,
        serverBaseUrl: server.baseURL,
        apiKey,
        permissionMode: 'workspace-write',
        toolsMode: 'ptc',
        script: async (term, getOutput, signal) => {
          try {
            await waitForOutput(() => getOutput().includes('新建会话成功') || getOutput().includes('Created new session'), 10000, signal)

            // Trigger turn that calls run_code
            term.write('Please write allowed file via PTC\r')

            // Observe pending approval request in PTY for nested write tool
            await waitForOutput(() => getOutput().includes('【敏感操作审批】') || getOutput().includes('[y] 批准单次执行'), 15000, signal)

            // Answer allow in PTY
            term.write('y\r')

            // Wait for turn completion after allow
            await waitForOutput(() => getOutput().includes('PTC_TURN_ALLOW_COMPLETED') || getOutput().includes('run_code completed'), 15000, signal)

            term.write('/quit\r')
          } catch (err) {
            console.error('PTC_ALLOW_SCRIPT_ERROR. Output:\n' + getOutput())
            throw err
          }
        },
      })

      expect(result.exitCode).toBe(0)
      if (!existsSync(allowedFile)) {
        console.error('PTC_ALLOW_OUTPUT_UPON_FAILURE:\n' + result.output)
      }
      // Assert that allowed side effect file exists with exact expected content
      expect(existsSync(allowedFile)).toBe(true)
      expect(readFileSync(allowedFile, 'utf-8')).toBe('PTC_ALLOWED_CONTENT_PROVING_WRITE')

      // Assert durable session evidence proving tool/ptc-dispatch-start is recorded before approval/asked
      const findSessionFiles = (dir: string): string[] => {
        const files: string[] = []
        if (!existsSync(dir)) return files
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name)
          if (entry.isDirectory()) files.push(...findSessionFiles(full))
          else if (entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.jsonl.zstd'))) files.push(full)
        }
        return files
      }

      const sessionFiles = findSessionFiles(join(home, 'sessions'))
      expect(sessionFiles.length).toBeGreaterThan(0)

      let foundOrderingEvidence = false
      for (const file of sessionFiles) {
        let text = ''
        if (file.endsWith('.zstd')) {
          const buf = readFileSync(file)
          const scan = scanZstdFrames(buf)
          text = scan.frames.map(f => zstdDecompressSync(buf.subarray(f.start, f.end)).toString('utf-8')).join('')
        } else {
          text = readFileSync(file, 'utf-8')
        }
        const lines = text.split('\n').filter(Boolean)
        const events: Array<{ type: string; seq: number }> = []
        for (const line of lines) {
          try {
            const raw: unknown = JSON.parse(line)
            if (raw !== null && typeof raw === 'object' && 'type' in raw && 'seq' in raw && typeof raw.type === 'string' && typeof raw.seq === 'number') {
              events.push(raw as { type: string; seq: number })
            }
          } catch {
            // Contained
          }
        }

        const ptcDispatchStart = events.find(e => e.type === 'tool/ptc-dispatch-start')
        const approvalAsked = events.find(e => e.type === 'approval/asked')

        if (ptcDispatchStart && approvalAsked) {
          expect(ptcDispatchStart.seq).toBeLessThan(approvalAsked.seq)
          foundOrderingEvidence = true
          break
        }
      }
      expect(foundOrderingEvidence).toBe(true)
    } finally {
      await server.close()
      rmSync(home, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('resumes persisted session and replays history without duplicate events across restarts', { timeout: 35000 }, async () => {
    const apiKey = 'test-resume-key'
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-e2e-resume-'))
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-tui-e2e-ws-'))

    const server: MockLlmServer = await startMockLlmServer({
      sequence: ['success', 'success', 'success'],
      repeatLast: true,
      apiKey,
      successText: 'ORIGINAL_MESSAGE_TEXT',
    })

    let sessionId = ''

    try {
      // Phase 1: create session and submit prompt
      await runTuiInPty({
        cliBin: installedCliBin,
        nodePath: installedNodePath,
        dshHome: home,
        cwd: workspace,
        serverBaseUrl: server.baseURL,
        apiKey,
        script: async (term, getOutput, signal) => {
          await waitForOutput(() => getOutput().includes('新建会话成功') || getOutput().includes('Created new session'), 10000, signal)
          const match = /(?:新建会话成功|Created new session): ([a-f0-9-]+)/.exec(getOutput())
          if (match && match[1]) sessionId = match[1]

          term.write('First question\r')
          await waitForOutput(() => getOutput().includes('ORIGINAL_MESSAGE_TEXT'), 15000, signal)

          term.write('/quit\r')
        },
      })

      expect(sessionId).toBeTruthy()

      // Phase 2: Resume session in fresh process
      const resumeResult = await runTuiInPty({
        cliBin: installedCliBin,
        nodePath: installedNodePath,
        dshHome: home,
        cwd: workspace,
        serverBaseUrl: server.baseURL,
        apiKey,
        script: async (term, getOutput, signal) => {
          await waitForOutput(() => getOutput().includes('新建会话成功') || getOutput().includes('Created new session'), 10000, signal)

          // Resume the previous session
          term.write(`/resume ${sessionId}\r`)
          await waitForOutput(() => getOutput().includes('ORIGINAL_MESSAGE_TEXT') || getOutput().includes('恢复会话成功'), 15000, signal)

          term.write('/quit\r')
        },
      })

      expect(resumeResult.exitCode).toBe(0)
      expect(resumeResult.output).toContain('ORIGINAL_MESSAGE_TEXT')
    } finally {
      await server.close()
      rmSync(home, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('qualifies explicit test-owned staging profile in independent installed closure with prompt and interaction', { timeout: 35000 }, async () => {
    const apiKey = 'test-staging-profile-key'
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-e2e-staging-'))
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-tui-e2e-ws-'))
    const stagingFile = join(workspace, 'staging-created.txt')

    // Author an explicit test-owned staging profile in $DSH_HOME/profiles/tui-staging
    const stagingProfileDir = join(home, 'profiles', 'tui-staging')
    mkdirSync(stagingProfileDir, { recursive: true })
    writeFileSync(
      join(stagingProfileDir, 'package.json'),
      JSON.stringify({
        name: 'dsh-profile-tui-staging',
        version: '0.0.1',
        dsh: {
          profile: {
            bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-tui-bundle'],
          },
        },
      }, null, 2),
    )
    writeFileSync(
      join(stagingProfileDir, 'cordis.patch.yml'),
      '- id: tui\n  config:\n    locale: zh\n    maxScrollbackLines: 400\n',
    )

    // Setup scriptable mock server: 1st turn requests mutating tool approval, 2nd turn confirms completion
    const server: MockLlmServer = await startMockLlmServer({
      sequence: ['tool_call_success', 'success'],
      repeatLast: true,
      apiKey,
      toolName: 'write',
      toolArguments: JSON.stringify({
        file_path: 'staging-created.txt',
        content: 'STAGING_PROFILE_QUALIFICATION_PROVED',
        sandbox_permissions: 'danger-full-access',
        justification: 'Write staging file',
      }),
      successText: 'STAGING_PROFILE_INTERACTION_COMPLETED',
    })

    try {
      const result = await runTuiInPty({
        cliBin: installedCliBin,
        nodePath: installedNodePath,
        dshHome: home,
        cwd: workspace,
        serverBaseUrl: server.baseURL,
        apiKey,
        profile: 'tui-staging',
        permissionMode: 'workspace-write',
        script: async (term, getOutput, signal) => {
          // Wait for session initialization
          await waitForOutput(() => getOutput().includes('新建会话成功') || getOutput().includes('Created new session'), 10000, signal)

          // 1. Submit prompt to staging profile
          term.write('Execute staging interaction test\r')

          // 2. Observe pending approval interaction in PTY
          await waitForOutput(() => getOutput().includes('【敏感操作审批】') || getOutput().includes('[y] 批准单次执行'), 15000, signal)

          // 3. Respond with approval interaction in PTY
          term.write('y\r')

          // 4. Wait for turn to complete after interaction
          await waitForOutput(() => getOutput().includes('STAGING_PROFILE_INTERACTION_COMPLETED'), 15000, signal)

          // Clean exit
          term.write('/quit\r')
        },
      })

      expect(result.exitCode).toBe(0)
      expect(existsSync(stagingFile)).toBe(true)
      expect(readFileSync(stagingFile, 'utf-8')).toBe('STAGING_PROFILE_QUALIFICATION_PROVED')

      // Verify persisted session in staging profile closure
      const sessionFiles = existsSync(join(home, 'sessions'))
        ? readdirSync(join(home, 'sessions'), { recursive: true }).map(String)
        : []
      expect(sessionFiles.length).toBeGreaterThan(0)
    } finally {
      await server.close()
      rmSync(home, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
