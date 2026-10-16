/**
 * Spawn the ask-knowledge Python sidecar with JSON stdin/stdout.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/sidecar
 */

import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { existsSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { validateFileResult } from './document-jobs.ts'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import { resolveSidecarHome, type AskKnowledgeHomeConfig } from './knowledge-home.ts'

/** One sidecar request. */
export interface SidecarRequest {
  readonly command: string
  readonly [key: string]: unknown
}

/** Successful or failed sidecar JSON. */
export interface SidecarResponse {
  readonly ok: boolean
  readonly error?: string
  readonly [key: string]: unknown
}

/** Spawn options for one sidecar call. */
export interface SidecarRunOptions {
  /** Extra environment entries for this child only. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
  /** Caller lifetime. */
  readonly signal?: AbortSignal | undefined
  /** Kill after this many milliseconds. */
  readonly timeoutMs?: number | undefined
}

const PACKAGE_PYTHON = resolve(fileURLToPath(new URL('../python/sidecar.py', import.meta.url)))

function isExecutableFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve the sidecar executable. Prefers a PyInstaller binary in the runtime
 * home; tests may install a script named `octopus-kb-sidecar`.
 * @param home - resolved sidecar runtime directory.
 * @returns absolute executable path.
 */
export function resolveSidecarExecutable(home: string): string {
  /* v8 ignore next -- Windows lane covers the .exe candidate */
  const names = process.platform === 'win32'
    ? ['octopus-kb-sidecar.exe', 'octopus-kb-sidecar']
    : ['octopus-kb-sidecar']
  for (const name of names) {
    const candidate = join(home, name)
    if (isExecutableFile(candidate)) return candidate
    const nested = join(home, name, name)
    if (isExecutableFile(nested)) return nested
  }
  throw new AskKnowledgeError(
    'sidecar-home-missing',
    `octopus-kb-sidecar is missing under ${home}`,
  )
}

/**
 * Absolute octopus-kb resource root (`prompts/` / `schemas/`).
 * @param home - sidecar runtime directory.
 * @returns directory that contains `prompts/propose.md` when present.
 */
export function resolveKbRoot(home: string): string {
  const configured = process.env.OCTOPUS_KB_ROOT?.trim() ?? ''
  if (configured !== '' && isAbsolute(configured)) return resolve(configured)
  if (existsSync(join(home, 'prompts', 'propose.md'))) return home
  const vendored = resolve(fileURLToPath(new URL('../python/kb', import.meta.url)))
  /* v8 ignore start -- the package vendors prompts/propose.md */
  if (existsSync(join(vendored, 'prompts', 'propose.md'))) return vendored
  return home
  /* v8 ignore stop */
}

/**
 * Run one sidecar command. Companion `DEEPSEEK_API_KEY` is omitted unless
 * `options.env` sets it explicitly.
 * @param config - plugin config used to resolve the runtime home.
 * @param request - JSON command.
 * @param options - env overlay, signal, timeout.
 * @returns parsed JSON response.
 */
export async function runSidecar(
  config: AskKnowledgeHomeConfig,
  request: SidecarRequest,
  options: SidecarRunOptions = {},
): Promise<SidecarResponse> {
  const home = resolveSidecarHome(config)
  const executable = resolveSidecarExecutable(home)
  const kbRoot = resolveKbRoot(home)
  const resultDir = ['convert-document', 'convert-file'].includes(request.command) ? await mkdtemp(join(tmpdir(), 'dsh-convert-result-')) : undefined
  const resultPath = resultDir ? join(resultDir, 'result.json') : undefined
  try {
    const response = await withKnowledgeProcessRunner(config, async (runner) => {
      let result: KnowledgeProcessResult
      try {
        result = await runner.run({
          argv: [executable],
          cwd: home,
          input: `${JSON.stringify(resultPath ? { ...request, resultPath } : request)}\n`,
          env: { OCTOPUS_KB_ROOT: kbRoot, ...options.env },
          signal: options.signal,
          timeoutMs: options.timeoutMs,
        })
      } catch (error) {
        if (error instanceof KnowledgeProcessExitError) {
          let failure: unknown
          try { failure = JSON.parse(error.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '') }
          catch (_invalidSidecarErrorJson) { throw error }
          if (typeof failure === 'object' && failure !== null && 'ok' in failure && failure.ok === false &&
            'error' in failure && typeof failure.error === 'string') {
            throw new AskKnowledgeError('ingest-failed', failure.error)
          }
        }
        throw error
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(result.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '')
      } catch (error) {
        throw new AskKnowledgeError('ingest-failed', `sidecar stdout is not JSON: ${String(error)}`)
      }
      if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed) || parsed.ok !== true) {
        const detail = typeof parsed === 'object' && parsed !== null && 'error' in parsed
          ? String(parsed.error) : 'sidecar failed'
        throw new AskKnowledgeError('ingest-failed', detail)
      }
      if (resultDir && resultPath && ('protocol' in parsed || request.command === 'convert-document')) {
        if (!('protocol' in parsed) || parsed.protocol !== 'file-result-v1' || !('resultPath' in parsed) || parsed.resultPath !== resultPath ||
          !('sha256' in parsed) || typeof parsed.sha256 !== 'string') {
          throw new AskKnowledgeError('ingest-failed', 'conversion did not produce an authorized file result')
        }
        const data = await validateFileResult(resultDir, resultPath, parsed.sha256)
        if (data.ok !== true) throw new AskKnowledgeError('ingest-failed', String(data.error ?? 'conversion failed'))
        return data as SidecarResponse
      }
      return parsed as SidecarResponse
    })
    return response
  } finally {
    if (resultDir) await rm(resultDir, { recursive: true, force: true })
  }
}

/**
 * Absolute path of the vendored `sidecar.py`, exported so tests can wrap it.
 * @internal
 */
export const sidecarScriptPath = PACKAGE_PYTHON

/**
 * Directory that contains `sidecar.py` in this package.
 * @returns absolute python/ directory.
 */
export function packagePythonDir(): string {
  return dirname(PACKAGE_PYTHON)
}

/** Fully resolved batch invocation owned by the knowledge service. */
export interface KnowledgeProcessRequest {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly input?: string | undefined
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
  readonly signal?: AbortSignal | undefined
  readonly timeoutMs?: number | undefined
  readonly jobId?: string | undefined
}

/** Output collected only after the provider-managed range has settled. */
export interface KnowledgeProcessResult {
  readonly stdout: string
  readonly stderr: string
}

/** Nonzero process exit retains bounded protocol output for the sidecar parser. */
class KnowledgeProcessExitError extends AskKnowledgeError {
  constructor(readonly exitCode: number | null, readonly stdout: string, readonly stderr: string) {
    super('ingest-failed', `knowledge child exited ${exitCode}: ${stderr || stdout}`)
  }
}

/** Owns conversion/job children through the mounted subprocess provider. */
export class KnowledgeProcessRunner {
  private readonly active = new Map<SubprocessHandle, string | undefined>()
  private disposed = false
  private readonly cancelled = new Set<SubprocessHandle>()

  private readonly runtime: Promise<SubprocessRuntime>
  private readonly localContext: Context | undefined

  constructor(subprocess?: SubprocessRuntime) {
    if (subprocess) {
      this.runtime = Promise.resolve(subprocess)
    } else {
      const ctx = new Context()
      this.localContext = ctx
      this.runtime = Promise.resolve(ctx.plugin(LocalSubprocessRuntime)).then(() => {
        const provider = ctx.get('subprocess')
        if (!provider) throw new AskKnowledgeError('ingest-failed', 'local subprocess provider failed to initialize')
        return provider
      })
    }
  }

  /**
   * Execute a bounded batch and await managed-range settlement on every path.
   * @param request - exact argv, lifetime, input and deliberate environment.
   * @returns complete bounded stdout and diagnostics; truncation fails visibly.
   */
  async run(request: KnowledgeProcessRequest): Promise<KnowledgeProcessResult> {
    if (this.disposed) throw new AskKnowledgeError('ingest-failed', 'knowledge service is disposed')
    if (request.signal?.aborted) throw new AskKnowledgeError('ingest-failed', 'knowledge child was aborted')
    const deadline = AbortSignal.timeout(request.timeoutMs ?? 90_000)
    const signal = request.signal ? AbortSignal.any([request.signal, deadline]) : deadline
    // Tombstones prevent the provider's safe ambient base from forwarding proxies,
    // loader hooks or user configuration. Credentials require deliberate request.env.
    const env: NodeJS.ProcessEnv = Object.fromEntries(Object.keys(process.env).map(key => [key, undefined]))
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'LANG']) {
      if (process.env[key] !== undefined) env[key] = process.env[key]
    }
    Object.assign(env, request.env)
    const subprocess = await this.runtime
    if (this.disposed) throw new AskKnowledgeError('ingest-failed', 'knowledge service is disposed')
    if (signal.aborted) throw new AskKnowledgeError('ingest-failed', 'knowledge child was aborted or timed out')
    const handle = subprocess.spawn({
      argv: request.argv,
      cwd: request.cwd,
      stdio: {
        stdin: request.input === undefined ? 'ignore' : { data: request.input },
        stdout: { maxBytes: 2 * 1024 * 1024 },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 500,
      env,
      signal,
    })
    this.active.set(handle, request.jobId)
    try {
      const outcome = await handle.done
      // A child must not leave descendants running after writing its result.
      handle.terminate()
      await handle.waitForExit()
      if (signal.aborted) throw new AskKnowledgeError('ingest-failed', 'knowledge child was aborted or timed out')
      if (this.disposed || this.cancelled.has(handle)) throw new AskKnowledgeError('ingest-failed', 'knowledge child was cancelled')
      const stdout = handle.collected.stdout?.readFrom(0)
      const stderr = handle.collected.stderr?.readFrom(0)
      if (outcome.exitCode !== 0) {
        throw new KnowledgeProcessExitError(outcome.exitCode, stdout?.text ?? '', stderr?.text ?? '')
      }
      if (stdout?.lossy) throw new AskKnowledgeError('ingest-failed', 'knowledge child response exceeded collection limit; use file results')
      return { stdout: stdout?.text ?? '', stderr: stderr?.text ?? '' }
    } catch (error) {
      if (signal.aborted) throw new AskKnowledgeError('ingest-failed', deadline.aborted ? 'knowledge child timed out' : 'knowledge child was aborted')
      throw error
    } finally {
      handle.terminate()
      await handle.waitForExit()
      this.active.delete(handle)
      this.cancelled.delete(handle)
    }
  }

  /**
   * Stop and join all currently executing children of one tracked job.
   * @param jobId - durable job identity.
   */
  async cancelJob(jobId: string): Promise<void> {
    const handles = [...this.active].filter(([, id]) => id === jobId).map(([handle]) => handle)
    for (const handle of handles) { this.cancelled.add(handle); handle.terminate() }
    await Promise.all(handles.map(handle => handle.waitForExit()))
  }

  /** Reject new work and join every active provider-managed range. */
  async dispose(): Promise<void> {
    this.disposed = true
    const handles = [...this.active.keys()]
    for (const handle of handles) { this.cancelled.add(handle); handle.terminate() }
    await Promise.all(handles.map(handle => handle.waitForExit()))
    await this.runtime
    await this.localContext?.fiber.dispose()
  }
}

/**
 * Use the production service owner or an isolated, per-call local owner in utilities.
 * @param config - runtime capability injected by the knowledge service.
 * @param operation - operation that must settle before its owner is disposed.
 * @returns operation result.
 */
export async function withKnowledgeProcessRunner<T>(
  config: AskKnowledgeHomeConfig,
  operation: (runner: KnowledgeProcessRunner) => Promise<T>,
): Promise<T> {
  if (config.processRunner) return await operation(config.processRunner)
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  const runner = new KnowledgeProcessRunner(ctx.get('subprocess'))
  try {
    return await operation(runner)
  } finally {
    await runner.dispose()
    await ctx.fiber.dispose()
  }
}
