import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeClientBuildRecord } from './client-build-environment.ts'
import { desktopArtifactIdentity, resolveDesktopBuildMode } from './desktop-artifact-identity.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-artifact-identity-'))
  roots.push(root)
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  write('.gitignore', '.dsh-build/\napps/web/dist/\n')
  write('apps/cli/package.json', '{"version":"1.2.3"}\n')
  write('source.txt', 'first\n')
  git('init'); git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture')
  const release = { version: '1.2.3', commit: git('rev-parse', 'HEAD') }
  write('apps/web/dist/index.html', 'built client')
  const record = (dirty = false) => writeClientBuildRecord(root, {
    DSH_CLIENT_RELEASE_VERSION: release.version, DSH_CLIENT_RELEASE_COMMIT: release.commit,
    ...(dirty ? { DSH_CLIENT_GIT_DIRTY: 'true' } : {}),
  })
  record()
  return { root, write, git, release, record }
}

describe('desktop artifact build identity', () => {
  it('uses the completed build identity and refuses changed artifact bytes', () => {
    const f = fixture()
    expect(desktopArtifactIdentity(f.root, 'public')).toEqual({ release: f.release, sourceState: { modifiedAtBuild: false, modifiedAtPackaging: false } })
    f.write('apps/web/dist/index.html', 'changed')
    expect(() => desktopArtifactIdentity(f.root, 'public')).toThrow('artifacts differ')
  })
  it('refuses a changed HEAD instead of relabeling earlier built bytes', () => {
    const f = fixture()
    f.write('source.txt', 'second\n'); f.git('add', '.')
    f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'next')
    expect(() => desktopArtifactIdentity(f.root, 'public')).toThrow('source differs')
  })
  it('allows internal modified builds and retains both source-state flags', () => {
    const f = fixture()
    f.record(true)
    expect(desktopArtifactIdentity(f.root, 'internal')).toEqual({
      release: f.release, sourceState: { modifiedAtBuild: true, modifiedAtPackaging: false },
    })
    f.write('source.txt', 'uncommitted\n')
    expect(desktopArtifactIdentity(f.root, 'internal')).toEqual({
      release: f.release, sourceState: { modifiedAtBuild: true, modifiedAtPackaging: true },
    })
    f.record(false)
    expect(desktopArtifactIdentity(f.root, 'internal').sourceState)
      .toEqual({ modifiedAtBuild: false, modifiedAtPackaging: true })
  })
  it('refuses changed HEAD and altered Client bytes even for internal builds', () => {
    const f = fixture()
    f.write('source.txt', 'next\n'); f.git('add', '.')
    f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'next')
    expect(() => desktopArtifactIdentity(f.root, 'internal')).toThrow('source differs')
    f.write('apps/web/dist/index.html', 'tampered')
    expect(() => desktopArtifactIdentity(f.root, 'internal')).toThrow('artifacts differ')
  })
  it('resolves an omitted mode as internal and refuses unsupported modes', () => {
    expect(resolveDesktopBuildMode(undefined)).toBe('internal')
    expect(resolveDesktopBuildMode('public')).toBe('public')
    expect(() => resolveDesktopBuildMode('publci')).toThrow('must be internal or public')
  })
  it('refuses dirty source both at build time and at packaging time', () => {
    const f = fixture()
    f.record(true)
    expect(() => desktopArtifactIdentity(f.root, 'public')).toThrow('dirty source build')
    f.record(); f.write('source.txt', 'uncommitted\n')
    expect(() => desktopArtifactIdentity(f.root, 'public')).toThrow('clean Git checkout')
  })
})
