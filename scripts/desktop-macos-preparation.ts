/** Bind the no-credentials assembly phase to the later native signing phase. */
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { payloadDigest } from './desktop-release-manifest.ts'

/**
 * Replace a rebuilt app with a byte-identical copy on fresh filesystem objects before execution.
 * @param app - signed assembled application directory.
 */
export function refreshPreparedMacOSApplication(app: string): void {
  app = resolve(app)
  const stage = mkdtempSync(join(dirname(app), '.dsh-prepared-'))
  const fresh = join(stage, 'fresh.app')
  const previous = join(stage, 'previous.app')
  let retainRecovery = false
  try {
    const before = payloadDigest(app)
    cpSync(app, fresh, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
    if (payloadDigest(fresh) !== before) throw new Error('Prepared application copy changed payload bytes')
    renameSync(app, previous)
    try {
      renameSync(fresh, app)
    } catch (error) {
      try { renameSync(previous, app) } catch (restoreError) {
        retainRecovery = true
        throw new AggregateError([error, restoreError], `Application recovery retained at ${previous}`)
      }
      throw error
    }
  } finally {
    if (!retainRecovery) rmSync(stage, { recursive: true, force: true })
  }
}

/**
 * Seal an application after readiness succeeds, or refuse changed or unverified signing inputs.
 * @param operation - record during assembly or verify before signing.
 * @param app - complete unsigned application directory.
 * @param architecture - selected native architecture.
 * @param mode - internal or public qualification.
 */
export function preparedMacOSApplication(operation: 'record' | 'verify', app: string, architecture: string, mode: string): void {
  if (!['arm64', 'x64'].includes(architecture) || !['internal', 'public'].includes(mode)) throw new Error('Invalid prepared application target')
  const record = { schemaVersion: 2, readiness: 'bundle-smoke-v1', architecture, mode, sha256: payloadDigest(app) }
  const path = `${app}.prepared.json`
  if (operation === 'record') writeFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 })
  else {
    const saved: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof saved !== 'object' || saved === null || !('schemaVersion' in saved) || saved.schemaVersion !== 2
      || !('readiness' in saved) || saved.readiness !== 'bundle-smoke-v1'
      || !('architecture' in saved) || saved.architecture !== architecture || !('mode' in saved) || saved.mode !== mode
      || !('sha256' in saved) || saved.sha256 !== record.sha256) throw new Error('Prepared application changed; repeat unsigned assembly')
  }
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, app, architecture, mode] = process.argv.slice(2)
  if (operation === 'refresh' && app) refreshPreparedMacOSApplication(app)
  else {
    if ((operation !== 'record' && operation !== 'verify') || !app || !architecture || !mode) throw new Error('Expected refresh|record|verify, app, architecture and mode')
    preparedMacOSApplication(operation, app, architecture, mode)
  }
}
