/**
 * SELECT-only SQLite execution with lexical diagnostics, filesystem checks,
 * managed process termination, and startup safety probes.
 * @module @deepseek-ai/dsh-experimental-commerce-mode/provider/analysis
 */

import { lstat, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { CommerceError, type CommerceAnalysisResult, type CommerceRecord } from '@deepseek-ai/dsh-host-commerce'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'

/** Runtime bounds for one analysis process. */
export interface AnalysisLimits {
  readonly maxRows: number
  readonly maxOutputBytes: number
  readonly timeoutMs: number
  readonly graceMs: number
}

/** Captured stdout, bounded stderr, and the managed-process outcome. */
export interface ProcessResult {
  readonly stdout: string
  readonly stderr: string
  readonly outcome: SubprocessOutcome
}

type StopReason = 'aborted' | 'timeout' | 'output-too-large' | undefined

const FORBIDDEN_SQL = /\b(?:attach|detach|pragma|insert|update|delete|replace\s+into|create|drop|alter|vacuum|reindex|load_extension)\b/iu

/**
 * Apply the conservative diagnostic grammar for model-authored analysis SQL.
 * @param query - candidate SQL text.
 * @returns one trimmed statement without a trailing semicolon.
 * @throws {@link CommerceError} with `analysis-rejected` and a stable rule id.
 */
export function validateAnalysisQuery(query: string): string {
  let statement = query.trim()
  if (statement.length === 0) rejectQuery('empty', 'analysis query is empty')
  if (statement.includes('--') || statement.includes('/*') || statement.includes('*/')) {
    rejectQuery('comments', 'analysis query must not contain SQL comments')
  }
  if (statement.endsWith(';')) statement = statement.slice(0, -1).trimEnd()
  if (statement.includes(';')) rejectQuery('multiple-statements', 'analysis query must contain exactly one statement')
  if (FORBIDDEN_SQL.test(statement)) {
    rejectQuery('forbidden-keyword', 'analysis query contains a forbidden SQL operation')
  }
  if (!/^(?:select|with)\b/iu.test(statement)) {
    rejectQuery('select-only', 'analysis query must start with SELECT or WITH')
  }
  return statement
}

function rejectQuery(ruleId: string, message: string): never {
  throw new CommerceError('analysis-rejected', message, { ruleId })
}

/**
 * Resolve a source database only when the requested path is a direct regular
 * file beneath the canonical source root.
 * @param sourcesRoot - configured source root.
 * @param databasePath - database selected by the Provider.
 * @returns canonical database path.
 * @throws {@link CommerceError} when the path is missing, linked, non-regular, or outside the root.
 */
export async function assertAnalysisDatabasePath(
  sourcesRoot: string,
  databasePath: string,
): Promise<string> {
  try {
    const [root, linkInfo, database] = await Promise.all([
      realpath(sourcesRoot),
      lstat(databasePath),
      realpath(databasePath),
    ])
    if (linkInfo.isSymbolicLink()) throw new Error('database path is a symbolic link')
    const info = await stat(database)
    const rel = relative(root, database)
    if (!info.isFile() || rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) {
      throw new Error('database is not a regular file inside the source root')
    }
    return database
  } catch {
    throw new CommerceError('source-invalid', 'commerce database must be a direct regular file inside sourcesRoot', {
      ruleId: 'database-path',
    })
  }
}

/**
 * Run one sqlite3 argv through the managed subprocess service.
 * @param ctx - context carrying `ctx.subprocess`.
 * @param argv - complete executable argv.
 * @param cwd - owned working directory.
 * @param limits - output, timeout, and termination bounds.
 * @param signal - caller cancellation.
 * @returns collected process output and exit facts.
 */
export async function runSqliteProcess(
  ctx: Context,
  argv: readonly string[],
  cwd: string,
  limits: AnalysisLimits,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  signal?.throwIfAborted()
  const controller = new AbortController()
  let stopReason: StopReason
  const onCallerAbort = (): void => {
    stopReason ??= 'aborted'
    controller.abort(signal?.reason)
  }
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(() => {
    if (stopReason !== undefined) return
    stopReason = 'timeout'
    controller.abort(new Error('commerce analysis timed out'))
  }, limits.timeoutMs)
  let handle: SubprocessHandle | undefined
  try {
    handle = ctx.subprocess.spawn({
      argv,
      cwd,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: limits.graceMs,
      signal: controller.signal,
      env: {},
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    const stdout = handle.stdout
    const stderr = handle.stderr
    if (stdout === undefined || stderr === undefined) throw new Error('sqlite3 pipes are unavailable')
    stdout.on('data', (chunk: Buffer | string) => {
      // Output after any stop is discarded, so retained bytes never exceed the limit while the child exits.
      if (stopReason !== undefined) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      stdoutBytes += bytes.byteLength
      if (stdoutBytes > limits.maxOutputBytes) {
        stopReason = 'output-too-large'
        controller.abort(new Error('commerce analysis output exceeded its byte limit'))
        handle?.terminate()
        return
      }
      stdoutChunks.push(bytes)
    })
    stderr.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      stderrBytes += bytes.byteLength
      if (stderrBytes <= 65_536) stderrChunks.push(bytes)
    })
    const outcome = await handle.done
    await handle.waitForExit()
    if (stopReason === 'timeout') {
      throw new CommerceError('analysis-timeout', 'commerce analysis exceeded its time limit', {
        ruleId: 'analysis-timeout', limit: limits.timeoutMs,
      })
    }
    if (stopReason === 'output-too-large') {
      throw new CommerceError('analysis-output-too-large', 'commerce analysis exceeded its output limit', {
        ruleId: 'analysis-output', limit: limits.maxOutputBytes,
      })
    }
    signal?.throwIfAborted()
    return {
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
      outcome,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onCallerAbort)
    if (controller.signal.aborted && handle !== undefined) {
      handle.terminate()
      await handle.done.catch(() => undefined)
      await handle.waitForExit()
    }
  }
}

/**
 * Verify the minimum sqlite3 version and each required safe-mode denial.
 * @param ctx - context carrying `ctx.subprocess`.
 * @param sqlite3 - resolved sqlite3 executable.
 * @param graceMs - termination grace for probe children.
 * @returns after all probes reject their dangerous operation.
 */
export async function probeSqliteSafety(
  ctx: Context,
  sqlite3: string,
  graceMs: number,
): Promise<void> {
  const limits: AnalysisLimits = { maxRows: 1, maxOutputBytes: 65_536, timeoutMs: 5_000, graceMs }
  const probeRoot = await mkdtemp(join(tmpdir(), 'dsh-commerce-sqlite-probe-'))
  try {
    const version = await runSqliteProcess(ctx, [sqlite3, '-version'], probeRoot, limits)
    const parsed = /^(\d+)\.(\d+)\.(\d+)/u.exec(version.stdout.trim())
    if (version.outcome.exitCode !== 0 || parsed === null || compareVersion(parsed, [3, 41, 2]) < 0) {
      throw new CommerceError('sqlite3-unavailable', 'commerce-mode requires sqlite3 version 3.41.2 or newer', {
        ruleId: 'sqlite3-version',
      })
    }
    const probePath = join(probeRoot, '.commerce-safety-probe').replaceAll("'", "''")
    const probes = [
      { name: 'readfile', sql: `SELECT readfile('${probePath}')`, diagnostic: /readfile/iu },
      { name: 'writefile', sql: `SELECT writefile('${probePath}','x')`, diagnostic: /writefile/iu },
      { name: 'ATTACH', sql: `ATTACH '${probePath}' AS p`, diagnostic: /attach/iu },
    ] as const
    for (const probe of probes) {
      const result = await runSqliteProcess(
        ctx,
        [sqlite3, '-safe', '-batch', ':memory:', probe.sql],
        probeRoot,
        limits,
      )
      if (result.outcome.exitCode === 0 || !probe.diagnostic.test(result.stderr)) {
        throw new CommerceError(
          'sqlite3-unavailable',
          `sqlite3 safe-mode probe did not deny ${probe.name}`,
          { ruleId: `sqlite3-safe-${probe.name.toLowerCase()}` },
        )
      }
    }
  } finally {
    await rm(probeRoot, { recursive: true, force: true })
  }
}

function compareVersion(match: RegExpExecArray, minimum: readonly number[]): number {
  for (let index = 0; index < minimum.length; index += 1) {
    const actual = Number(match[index + 1])
    const expected = minimum[index] ?? 0
    if (actual !== expected) return actual - expected
  }
  return 0
}

/**
 * Execute one already-validated SELECT against one verified source database.
 * @param ctx - context carrying `ctx.subprocess`.
 * @param sqlite3 - resolved sqlite3 executable.
 * @param sourcesRoot - configured source root.
 * @param databasePath - provider-selected database path.
 * @param query - SELECT statement without a trailing semicolon.
 * @param limits - result and child-process limits.
 * @param signal - caller cancellation.
 * @returns bounded JSON rows and truncation state.
 */
export async function executeAnalysisQuery(
  ctx: Context,
  sqlite3: string,
  sourcesRoot: string,
  databasePath: string,
  query: string,
  limits: AnalysisLimits,
  signal?: AbortSignal,
): Promise<CommerceAnalysisResult> {
  const database = await assertAnalysisDatabasePath(sourcesRoot, databasePath)
  const sql = `SELECT * FROM (${query}) LIMIT ${String(limits.maxRows + 1)}`
  const result = await runSqliteProcess(ctx, [
    sqlite3, '-safe', '-readonly', '-nofollow', '-batch', '-bail', '-json', database, sql,
  ], dirname(database), limits, signal)
  if (result.outcome.exitCode !== 0) {
    throw new CommerceError('analysis-rejected', result.stderr.trim() || 'sqlite3 rejected the analysis query', {
      ruleId: 'sqlite-execution',
    })
  }
  const rows = parseRows(result.stdout)
  const truncated = rows.length > limits.maxRows
  const kept = truncated ? rows.slice(0, limits.maxRows) : rows
  return { columns: Object.keys(kept[0] ?? rows[0] ?? {}), rows: kept, truncated }
}

function parseRows(stdout: string): CommerceRecord[] {
  if (stdout.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new CommerceError('analysis-rejected', 'sqlite3 returned invalid JSON', {
      ruleId: 'sqlite-json',
    })
  }
  if (!Array.isArray(parsed)) {
    throw new CommerceError('analysis-rejected', 'sqlite3 returned a non-array JSON result', {
      ruleId: 'sqlite-json',
    })
  }
  if (!parsed.every(isCommerceRecord)) {
    throw new CommerceError('analysis-rejected', 'sqlite3 returned a row that is not an object of scalar values', {
      ruleId: 'sqlite-json',
    })
  }
  return parsed
}

function isCommerceRecord(value: unknown): value is CommerceRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every(cell => cell === null || typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean')
}
