import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { artifactDigest, desktopShellVersion, payloadDigest, validateReleaseManifest } from './desktop-release-manifest.ts'

const dirs: string[] = []
afterEach(() =>{  dirs.splice(0).forEach((dir) =>{  rmSync(dir, { recursive: true, force: true }) }) })
describe('desktop release manifest', () => {
  it('records the Tauri executable version independently of the JavaScript package', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-shell-version-')); dirs.push(root)
    mkdirSync(join(root, 'apps/desktop/src-tauri'), { recursive: true })
    writeFileSync(join(root, 'apps/desktop/package.json'), JSON.stringify({ version: '9.9.9' }))
    writeFileSync(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), JSON.stringify({ version: '0.1.2-rc.3' }))
    expect(desktopShellVersion(root)).toBe('0.1.2-rc.3')
  })
  it.each([{}, { version: '' }, { version: '   ' }, { version: 12 }, null, []])('refuses an absent or invalid Tauri version: %j', (config) => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-shell-version-')); dirs.push(root)
    mkdirSync(join(root, 'apps/desktop/src-tauri'), { recursive: true })
    writeFileSync(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), JSON.stringify(config))
    expect(() => desktopShellVersion(root)).toThrow('Tauri shell version')
  })
  it('hashes installed bytes deterministically and observes changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-manifest-')); dirs.push(root)
    mkdirSync(join(root, 'resources')); writeFileSync(join(root, 'resources', 'node.exe'), 'node')
    const before = payloadDigest(root)
    expect(payloadDigest(root)).toBe(before)
    writeFileSync(join(root, 'resources', 'node.exe'), 'different')
    expect(payloadDigest(root)).not.toBe(before)
    expect(artifactDigest(join(root, 'resources', 'node.exe')).bytes).toBe(9)
  })
  it('hashes relocatable Python links and observes target bytes and link text', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-links-'))); dirs.push(root)
    const internal = join(root, '_internal')
    mkdirSync(internal)
    writeFileSync(join(internal, 'Python3.12'), 'python')
    symlinkSync('Python3.12', join(internal, 'Python'))
    const before = payloadDigest(root)
    expect(payloadDigest(root)).toBe(before)
    writeFileSync(join(internal, 'Python3.12'), 'updated-python')
    expect(payloadDigest(root)).not.toBe(before)
    const updated = payloadDigest(root)
    unlinkSync(join(internal, 'Python'))
    symlinkSync('./Python3.12', join(internal, 'Python'))
    expect(payloadDigest(root)).not.toBe(updated)
    mkdirSync(join(internal, 'versions'))
    symlinkSync('versions', join(internal, 'current'), 'dir')
    expect(payloadDigest(root)).toMatch(/^[a-f0-9]{64}$/)
  })
  it.each(['absolute', 'escape', 'broken', 'cycle', 'directory-cycle'])('rejects %s payload links', (kind) => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-unsafe-links-'))); dirs.push(parent)
    const root = join(parent, 'payload'); mkdirSync(root)
    writeFileSync(join(parent, 'outside'), 'outside')
    const target = kind === 'absolute' ? join(parent, 'outside')
      : kind === 'escape' ? '../outside'
        : kind === 'broken' ? 'missing'
          : kind === 'directory-cycle' ? '.' : 'loop'
    symlinkSync(target, join(root, 'link'), kind === 'directory-cycle' ? 'dir' : 'file')
    if (kind === 'cycle') symlinkSync('link', join(root, 'loop'))
    expect(() => payloadDigest(root)).toThrow()
  })
  it('rejects cycles between sibling directory aliases', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-directory-cycle-'))); dirs.push(root)
    mkdirSync(join(root, 'first')); mkdirSync(join(root, 'second'))
    symlinkSync('../second', join(root, 'first', 'next'), 'dir')
    symlinkSync('../first', join(root, 'second', 'next'), 'dir')
    expect(() => payloadDigest(root)).toThrow()
  })
  it('uses the physical payload root when an ancestor is aliased and rejects a linked root', () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'desktop-root-links-'))); dirs.push(parent)
    const actual = join(parent, 'actual'); mkdirSync(actual)
    const root = join(actual, 'payload'); mkdirSync(root)
    writeFileSync(join(parent, 'outside'), 'outside')
    symlinkSync('actual', join(parent, 'alias'), 'dir')
    writeFileSync(join(root, 'node'), 'node')
    expect(payloadDigest(join(parent, 'alias', 'payload'))).toBe(payloadDigest(root))
    symlinkSync('../../outside', join(root, 'escape'))
    expect(() => payloadDigest(join(parent, 'alias', 'payload'))).toThrow()
    symlinkSync('actual/payload', join(parent, 'linked-root'), 'dir')
    expect(() => payloadDigest(join(parent, 'linked-root'))).toThrow()
  })
  it('retains modified-source flags internally and refuses them for public qualification', () => {
    const release = { version: '1.2.3', commit: 'a'.repeat(40) }
    const fixture = {
      schemaVersion: 1, mode: 'internal', repository: 'AlataChan/deepseek-harness', ref: 'local', release,
      sourceState: { modifiedAtBuild: true, modifiedAtPackaging: true }, shellVersion: '1.0.0',
      target: 'macos-arm64', payloadSha256: 'b'.repeat(64),
      artifact: { name: 'test.dmg', bytes: 42, sha256: 'c'.repeat(64) },
    }
    expect(validateReleaseManifest(fixture).sourceState).toEqual(fixture.sourceState)
    const workflow = { path: '.github/workflows/desktop-macos.yml', commit: release.commit, runId: 1, attempt: 1, artifactName: 'candidate' }
    for (const sourceState of [
      fixture.sourceState,
      { modifiedAtBuild: true, modifiedAtPackaging: false },
      { modifiedAtBuild: false, modifiedAtPackaging: true },
    ]) {
      expect(() => validateReleaseManifest({ ...fixture, mode: 'public', sourceState, workflow })).toThrow('require clean')
    }
    expect(validateReleaseManifest({ ...fixture, mode: 'public', workflow,
      sourceState: { modifiedAtBuild: false, modifiedAtPackaging: false } }).mode).toBe('public')
    expect(() => validateReleaseManifest({ ...fixture, sourceState: undefined })).toThrow('modification flags')
    expect(() => validateReleaseManifest({ ...fixture, sourceState: { modifiedAtBuild: 'false', modifiedAtPackaging: false } })).toThrow('modification flags')
  })
  it('rejects unsupported or incomplete manifests at the file parser', () => {
    expect(() => validateReleaseManifest({ schemaVersion: 999 })).toThrow()
    expect(() => validateReleaseManifest({ schemaVersion: 1, mode: 'public' })).toThrow()
  })
})
