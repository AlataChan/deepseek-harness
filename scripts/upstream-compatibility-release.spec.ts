import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const versions = {
  cordis: '4.0.5', cosmokit: '1.8.6', group: '1.0.5', hmr: '1.0.20', include: '1.0.10',
  loader: '1.0.6', 'logger-console': '1.0.5', schemastery: '3.18.5', timer: '1.1.7',
}
const requiredPaths = [
  ...Object.keys(versions).map(name => `vendor/${name}/package.json`),
  'vendor/timer/locale/en.json', 'vendor/timer/locale/zh.json', 'pnpm-lock.yaml', 'vendor/README.md',
  'scripts/upstream-compatibility-policy.ts', 'scripts/verify-upstream-intake.ts',
  'scripts/upstream-compatibility-release.spec.ts', 'scripts/verify-upstream-intake.spec.ts',
  'packages/boot/plugin-manager/tests/manager.spec.ts',
]

function readManifest(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(join(root, path), 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Invalid manifest: ${path}`)
  return value as Record<string, unknown>
}

it('ships the approved stable vendor metadata and timer locale exports', () => {
  for (const [name, version] of Object.entries(versions)) {
    const manifest = readManifest(`vendor/${name}/package.json`)
    expect(manifest.version, name).toBe(version)
  }
  const loader = readManifest('vendor/loader/package.json')
  expect(loader.peerDependencies).toMatchObject({ 'node-addon-require-builtin': '^0.1.9' })
  const timer = readManifest('vendor/timer/package.json')
  expect(timer.exports).toMatchObject({ './locale/*.json': './locale/*.json' })
  expect(timer.files).toContain('locale')
  for (const locale of ['en', 'zh']) {
    expect(JSON.parse(readFileSync(join(root, `vendor/timer/locale/${locale}.json`), 'utf8'))).toBeTypeOf('object')
  }
})

/** Execute the unchanged shipped CLI against a disposable Git repository. */
function runCli(omitted?: string, advancePin = false): ReturnType<typeof spawnSync> {
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-intake-cli-')))
  try {
    mkdirSync(join(fixture, 'scripts'))
    writeFileSync(join(fixture, 'package.json'), '{"type":"module"}\n')
    for (const name of ['verify-upstream-intake.ts', 'upstream-compatibility-policy.ts']) {
      if (existsSync(join(root, 'scripts', name))) cpSync(join(root, 'scripts', name), join(fixture, 'scripts', name))
    }
    cpSync(join(root, 'scripts/cordis-yaml.ts'), join(fixture, 'scripts/cordis-yaml.ts'))
    symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'junction')
    const pin = advancePin ? 'dsh-v0.2.1-rc.2' : 'dsh-v0.2.1-alpha.1'
    const entry = {
      id: 'C1', sourceTag: 'dsh-v0.2.1-rc.2', basePin: pin, sourceChanges: ['Stable vendor release metadata'],
      disposition: 'adapted', paths: requiredPaths.filter(path => path !== omitted), prerequisites: [],
      verification: ['scripts/upstream-compatibility-release.spec.ts'],
    }
    const exports = {
      UPSTREAM_PIN: pin, BACKPORTS: omitted === 'C1' ? [] : [entry],
      IGNORABLE_INSPECTION: { eventTypes: [], inspectedLogs: 0, envelopeKeys: [], conclusion: 'required-not-ignorable' },
      NEVER_MERGE: [], PATCHES: [], MOUNTS: [], REMOVALS: [], GATED_PACKAGE_NAMES: [], RELEASE_COMPOSITIONS: [],
      FORK_OWNED_PATHS: [], UPSTREAM_ONLY_DIRECTORIES: [], FORBIDDEN_DEPENDENCIES: [], GUARDED_MANIFESTS: [],
      FORBIDDEN_ENDPOINTS: [],
    }
    writeFileSync(join(fixture, 'scripts/upstream-intake-registry.ts'), Object.entries(exports)
      .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)}`).join('\n') + '\n')
    const git = (args: string[]) => execFileSync('git', ['-C', fixture, ...args], { stdio: 'pipe' })
    git(['init', '-q']); git(['add', '.'])
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid', 'commit', '-qm', 'fixture'])
    git(['tag', pin])
    const hook = fileURLToPath(import.meta.resolve('tsx/esm'))
    return spawnSync(process.execPath, ['--import', hook, join(fixture, 'scripts/verify-upstream-intake.ts')], {
      cwd: fixture, encoding: 'utf8', timeout: 20_000,
    })
  } finally {
    const modules = join(fixture, 'node_modules')
    if (existsSync(modules)) unlinkSync(modules)
    rmSync(fixture, { recursive: true, force: true })
  }
}

describe('executed compatibility intake gate', () => {
  it('accepts complete C1 ownership at the retained whole-release pin', () => {
    const result = runCli()
    expect(result.error).toBeUndefined()
    expect(result.status, String(result.stderr)).toBe(0)
    expect(String(result.stdout)).toContain('verify-upstream-intake: intake complete')
  })
  for (const omitted of ['vendor/cordis/package.json', 'vendor/timer/locale/zh.json', 'C1']) {
    it(`rejects missing ownership: ${omitted}`, () => {
      const result = runCli(omitted)
      expect(result.error).toBeUndefined()
      expect(result.status, String(result.stderr)).toBe(1)
      expect(String(result.stderr)).toContain(omitted)
    })
  }
  it('rejects a pin advance even when all backport records advance with it', () => {
    const result = runCli(undefined, true)
    expect(result.error).toBeUndefined()
    expect(result.status, String(result.stderr)).toBe(1)
    expect(String(result.stderr)).toContain('whole-release pin')
  })
})
