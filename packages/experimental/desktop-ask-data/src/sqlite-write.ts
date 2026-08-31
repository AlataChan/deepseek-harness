/**
 * Shell-safe sqlite3 argv writer for imported tables.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/sqlite-write
 */

import { spawn } from 'node:child_process'
import { chmod, unlink } from 'node:fs/promises'
import { AskDataError } from '@deepseek-ai/dsh-host-ask-data'

/** One imported table ready to persist. */
export interface ImportedTable {
  readonly name: string
  readonly columns: readonly string[]
  readonly rows: readonly (readonly (string | number | null)[])[]
}

/**
 * Quote one SQL identifier.
 * @param name - identifier.
 * @returns double-quoted identifier.
 */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/**
 * Quote one SQL text value.
 * @param value - cell value.
 * @returns SQL literal.
 */
export function quoteValue(value: string | number | null): string {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Locate `sqlite3` on PATH.
 * @returns absolute or bare command, or undefined when missing.
 */
export async function findSqlite3(): Promise<string | undefined> {
  const { default: which } = await importWhich()
  return which
}

async function importWhich(): Promise<{ default: string | undefined }> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const exec = promisify(execFile)
  try {
    const { stdout } = await exec('which', ['sqlite3'])
    const line = stdout.trim()
    return { default: line === '' ? undefined : line }
  } catch {
    return { default: undefined }
  }
}

/**
 * Write tables into `sqlitePath` through sqlite3 stdin. Argv never carries SQL.
 * @param sqlitePath - destination file.
 * @param tables - tables to create.
 * @param signal - caller lifetime.
 * @returns after chmod / readonly probe.
 */
export async function writeSqliteFile(
  sqlitePath: string,
  tables: readonly ImportedTable[],
  signal?: AbortSignal,
): Promise<void> {
  const command = await findSqlite3()
  if (command === undefined) {
    throw new AskDataError('sqlite3-missing', 'sqlite3 is not on PATH', { ruleId: 'sqlite3-missing' })
  }
  await unlink(sqlitePath).catch(() => {
    // file may not exist yet on the first write
  })
  const statements: string[] = ['PRAGMA journal_mode=DELETE;']
  for (const table of tables) {
    const cols = table.columns.map(col => `${quoteIdent(col)} TEXT`).join(', ')
    statements.push(`CREATE TABLE ${quoteIdent(table.name)} (${cols});`)
    for (const row of table.rows) {
      const values = row.map(quoteValue).join(', ')
      statements.push(`INSERT INTO ${quoteIdent(table.name)} VALUES (${values});`)
    }
  }
  await runSqlite3(command, sqlitePath, statements.join('\n'), signal)
  await tryReadonlyFile(command, sqlitePath, tables[0]?.name, signal)
}

async function tryReadonlyFile(
  command: string,
  sqlitePath: string,
  table: string | undefined,
  signal?: AbortSignal,
): Promise<void> {
  if (table === undefined) return
  try {
    await chmod(sqlitePath, 0o444)
    await runSqlite3(command, sqlitePath, `SELECT COUNT(*) FROM ${quoteIdent(table)};`, signal)
  } catch {
    /* v8 ignore start -- chmod 0444 and SELECT on an owned temp file do not fail on CI hosts */
    await chmod(sqlitePath, 0o644).catch(() => {
      // restore failed; SELECT below still probes readability
    })
    await runSqlite3(command, sqlitePath, `SELECT COUNT(*) FROM ${quoteIdent(table)};`, signal)
    /* v8 ignore stop */
  }
}

/**
 * Read table names, row counts, and column names from an existing sqlite file.
 * @param sqlitePath - sqlite file.
 * @param signal - caller lifetime.
 * @returns preview tables.
 */
export async function readSqlitePreview(
  sqlitePath: string,
  signal?: AbortSignal,
): Promise<{ name: string; rowCount: number; columns: string[] }[]> {
  const command = await findSqlite3()
  if (command === undefined) {
    throw new AskDataError('sqlite3-missing', 'sqlite3 is not on PATH', { ruleId: 'sqlite3-missing' })
  }
  const namesOut = await captureSqlite3(
    command,
    sqlitePath,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY 1;",
    signal,
  )
  const names = namesOut.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  const tables: { name: string; rowCount: number; columns: string[] }[] = []
  for (const name of names) {
    const countOut = await captureSqlite3(
      command,
      sqlitePath,
      `SELECT COUNT(*) FROM ${quoteIdent(name)};`,
      signal,
    )
    const infoOut = await captureSqlite3(
      command,
      sqlitePath,
      `PRAGMA table_info(${quoteIdent(name)});`,
      signal,
    )
    const columns = infoOut.split('\n').map(line => line.split('|')[1]?.trim() ?? '').filter(col => col.length > 0)
    tables.push({ name, rowCount: Number(countOut.trim()), columns })
  }
  return tables
}

function captureSqlite3(
  command: string,
  database: string,
  sql: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, ['-separator', '|', '-noheader', database], { stdio: ['pipe', 'pipe', 'pipe'] })
    const onAbort = (): void => { child.kill('SIGTERM') }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted === true) onAbort()
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => {
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (code === 0) {
        resolvePromise(stdout)
        return
      }
      reject(new Error(stderr.trim() === '' ? `sqlite3 exited ${String(code)}` : stderr.trim()))
    })
    child.stdin.end(`${sql}\n`)
  })
}

function runSqlite3(
  command: string,
  database: string,
  sql: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [database], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const onAbort = (): void => {
      child.kill('SIGTERM')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted === true) onAbort()
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => {
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(stderr.trim() === '' ? `sqlite3 exited ${String(code)}` : stderr.trim()))
    })
    child.stdin.end(`${sql}\n`)
  })
}
