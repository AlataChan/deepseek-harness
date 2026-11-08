/** Owned transient execution with bounded output and observed process-range teardown. */
import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { scrubbedParentEnv, type SubprocessHandle, type SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { AgentReachError } from './types.ts'
import { scrubText } from './result.ts'

/** Bounded command completion; raw stdout stays private to the decoder. */
export interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  error?: AgentReachError
}

/** Command limits owned by the caller. */
export interface CommandLimits {
  timeoutMs: number
  maxStdoutBytes: number
  maxStderrBytes: number
  signal?: AbortSignal | undefined
}

/** Process ranges belonging to one plugin fiber, including short-lived installer commands. */
export class OwnedCommands {
  private closed = false
  private readonly active = new Set<SubprocessHandle>()

  constructor(private readonly ctx: Context) {
    ctx.effect(() => async () => {
      this.closed = true
      const handles = [...this.active]
      for (const handle of handles) handle.terminate()
      await Promise.all(handles.map(async (handle) => {
        await handle.done
        if (!await handle.waitForExit()) throw new Error('Agent-Reach range did not settle on unload')
      }))
    }, 'agent-reach: owned commands')
  }

  private wasUnloaded(): boolean { return this.closed }

  /**
   * Run one transient range; direct-child exit also retires remaining descendants.
   * @param spec - Fully resolved process specification.
   * @param limits - Output, deadline and caller cancellation limits.
   * @returns Observed command and cleanup result.
   */
  async run(spec: SubprocessSpawnSpec, limits: CommandLimits): Promise<CommandResult> {
    const failure = (code: string, message: string): CommandResult => ({
      ok: false, stdout: '', stderr: '', exitCode: null, error: { code, message: scrubText(message) },
    })
    if (this.wasUnloaded() || limits.signal?.aborted) return failure('EXECUTION_CANCELLED', 'Execution cancelled before start')
    const abort = new AbortController()
    const state = { timedOut:false,overflow:false }
    const timer = setTimeout(() => {
      state.timedOut = true
      abort.abort()
    }, limits.timeoutMs)
    const cancel = (): void => { abort.abort(limits.signal?.reason) }
    limits.signal?.addEventListener('abort', cancel, { once: true })
    let handle: SubprocessHandle | undefined
    const cleanups: Array<() => void> = []
    let stdout = ''
    let stderr = ''
    const read = (stream: Readable | undefined, cap: number, strict: boolean, write: (text: string) => void): Promise<void> => {
      if (!stream) return Promise.resolve()
      return new Promise((resolve, reject) => {
        const decoder = new StringDecoder('utf8')
        let bytes = 0
        const data = (chunk: Buffer | string): void => {
          const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
          if (strict && bytes + buffer.length > cap) {
            state.overflow = true
            abort.abort()
            reject(new Error('Output exceeds byte limit'))
            return
          }
          const part = buffer.subarray(0, Math.max(0, cap - bytes))
          bytes += part.length
          write(decoder.write(part))
        }
        const end = (): void => { write(decoder.end()); resolve() }
        const error = (err: Error): void => { reject(err) }
        stream.on('data', data)
        stream.once('end', end)
        stream.once('close', end)
        stream.once('error', error)
        cleanups.push(() => {
          stream.off('data', data).off('end', end).off('close', end).off('error', error)
        })
      })
    }
    try {
      handle = this.ctx.subprocess.spawn({ ...spec, signal: abort.signal })
      this.active.add(handle)
      const owned = handle
      const exit = owned.done.then(async (outcome) => {
        // A query never owns a persistent/shared browser; those routes remain unsupported.
        owned.terminate()
        if (!await owned.waitForExit()) throw new Error('Process range did not settle')
        return outcome
      })
      const [outcome] = await Promise.all([
        exit,
        read(owned.stdout, limits.maxStdoutBytes, true, (text) => { stdout += text }),
        read(owned.stderr, limits.maxStderrBytes, false, (text) => { stderr += text }),
      ])
      if (state.timedOut) return failure('TIMEOUT', 'Agent-Reach command exceeded its deadline')
      if (this.wasUnloaded() || abort.signal.aborted) return failure('EXECUTION_CANCELLED', 'Agent-Reach command was cancelled')
      return { ok: outcome.exitCode === 0, stdout, stderr: scrubText(stderr), exitCode: outcome.exitCode }
    } catch (err) {
      if (handle) {
        handle.terminate()
        try {
          await handle.done
          if (!await handle.waitForExit()) return failure('QUIESCENCE_FAILED', 'Process range remains active')
        } catch (cleanupError) {
          return failure('QUIESCENCE_FAILED', String(cleanupError))
        }
      }
      if (state.overflow) return failure('OVERSIZED_OUTPUT', 'Agent-Reach stdout exceeded its byte limit')
      if (state.timedOut) return failure('TIMEOUT', 'Agent-Reach command exceeded its deadline')
      if (this.wasUnloaded() || abort.signal.aborted) return failure('EXECUTION_CANCELLED', 'Agent-Reach command was cancelled')
      return failure('EXECUTION_FAILED', String(err))
    } finally {
      clearTimeout(timer)
      limits.signal?.removeEventListener('abort', cancel)
      for (const cleanup of cleanups) cleanup()
      if (handle) this.active.delete(handle)
    }
  }
}

/**
 * Preserve transport and home settings without borrowing Python import or venv overrides.
 * @returns Fresh child environment for qualified Python commands.
 */
export function reachEnvironment(): Record<string,string> {
  const env = scrubbedParentEnv()
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith('PYTHON') || key.toUpperCase() === 'VIRTUAL_ENV') Reflect.deleteProperty(env,key)
  }
  env.PYTHONNOUSERSITE = '1'
  env.PYTHONIOENCODING = 'utf-8'
  env.PYTHONUNBUFFERED = '1'
  env.REACH_API_SUPERVISED = '1'
  return env
}
