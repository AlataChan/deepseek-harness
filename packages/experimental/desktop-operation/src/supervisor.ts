/**
 * Stdio owner for one shared desktop MCP process.
 * It holds the flock, passes that descriptor to the child on fd 3, and closes
 * the descriptor only after the child has exited.
 * @module @deepseek-ai/dsh-experimental-desktop-operation/supervisor
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { acquireDesktopLease, DesktopLeaseBusyError, DesktopLeaseUnstableError, SHARED_DESKTOP_LEASE_HELD } from './lease.ts'
import type { DesktopLease } from './lease.ts'
import { isDesktopOperationPlatform } from './platform.ts'

/** How the child inherits the supervisor's standard streams. */
export type SupervisorStdio = 'inherit' | 'ignore'

/** One supervisor launch. */
export interface SupervisorOptions {
  /** Host platform. The CLI passes `process.platform`. */
  readonly platform: NodeJS.Platform
  /** Host architecture. The CLI passes `process.arch`. */
  readonly arch: string
  /** Absolute `AGENT_DESKTOP_HOME`. A relative value exits before the lock. */
  readonly home: string
  /** Absolute lock file. */
  readonly lockPath: string
  /** Executable to spawn after the lock is held. */
  readonly binary: string
  /** Helper path forwarded as `AGENT_DESKTOP_MACOS_HELPER_PATH`. */
  readonly helper: string
  /** Arguments after `--`. Production uses `['mcp']`. */
  readonly args: readonly string[]
  /** Child standard streams. The CLI inherits them. */
  readonly stdio?: SupervisorStdio
  /** When false, hold the lock and wait for {@link SupervisorRun.stop} without spawning. */
  readonly spawn?: boolean
  /** When true, SIGTERM and SIGINT stop the child and then release the lock. */
  readonly signals?: boolean
  /** Writer for the busy line. The CLI uses stderr. */
  readonly stderr?: { write(chunk: string): void }
}

/** A supervisor that has passed the platform and lock checks, or already finished. */
export interface SupervisorRun {
  /** Resolves with the process exit code once the descriptor is closed. */
  readonly exited: Promise<number>
  /**
   * Pid of the spawned child.
   * @returns the pid, or undefined before spawn and when spawn was skipped.
   */
  childPid(): number | undefined
  /**
   * Stop before spawn, or signal the child and wait until the lock is released.
   * @returns when the descriptor is closed.
   */
  stop(): Promise<void>
}

/**
 * Take the shared-desktop lease and spawn `binary`, or return a finished run.
 * @param options - platform, home, lock, and child command.
 * @returns the live run. Unsupported platforms and a held lock do not spawn.
 */
export async function startSupervisor(options: SupervisorOptions): Promise<SupervisorRun> {
  if (!isDesktopOperationPlatform(options.platform, options.arch)) return settled(0)
  if (!isAbsolute(options.home)) return settled(1)
  let lease: DesktopLease
  try {
    lease = await acquireDesktopLease(options.lockPath)
  } catch (error: unknown) {
    if (error instanceof DesktopLeaseBusyError) {
      ;(options.stderr ?? process.stderr).write(`${SHARED_DESKTOP_LEASE_HELD}\n`)
      return settled(2)
    }
    if (error instanceof DesktopLeaseUnstableError) return settled(1)
    throw error
  }
  try {
    await mkdir(options.home, { recursive: true, mode: 0o700 })
  } catch (error: unknown) {
    await lease.release()
    throw error
  }
  return bind(lease, options)
}

function settled(code: number): SupervisorRun {
  return {
    exited: Promise.resolve(code),
    childPid: () => undefined,
    stop: () => Promise.resolve(),
  }
}

function bind(lease: DesktopLease, options: SupervisorOptions): SupervisorRun {
  let child: ChildProcess | undefined
  let resolveExit!: (code: number) => void
  let rejectExit!: (error: unknown) => void
  const exited = new Promise<number>((resolve, reject) => { resolveExit = resolve; rejectExit = reject })
  let finished = false
  let detachSignals: () => void = () => {}
  const finish = (code: number): void => {
    if (finished) return
    finished = true
    detachSignals()
    lease.release().then(() => { resolveExit(code) }, (error: unknown) => { rejectExit(error) })
  }
  const run: SupervisorRun = {
    exited,
    childPid: () => child?.pid,
    async stop() {
      if (child === undefined) {
        finish(0)
        await exited
        return
      }
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      await exited
    },
  }
  if (options.spawn !== false) launch()
  return run

  function launch(): void {
    if (options.signals === true) {
      const onSignal = (): void => {
        run.stop().then(() => {}, (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          process.stderr.write(`desktop-operation: ${message}\n`)
          process.exit(1)
        })
      }
      process.once('SIGTERM', onSignal)
      process.once('SIGINT', onSignal)
      detachSignals = () => {
        process.off('SIGTERM', onSignal)
        process.off('SIGINT', onSignal)
      }
    }
    child = spawn(options.binary, [...options.args], {
      stdio: options.stdio === 'ignore'
        ? ['ignore', 'ignore', 'ignore', lease.fd]
        : ['inherit', 'inherit', 'inherit', lease.fd],
      env: {
        ...process.env,
        AGENT_DESKTOP_HOME: options.home,
        AGENT_DESKTOP_MACOS_HELPER_PATH: options.helper,
      },
    })
    child.once('error', () => { finish(1) })
    child.once('exit', (code) => { finish(code ?? 1) })
  }
}

/** Parsed supervisor command. */
export interface SupervisorCliArguments {
  /** Absolute lock file from `--lock`. */
  readonly lock: string
  /** Executable from `--binary`. */
  readonly binary: string
  /** Arguments after `--`. */
  readonly args: readonly string[]
}

/** Platform, environment, and stderr used by one CLI invocation. */
export interface SupervisorCliIo {
  /** Host platform. The process CLI passes `process.platform`. */
  readonly platform: NodeJS.Platform
  /** Host architecture. The process CLI passes `process.arch`. */
  readonly arch: string
  /** Environment. `AGENT_DESKTOP_HOME` must be absolute before spawn. */
  readonly env: NodeJS.ProcessEnv
  /** Writer for the usage line, the busy line, and failure text. */
  readonly stderr: { write(chunk: string): void }
}

/**
 * Parse `--lock`, `--binary`, and the child arguments after `--`.
 * A missing value, or a value that itself starts with `--`, does not set that field.
 * @param argv - arguments after the Node executable.
 * @returns the lock, binary, and child arguments, or undefined when either path is empty.
 */
export function parseSupervisorArguments(argv: readonly string[]): SupervisorCliArguments | undefined {
  const separator = argv.indexOf('--')
  const own = separator === -1 ? argv : argv.slice(0, separator)
  const args = separator === -1 ? [] : argv.slice(separator + 1)
  let lock = ''
  let binary = ''
  for (let index = 0; index < own.length; index += 1) {
    const flag = own[index]
    const value = own[index + 1]
    if ((flag === '--lock' || flag === '--binary') && value !== undefined && !value.startsWith('--')) {
      if (flag === '--lock') lock = value
      else binary = value
      index += 1
    }
  }
  if (lock === '' || binary === '') return undefined
  return { lock, binary, args }
}

/**
 * Run one supervisor command and return its process exit code.
 * SIGTERM and SIGINT on this process stop the child, then release the lock.
 * @param argv - arguments after the Node executable.
 * @param io - platform tuple, environment, and stderr writer.
 * @returns `0` for an unsupported platform or a zero child exit, `2` when the lease is held, and `1` for usage, home, or child failure.
 */
export async function executeSupervisorCli(argv: readonly string[], io: SupervisorCliIo): Promise<number> {
  const parsed = parseSupervisorArguments(argv)
  if (parsed === undefined) {
    io.stderr.write('desktop-operation: supervisor requires --lock and --binary\n')
    return 1
  }
  try {
    const run = await startSupervisor({
      platform: io.platform,
      arch: io.arch,
      home: io.env.AGENT_DESKTOP_HOME ?? '',
      lockPath: parsed.lock,
      binary: parsed.binary,
      helper: io.env.AGENT_DESKTOP_MACOS_HELPER_PATH ?? '',
      args: parsed.args,
      signals: true,
      stderr: io.stderr,
    })
    return await run.exited
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    io.stderr.write(`desktop-operation: ${message}\n`)
    return 1
  }
}

/**
 * Start the CLI when `argv` names this program.
 * The module calls this with `process.argv`. A test can call it with an explicit list.
 * @param argv - full process arguments, including the executable.
 */
export function launchSupervisorCli(argv: readonly string[]): void {
  if (!invokedAsCli(argv)) return
  void executeSupervisorCli(argv.slice(2), {
    platform: process.platform,
    arch: process.arch,
    env: process.env,
    stderr: process.stderr,
  }).then((code) => {
    process.exit(code)
  })
}

function invokedAsCli(argv: readonly string[]): boolean {
  const separator = argv.indexOf('--')
  const own = separator === -1 ? argv : argv.slice(0, separator)
  return own.some((entry) => {
    const name = basename(entry)
    return name === 'supervisor.js' || name === 'supervisor.ts'
  })
}

launchSupervisorCli(process.argv)
