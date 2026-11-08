import { runtimePlatformQualified } from './runtime-lock.ts'
import { RUNTIME_LOCK_ID } from './runtime-lock.ts'
/**
 * Managed Agent-Reach execution service running through `ctx.subprocess`.
 *
 * Implements route pre-validation, bounded UTF-8 stream collection, supervised process groups,
 * credential scrubbing, shadowing collision detection, and deterministic teardown.
 *
 * @module @deepseek-ai/dsh-experimental-agent-reach/runner
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  type AgentReachConfig,
  buildSafeArgv,
  RUNTIME_CONTRACT,
  validateRoute,
  resolveConfig,
  type ResolvedAgentReachConfig,
} from './catalog.ts'
import { OwnedCommands, reachEnvironment } from './execution.ts'
import { readInstallationRecordDetailed } from './installation-record.ts'
import { parseUpstreamJson, scrubText } from './result.ts'
import type {
  AgentReachError,
  AgentReachExecutionRequest,
  AgentReachResult,
  AgentReachService,
  ToolResolutionResult,
} from './types.ts'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Owning DSH home used for deterministic private runtime lookup. */
export interface RunnerDependencies {
  readonly dshHome?: string | undefined
}

/** Known upstream tool mapping from tool identifier to executable command names. */
const TOOL_COMMANDS: Record<string, readonly string[]> = {
  'bili-cli': ['bili', 'bili-cli'],
  'opencli': ['opencli'],
  'boss-agent-cli': ['boss', 'boss-agent-cli'],
  'ffmpeg': ['ffmpeg'],
  'node': ['node', 'npm', 'npx'],
  'uv': ['uv', 'uvx'],
  'cloakbrowser': ['cloakbrowser'],
}

/**
 * Resolves whether an existing tool in ~/.agent-reach/tools shadows a qualified command.
 * Read-only check: never mutates ~/.agent-reach or executes tool binaries.
 * Fails closed if inspection encounters a filesystem read error.
 *
 * @param toolNames - names of tool commands to inspect
 * @param homeDir - user home directory (defaults to os.homedir())
 * @returns ToolResolutionResult
 */
export function checkShadowedTools(toolNames: readonly string[], homeDir: string = os.homedir()): ToolResolutionResult {
  const toolsDir = path.join(homeDir, '.agent-reach', 'tools')
  try {
    if (!fs.statSync(toolsDir).isDirectory()) throw new Error('Upstream tools path is not a directory')
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return { found: false }
    return {
      found: false,
      inspectionError: true,
      error: `Inspection failed for toolsDir: ${(err as Error).message}`,
    }
  }

  try {
    for (const tool of toolNames) {
      const commands = TOOL_COMMANDS[tool] ?? [tool]
      for (const cmd of commands) {
        const candidates = [
          // Direct binaries
          path.join(toolsDir, cmd),
          path.join(toolsDir, `${cmd}.exe`),
          path.join(toolsDir, `${cmd}.cmd`),
          path.join(toolsDir, 'bin', cmd),
          // Tool-specific private venvs
          path.join(toolsDir, tool, 'venv', 'bin', cmd),
          path.join(toolsDir, tool, 'venv', 'Scripts', `${cmd}.exe`),
          path.join(toolsDir, tool, 'bin', cmd),
          path.join(toolsDir, tool, 'Scripts', `${cmd}.exe`),
          // npm global and private node_modules
          path.join(toolsDir, 'npm-global', 'bin', cmd),
          path.join(toolsDir, 'npm-global', `${cmd}.cmd`),
          path.join(toolsDir, tool, 'node_modules', '.bin', cmd),
          path.join(toolsDir, tool, 'node_modules', '.bin', `${cmd}.cmd`),
          // Node current
          path.join(toolsDir, 'node', 'current', 'bin', cmd),
          path.join(toolsDir, 'node', 'current', `${cmd}.exe`),
          // uv and ffmpeg private bins
          path.join(toolsDir, 'uv', 'bin', cmd),
          path.join(toolsDir, 'uv', 'bin', `${cmd}.exe`),
          path.join(toolsDir, 'ffmpeg', 'bin', cmd),
          path.join(toolsDir, 'ffmpeg', 'bin', `${cmd}.exe`),
        ]
        for (const candidate of candidates) {
          let exists = false
          try { exists = fs.statSync(candidate).isFile() } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
          }
          if (exists) {
            return {
              found: true,
              isShadowedConflict: true,
              shadowPath: candidate,
            }
          }
        }
      }
    }
  } catch (err) {
    return {
      found: false,
      inspectionError: true,
      error: `Inspection failed: ${(err as Error).message}`,
    }
  }

  return { found: false }
}

/** Read-only platform execution with route checks and owned transient commands. */
export class AgentReachRunner implements AgentReachService {
  readonly config: ResolvedAgentReachConfig
  private readonly dshHome: string
  private activeQueries = 0
  private readonly commands: OwnedCommands

  constructor(ctx: Context, config: AgentReachConfig = RUNTIME_CONTRACT.defaultConfiguration, deps: RunnerDependencies = {}) {
    this.config = resolveConfig(config)
    this.dshHome = deps.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

    this.commands = new OwnedCommands(ctx)
  }

  /**
   * Resolve the Agent-Reach CLI executable path.
   * Prefers administrator override if absolute and existent;
   * otherwise resolves strictly from a promoted, validated installation record.
   * Does NOT search ambient PATH.
   * @returns Qualified launcher and owned bin directories, or a missing-runtime reason.
   */
  resolveCliExecutable():
    | { found: true; executable: string; venvBinDir?: string | undefined; toolVenvBinDir?: string | undefined }
    | { found: false; reason: string } {
    const missing = (reason: string): { found: false; reason: string } => ({ found: false, reason: scrubText(reason) })
    if (this.config.runtimeOverride) {
      const override = this.config.runtimeOverride
      if (!path.isAbsolute(override)) {
        return missing(`runtimeOverride must be an absolute path: ${override}`)
      }
      if (!fs.existsSync(override)) {
        return missing(`runtimeOverride path does not exist: ${override}`)
      }
      return { found: true, executable: override }
    }

    const lockId = RUNTIME_LOCK_ID
    const releaseRoot = path.join(this.dshHome, 'runtimes', 'agent-reach', 'releases', lockId)
    const recordFile = path.join(releaseRoot, 'installation-record.json')

    const readRes = readInstallationRecordDetailed(recordFile)
    if (readRes.status === 'absent') {
      return missing(`No validated installation record found at ${recordFile}. Run reach_setup.`)
    }
    if (readRes.status === 'corrupt') {
      return missing(`Corrupt installation record at ${recordFile}: ${readRes.error}. Reinstallation required.`)
    }

    const record = readRes.record
    if (record.upstreamRevision !== RUNTIME_CONTRACT.upstream.reviewedRevision) {
      return missing(`Installation record mismatch: found revision ${record.upstreamRevision}, expected ${RUNTIME_CONTRACT.upstream.reviewedRevision}.`)
    }

    const binDirName = process.platform === 'win32' ? 'Scripts' : 'bin'
    const exeName = process.platform === 'win32' ? 'agent-reach.exe' : 'agent-reach'
    const coreBin = path.join(record.coreVenvPath, binDirName)
    const candidateExe = path.join(coreBin, exeName)

    if (!fs.existsSync(candidateExe)) {
      return missing(`Promoted executable missing at ${candidateExe}. Installation may be corrupt.`)
    }

    const toolVenvBin = record.toolVenvPath ? path.join(record.toolVenvPath, binDirName) : undefined

    return {
      found: true,
      executable: candidateExe,
      venvBinDir: coreBin,
      toolVenvBinDir: toolVenvBin,
    }
  }

  channels(): Promise<{ ok: boolean; channels: typeof RUNTIME_CONTRACT.channels }> {
    return Promise.resolve({
      ok: true,
      channels: RUNTIME_CONTRACT.channels,
    })
  }

  async status(channel?: string): Promise<{ ok: boolean; doctor?: unknown; version?: string; error?: AgentReachError }> {
    if (channel !== undefined && !RUNTIME_CONTRACT.channels.some(entry => entry.name === channel)) {
      return { ok:false,error:{ code:'BAD_INPUT',message:'Unknown channel' } }
    }
    const backends = RUNTIME_CONTRACT.channels
      .filter(entry => channel === undefined ? this.config.enabledChannels.includes(entry.name) : entry.name === channel)
      .flatMap(entry => entry.actions.flatMap(action => action.backends))
    const collision = checkShadowedTools(backends.map(backend => backend.name))
    if (collision.inspectionError || collision.isShadowedConflict) {
      return { ok:false,error:{ code:'SHADOWED_TOOL_CONFLICT',message:'Upstream private tools require administrator inspection' } }
    }
    const response = await this.spawnCli(['doctor'], { timeoutMs:15000 })
    if (response.error) return { ok:false,error:response.error }
    try {
      const raw: unknown = JSON.parse(response.stdout)
      if (!response.ok || !isObject(raw) || raw.schema_version !== 1 || raw.ok !== true || !isObject(raw.result)
        || raw.result.version !== RUNTIME_CONTRACT.upstream.version || !Array.isArray(raw.result.channels)) {
        throw new Error('Unsupported doctor envelope or runtime version')
      }
      const channels = raw.result.channels.filter(isObject)
        .filter(entry => channel === undefined || entry.channel === channel).map((entry) => {
          if (typeof entry.channel !== 'string' || typeof entry.status !== 'string') throw new Error('Malformed doctor channel')
          return { channel:entry.channel.slice(0,100),status:entry.status.slice(0,100),
            enabled:this.config.enabledChannels.includes(entry.channel),
            problems:Array.isArray(entry.problems)
              ? entry.problems.filter((value): value is string => typeof value === 'string').slice(0,4)
                .map(value => scrubText(value).slice(0,500)) : [],
          }
        }).slice(0, RUNTIME_CONTRACT.channels.length)
      return { ok:true,version:raw.result.version,doctor:{ channels,freshProbe:false } }
    } catch (error) {
      return { ok:false,error:{ code:'MALFORMED_OUTPUT',message:scrubText(String(error)).slice(0,500) } }
    }
  }

  async query(request: AgentReachExecutionRequest): Promise<AgentReachResult> {
    const maxConcurrent = this.config.maxConcurrentQueries
    if (this.activeQueries >= maxConcurrent) {
      return {
        ok: false,
        channel: request.channel,
        action: request.action,
        items: [],
        meta: { elapsedMs: 0, attempts: [] },
        error: {
          code: 'BUSY',
          message: `Exceeded maximum concurrent Agent-Reach queries (${maxConcurrent})`,
        },
        accessScope: 'public',
        completeness: 'unknown',
      }
    }

    // Pre-validate route BEFORE any process spawn or runtime probing
    const routeRes = validateRoute(request.channel, request.action, request.backend, this.config)
    if (!routeRes.ok) {
      return {
        ok: false,
        channel: request.channel,
        action: request.action,
        items: [],
        meta: { elapsedMs: 0, attempts: [] },
        error: {
          code: routeRes.code,
          message: routeRes.message,
        },
        accessScope: 'public',
        completeness: 'unknown',
      }
    }

    if (routeRes.requiredEffects.includes('browser-launch')) {
      return { ok:false,channel:request.channel,action:request.action,items:[],meta:{ elapsedMs:0,attempts:[] },
        accessScope:'public',completeness:'unknown',error:{ code:'UNSUPPORTED',message:'Shared browser ownership is not qualified for this backend' } }
    }

    // Build safe argv
    const timeoutSeconds = request.timeoutMs ? Math.round(request.timeoutMs / 1000) : undefined
    const argvRes = buildSafeArgv({
      channel: request.channel,
      action: request.action,
      params: request.params || {},
      ...(request.backend !== undefined ? { backend: request.backend } : {}),
      ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
    })
    if (!argvRes.ok) {
      return {
        ok: false,
        channel: request.channel,
        action: request.action,
        items: [],
        meta: { elapsedMs: 0, attempts: [] },
        error: {
          code: 'BAD_INPUT',
          message: argvRes.error,
        },
        accessScope: 'public',
        completeness: 'unknown',
      }
    }

    // Check upstream ~/.agent-reach/tools shadowing collision
    const backendNames = routeRes.reachableBackends.map(b => b.name)
    const shadowCheck = checkShadowedTools(backendNames)
    if (shadowCheck.inspectionError) {
      return {
        ok: false,
        channel: request.channel,
        action: request.action,
        items: [],
        meta: { elapsedMs: 0, attempts: [] },
        error: {
          code: 'INSPECTION_FAILED',
          message: shadowCheck.error,
        },
        accessScope: 'public',
        completeness: 'unknown',
      }
    }
    if (shadowCheck.isShadowedConflict) {
      return {
        ok: false,
        channel: request.channel,
        action: request.action,
        items: [],
        meta: { elapsedMs: 0, attempts: [] },
        error: {
          code: 'SHADOWED_TOOL_CONFLICT',
          message: `Upstream tool at "${shadowCheck.shadowPath}" shadows qualified command. Manual removal or administrator override required.`,
        },
        accessScope: 'public',
        completeness: 'unknown',
      }
    }

    // Resolve CLI executable
    const cliRes = this.resolveCliExecutable()
    if (!cliRes.found) {
      return {
        ok: false,
        channel: request.channel,
        action: request.action,
        items: [],
        meta: { elapsedMs: 0, attempts: [] },
        error: {
          code: 'NEED_SETUP',
          message: cliRes.reason,
          hint: 'Install prerequisites through the configured setup flow or ask an administrator.',
        },
        accessScope: 'public',
        completeness: 'unknown',
      }
    }

    this.activeQueries++
    try {
      const spawnRes = await this.spawnCli(argvRes.argv, {
        timeoutMs: request.timeoutMs || this.config.queryTimeoutMs,
        signal: request.signal,
        venvBinDir: cliRes.venvBinDir,
        toolVenvBinDir: cliRes.toolVenvBinDir,
      })

      // Classify infrastructure abort, timeout or spawn error first
      if (spawnRes.error) {
        return {
          ok: false,
          channel: request.channel,
          action: request.action,
          items: [],
          meta: { elapsedMs: 0, attempts: [] },
          error: spawnRes.error,
          accessScope: 'public',
          completeness: 'unknown',
        }
      }

      // Check exit code: if nonzero, attempt to parse domain error envelope, else fail as ADAPTER_ERROR
      if (spawnRes.exitCode !== 0) {
        const parsed = parseUpstreamJson(
          spawnRes.stdout,
          spawnRes.stderr,
          request.channel,
          request.action,
          this.config.maxOutputChars,
          this.config.maxItems,
        )
        if (!parsed.ok) {
          return parsed
        }
        // Nonzero exit with ok: true envelope is conflicting and malformed
        return {
          ok: false,
          channel: request.channel,
          action: request.action,
          items: [],
          meta: { elapsedMs: 0, attempts: [] },
          error: {
            code: 'ADAPTER_ERROR',
            message: `Command exited with status ${String(spawnRes.exitCode)} but returned ok:true envelope`,
          },
          accessScope: 'public',
          completeness: 'unknown',
        }
      }

      return parseUpstreamJson(
        spawnRes.stdout,
        spawnRes.stderr,
        request.channel,
        request.action,
        this.config.maxOutputChars,
        this.config.maxItems,
      )
    } finally {
      this.activeQueries--
    }
  }

  /**
   * Spawn the Agent-Reach CLI through ctx.subprocess.
   * @param cliArgs - Validated command arguments.
   * @param options - Caller deadline, cancellation and qualified bin directories.
   * @returns Observed exit facts and bounded private output.
   */
  async spawnCli(
    cliArgs: readonly string[],
    options: {
      timeoutMs?: number | undefined
      signal?: AbortSignal | undefined
      venvBinDir?: string | undefined
      toolVenvBinDir?: string | undefined
    } = {},
  ): Promise<{
    ok: boolean
    stdout: string
    stderr: string
    exitCode: number | null
    error?: AgentReachError | undefined
  }> {
    if (!runtimePlatformQualified()) {
      return { ok:false,stdout:'',stderr:'',exitCode:null,error:{ code:'UNSUPPORTED',message:'Transient backend containment is currently qualified only on macOS arm64' } }
    }
    const cliRes = this.resolveCliExecutable()
    if (!cliRes.found) {
      return {
        ok: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        error: { code: 'NEED_SETUP', message: cliRes.reason },
      }
    }

    const env = reachEnvironment()
    env.no_proxy = `127.0.0.1,localhost,${env.no_proxy ?? ''}`
    env.NO_PROXY = `127.0.0.1,localhost,${env.NO_PROXY ?? ''}`
    env.PATH = [options.toolVenvBinDir ?? cliRes.toolVenvBinDir,
      options.venvBinDir ?? cliRes.venvBinDir, path.dirname(process.execPath),
      '/usr/bin', '/bin',
    ].filter((entry): entry is string => entry !== undefined).join(path.delimiter)
    return this.commands.run({
      argv: [cliRes.executable, ...cliArgs], cwd: os.tmpdir(), env,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: this.config.terminateGraceMs,
    }, {
      timeoutMs: options.timeoutMs ?? this.config.queryTimeoutMs,
      maxStdoutBytes: this.config.maxStdoutBytes,
      maxStderrBytes: this.config.maxStderrBytes, signal: options.signal,
    })
  }
}
