import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { artifactDigest, payloadDigest } from './desktop-release-manifest.ts'
import { describe, expect, it } from 'vitest'
import { assertRunEvidence, assertPublicPreflight, assertArtifactBytes, verifyNativeSignatures } from './verify-desktop-release.ts'
import type { DesktopReleaseManifest } from './desktop-release-manifest.ts'
const commit = 'a'.repeat(40)
const manifest: DesktopReleaseManifest = {
  schemaVersion: 1, mode: 'public', repository: 'AlataChan/deepseek-harness', ref: 'refs/heads/release',
  release: { version: '0.2.1', commit }, shellVersion: '0.2.1', target: 'windows-x64', payloadSha256: 'b'.repeat(64),
  artifact: { name: 'octopus-0.2.1-windows-x64.exe', bytes: 42, sha256: 'c'.repeat(64) },
  workflow: { path: '.github/workflows/desktop-windows.yml', commit, runId: 123, attempt: 2, artifactName: 'octopus_DSH_Setup' },
}
const run = { repository: manifest.repository, ref: manifest.ref, commit, runId: 123, attempt: 2, workflow: manifest.workflow!.path,
  status: 'completed', conclusion: 'success', jobs: [{ name: 'build-exe', conclusion: 'success' }], installedVerified: true }
describe('independent desktop qualification', () => {
  it('refuses wrong commit, attempt, repository, target and failed or absent installed checks', () => {
    expect(() =>{  assertRunEvidence(manifest, run, 'windows-x64') }).not.toThrow()
    for (const change of [{ commit: 'd'.repeat(40) }, { attempt: 1 }, { repository: 'deepseek-ai/deepseek-harness' },
      { conclusion: 'failure' }, { installedVerified: false }, { jobs: [] }]) {
      expect(() =>{  assertRunEvidence(manifest, { ...run, ...change }, 'windows-x64') }).toThrow()
    }
    expect(() =>{  assertRunEvidence(manifest, run, 'macos-arm64') }).toThrow()
  })
  it('fails missing public credentials before building and keeps internal available', () => {
    expect(() =>{  assertPublicPreflight('public', 'windows-x64', {}) }).toThrow(/publisher|certificate/i)
    expect(() =>{  assertPublicPreflight('public', 'macos-arm64', {}) }).toThrow(/identity|notar/i)
    expect(() =>{  assertPublicPreflight('internal', 'windows-x64', {}) }).not.toThrow()
  })
})

describe('native invalid signature rejection', () => {
  it.skipIf(process.platform !== 'darwin')('rejects an unsigned payload through native codesign', () => {
    const root = mkdtempSync(join(tmpdir(), 'unsigned-desktop-'))
    const file = join(root, 'unsigned')
    writeFileSync(file, 'not a signed executable')
    try {
      expect(() => {
        verifyNativeSignatures({ ...manifest, target: 'macos-arm64' }, file, file, { DSH_MAC_TEAM_ID: 'SYNTHETIC' })
      }).toThrow(/Native verification failed/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

it('rejects a changed payload identity even when a producer recomputes its tree hash', () => {
  const root = mkdtempSync(join(tmpdir(), 'changed-identity-'))
  try {
    const file = join(root, manifest.artifact.name)
    writeFileSync(file, 'binary')
    writeFileSync(join(root, 'build-info.json'), JSON.stringify({ release: { version: manifest.release.version, commit: 'f'.repeat(40) } }))
    expect(() => {
      assertArtifactBytes({ ...manifest, artifact: artifactDigest(file), payloadSha256: payloadDigest(root) }, file, root)
    }).toThrow(/release identity/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it.skipIf(process.platform !== 'win32')('rejects an unsigned installer through native Authenticode', () => {
  const root = mkdtempSync(join(tmpdir(), 'unsigned-authenticode-'))
  const file = join(root, 'unsigned.exe')
  writeFileSync(file, 'not an Authenticode signed executable')
  try {
    expect(() => {
      verifyNativeSignatures(manifest, file, file, { ...process.env, DSH_WINDOWS_PUBLISHER: 'CN=Synthetic Publisher' })
    }).toThrow(/Authenticode verification failed/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
