import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { artifactDigest, payloadDigest, validateReleaseManifest } from './desktop-release-manifest.ts'

const dirs: string[] = []
afterEach(() =>{  dirs.splice(0).forEach((dir) =>{  rmSync(dir, { recursive: true, force: true }) }) })
describe('desktop release manifest', () => {
  it('hashes installed bytes deterministically and observes changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-manifest-')); dirs.push(root)
    mkdirSync(join(root, 'resources')); writeFileSync(join(root, 'resources', 'node.exe'), 'node')
    const before = payloadDigest(root)
    expect(payloadDigest(root)).toBe(before)
    writeFileSync(join(root, 'resources', 'node.exe'), 'different')
    expect(payloadDigest(root)).not.toBe(before)
    expect(artifactDigest(join(root, 'resources', 'node.exe')).bytes).toBe(9)
  })
  it('rejects unsupported or incomplete manifests at the file parser', () => {
    expect(() => validateReleaseManifest({ schemaVersion: 999 })).toThrow()
    expect(() => validateReleaseManifest({ schemaVersion: 1, mode: 'public' })).toThrow()
  })
})
