/** Bind the no-credentials assembly phase to the later native signing phase. */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { payloadDigest } from './desktop-release-manifest.ts'

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
  if ((operation !== 'record' && operation !== 'verify') || !app || !architecture || !mode) throw new Error('Expected record|verify, app, architecture and mode')
  preparedMacOSApplication(operation, app, architecture, mode)
}
