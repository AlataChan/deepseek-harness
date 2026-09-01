/**
 * Spawn the ask-knowledge Python sidecar with JSON stdin/stdout.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/sidecar
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
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
  const merged: NodeJS.ProcessEnv = { ...process.env, OCTOPUS_KB_ROOT: kbRoot }
  delete merged.DEEPSEEK_API_KEY
  const childEnv = Object.fromEntries(
    Object.entries({ ...merged, ...options.env }).filter((entry): entry is [string, string] => (
      entry[1] !== undefined
    )),
  )
  /* v8 ignore start -- tests and the bundle install a named executable, not sidecar.py */
  const args = executable.endsWith('.py') ? [executable] : []
  const command = executable.endsWith('.py') ? (process.env.ASK_KNOWLEDGE_PYTHON ?? 'python3') : executable
  /* v8 ignore stop */
  return await new Promise<SidecarResponse>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false
    const finish = (error: Error | undefined, value?: SidecarResponse) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', onAbort)
      if (timer !== undefined) clearTimeout(timer)
      if (error !== undefined) reject(error)
      else if (value === undefined) {
        reject(new AskKnowledgeError('ingest-failed', 'sidecar finished without a response'))
      } else resolvePromise(value)
    }
    const onAbort = () => {
      child.kill('SIGTERM')
      finish(new AskKnowledgeError('ingest-failed', 'sidecar was aborted'))
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
        child.kill('SIGTERM')
        finish(new AskKnowledgeError('ingest-failed', 'sidecar timed out'))
      }, options.timeoutMs)
    child.stdout.on('data', (chunk) => { stdout.push(chunk as Buffer) })
    child.stderr.on('data', (chunk) => { stderr.push(chunk as Buffer) })
    /* v8 ignore next 3 -- spawn fails only when the resolved executable vanishes */
    child.on('error', (error) => {
      finish(new AskKnowledgeError('sidecar-home-missing', error.message))
    })
    child.on('close', (code) => {
      const text = Buffer.concat(stdout).toString('utf8').trim()
      if (text === '') {
        finish(new AskKnowledgeError(
          'ingest-failed',
          `sidecar exited ${code ?? 'null'} without JSON`,
        ))
        return
      }
      let parsed: unknown
      const lastLine = text.split('\n').filter(Boolean).at(-1)
      if (lastLine === undefined) {
        finish(new AskKnowledgeError('ingest-failed', 'sidecar stdout is not JSON'))
        return
      }
      try {
        parsed = JSON.parse(lastLine)
      } catch {
        finish(new AskKnowledgeError('ingest-failed', 'sidecar stdout is not JSON'))
        return
      }
      if (typeof parsed !== 'object' || parsed === null) {
        finish(new AskKnowledgeError('ingest-failed', 'sidecar JSON is not an object'))
        return
      }
      const response = parsed as SidecarResponse
      if (response.ok !== true) {
        finish(new AskKnowledgeError(
          'ingest-failed',
          typeof response.error === 'string' ? response.error : 'sidecar failed',
        ))
        return
      }
      finish(undefined, response)
    })
    child.stdin.write(`${JSON.stringify(request)}\n`)
    child.stdin.end()
  })
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
