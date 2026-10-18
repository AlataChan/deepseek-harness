/** Versioned identities for an assembled desktop artifact and its installed payload. */
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { validateDesktopBuildIdentity, type DesktopBuildIdentity } from './desktop-build-identity.ts'

/** Inputs that identify one CI execution, independently of artifact names. */
export interface DesktopWorkflowIdentity {
  path: string
  commit: string
  runId: number
  attempt: number
  artifactName: string
}
/** Identity recorded outside the signed artifact, whose bytes cannot contain their own digest. */
export interface DesktopReleaseManifest {
  schemaVersion: 1
  mode: 'internal' | 'public'
  repository: string
  ref: string
  release: DesktopBuildIdentity
  shellVersion: string
  target: 'windows-x64' | 'macos-arm64' | 'macos-x64'
  payloadSha256: string
  artifact: { name: string; bytes: number; sha256: string }
  workflow?: DesktopWorkflowIdentity
}
/** Compute the size and digest from the actual final artifact bytes. @param path - artifact file. @returns observed bytes and hash. */
export function artifactDigest(path: string): DesktopReleaseManifest['artifact'] {
  if (!lstatSync(path).isFile()) throw new Error(`Artifact must be a regular file: ${path}`)
  const data = readFileSync(path)
  return { name: basename(path), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }
}
/** Hash the complete installed payload, including relative names. @param root - payload directory. @returns deterministic tree digest. */
export function payloadDigest(root: string): string {
  const hash = createHash('sha256')
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw new Error(`Payload symlinks are forbidden: ${path}`)
      if (stat.isDirectory()) visit(path)
      else if (stat.isFile()) {
        const bytes = readFileSync(path)
        hash.update(JSON.stringify([relative(root, path).replaceAll('\\', '/'), bytes.length])).update('\n').update(bytes)
      } else throw new Error(`Unsupported payload entry: ${path}`)
    }
  }
  visit(root)
  return hash.digest('hex')
}
/** Parse an untrusted release record. @param value - JSON decoded from disk or a release asset. @returns validated manifest. */
export function validateReleaseManifest(value: unknown): DesktopReleaseManifest {
  if (typeof value !== 'object' || value === null) throw new Error('Manifest must be an object')
  const v = value as Record<string, unknown>
  const text = (key: string): string => {
    if (typeof v[key] !== 'string' || v[key] === '') throw new Error(`Manifest ${key} is required`)
    return v[key]
  }
  if (v.schemaVersion !== 1 || (v.mode !== 'internal' && v.mode !== 'public')) throw new Error('Unsupported manifest version or mode')
  const target = text('target')
  if (target !== 'windows-x64' && target !== 'macos-arm64' && target !== 'macos-x64') throw new Error('Unsupported target')
  const repository = text('repository')
  if (repository !== 'AlataChan/deepseek-harness') throw new Error('Only the fork release repository is allowed')
  const payloadSha256 = text('payloadSha256')
  if (!/^[a-f0-9]{64}$/.test(payloadSha256)) throw new Error('Invalid payload digest')
  if (typeof v.artifact !== 'object' || v.artifact === null) throw new Error('Missing artifact')
  const a = v.artifact as Record<string, unknown>
  if (typeof a.name !== 'string' || a.name !== basename(a.name) || !/^[A-Za-z0-9._-]+$/.test(a.name)
    || typeof a.bytes !== 'number' || !Number.isSafeInteger(a.bytes) || a.bytes <= 0
    || typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256)) throw new Error('Invalid artifact identity')
  let workflow: DesktopWorkflowIdentity | undefined
  if (v.workflow !== undefined) {
    if (typeof v.workflow !== 'object' || v.workflow === null) throw new Error('Invalid workflow')
    const w = v.workflow as Record<string, unknown>
    if (typeof w.path !== 'string' || !/^\.github\/workflows\/[a-z0-9-]+\.yml$/.test(w.path)
      || typeof w.commit !== 'string' || !/^[a-f0-9]{40}$/.test(w.commit)
      || typeof w.runId !== 'number' || !Number.isSafeInteger(w.runId) || w.runId <= 0
      || typeof w.attempt !== 'number' || !Number.isSafeInteger(w.attempt) || w.attempt <= 0
      || typeof w.artifactName !== 'string' || !/^[A-Za-z0-9._-]+$/.test(w.artifactName)) throw new Error('Invalid workflow execution')
    workflow = { path: w.path, commit: w.commit, runId: w.runId, attempt: w.attempt, artifactName: w.artifactName }
  }
  const result: DesktopReleaseManifest = { schemaVersion: 1, mode: v.mode, repository, ref: text('ref'),
    release: validateDesktopBuildIdentity(v.release), shellVersion: text('shellVersion'), target, payloadSha256,
    artifact: { name: a.name, bytes: a.bytes, sha256: a.sha256 }, ...(workflow === undefined ? {} : { workflow }) }
  if (result.mode === 'public' && workflow === undefined) throw new Error('Public artifacts require CI identity')
  if (workflow !== undefined && workflow.commit !== result.release.commit) throw new Error('Workflow and source commits differ')
  return result
}
