/** Packed DSH payload projection. */

import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { projectExtractedPackage, projectText } from './projection.ts'
import { resolvePublicationTarget } from './targets.ts'
import { assertSafeTarballPaths } from './tarball.ts'

/**
 * Create a release member for projection tests.
 * @param name - source package name.
 * @returns A minimal release member.
 */
function member(name: string): ReleaseMember {
  return {
    directory: `packages/test/${name.slice(name.lastIndexOf('/') + 1)}`,
    name,
    version: '0.1.1-rc.4',
    manifest: { name, version: '0.1.1-rc.4' },
  }
}

const members = [
  member('@deepseek-ai/dsh'),
  member('@deepseek-ai/dsh-alpha'),
  member('@deepseek-ai/dsh-alpha-long'),
  member('@deepseek-ai/dsh-tools'),
]
const target = resolvePublicationTarget('alatastudio', releaseFamily('dsh'), members)
const roots: string[] = []

/**
 * Create a temporary extracted package directory.
 * @returns The `package/` directory.
 */
function packageRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-projection-'))
  roots.push(root)
  const packageDirectory = join(root, 'package')
  mkdirSync(packageDirectory)
  return packageDirectory
}

/** Write one fixture file, creating its parent directory. */
function write(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('packed payload projection', () => {
  it('projects manifest keys and textual package references while preserving external packages', () => {
    const root = packageRoot()
    write(join(root, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/dsh-alpha',
      version: '0.1.1-rc.4',
      dependencies: {
        '@deepseek-ai/dsh': '^0.1.1-rc.4',
        '@deepseek-ai/cordis': '^4.0.0',
      },
      peerDependenciesMeta: { '@deepseek-ai/dsh-alpha-long': { optional: true } },
      exports: { './invariant': '@deepseek-ai/dsh-alpha-long/invariant' },
    }, null, 2)}\n`)
    write(join(root, 'lib/index.js'), "import '@deepseek-ai/dsh-alpha-long/invariant'\nimport '@deepseek-ai/cordis'\n")
    write(join(root, 'lib/index.d.ts'), "export * from '@deepseek-ai/dsh-alpha'\n")
    write(join(root, 'cordis.yml'), "plugin: '@deepseek-ai/dsh'\n")

    projectExtractedPackage(root, target)

    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      name: '@alatastudio/dsh-alpha',
      dependencies: {
        '@alatastudio/dsh': '^0.1.1-rc.4',
        '@deepseek-ai/cordis': '^4.0.0',
      },
      peerDependenciesMeta: { '@alatastudio/dsh-alpha-long': { optional: true } },
      exports: { './invariant': '@alatastudio/dsh-alpha-long/invariant' },
    })
    expect(readFileSync(join(root, 'lib/index.js'), 'utf8')).toBe(
      "import '@alatastudio/dsh-alpha-long/invariant'\nimport '@deepseek-ai/cordis'\n",
    )
    expect(readFileSync(join(root, 'lib/index.d.ts'), 'utf8')).toBe("export * from '@alatastudio/dsh-alpha'\n")
    expect(readFileSync(join(root, 'cordis.yml'), 'utf8')).toBe("plugin: '@alatastudio/dsh'\n")
  })

  it('matches the longest known package name and leaves similar prose untouched', () => {
    expect(projectText(
      '@deepseek-ai/dsh-alpha-long @deepseek-ai/dsh-alpha @deepseek-ai/dsh-like',
      target,
      'package/README.md',
    )).toBe('@alatastudio/dsh-alpha-long @alatastudio/dsh-alpha @deepseek-ai/dsh-like')
  })

  it('projects a source namespace prefix used as a package-name regular expression', () => {
    expect(projectText(
      "package_allowlist: ['^@deepseek-ai/dsh-']",
      target,
      'package/README.md',
    )).toBe("package_allowlist: ['^@alatastudio/dsh-']")
  })

  it('projects known package-derived runtime identifiers without accepting unknown dot suffixes', () => {
    expect(projectText(
      "Symbol('@deepseek-ai/dsh-tools.scheduler') @deepseek-ai/dsh-tools.unknown",
      target,
      'package/lib/index.js',
    )).toBe("Symbol('@alatastudio/dsh-tools.scheduler') @deepseek-ai/dsh-tools.unknown")
  })

  it('rejects an unresolved source-scope dsh package with its file context', () => {
    const root = packageRoot()
    write(join(root, 'package.json'), '{"name":"@deepseek-ai/dsh-alpha","version":"0.1.1-rc.4"}\n')
    write(join(root, 'lib/bad.js'), "import '@deepseek-ai/dsh-unknown'\n")

    expect(() => { projectExtractedPackage(root, target) })
      .toThrow(/lib\/bad\.js.*@deepseek-ai\/dsh-unknown/)
  })

  it('keeps binary files byte-identical and rejects residual names inside them', () => {
    const root = packageRoot()
    write(join(root, 'package.json'), '{"name":"@deepseek-ai/dsh-alpha","version":"0.1.1-rc.4"}\n')
    const binary = Buffer.from([0, 255, 1, 2, 3, 128])
    const binaryPath = join(root, 'assets/image.bin')
    write(binaryPath, binary)
    const before = createHash('sha256').update(binary).digest('hex')

    projectExtractedPackage(root, target)

    expect(createHash('sha256').update(readFileSync(binaryPath)).digest('hex')).toBe(before)

    const residual = Buffer.concat([Buffer.from([0, 255]), Buffer.from('@deepseek-ai/dsh-alpha')])
    const residualPath = join(root, 'assets/residual.bin')
    write(residualPath, residual)
    expect(() => { projectExtractedPackage(root, target) }).toThrow(/assets\/residual\.bin.*@deepseek-ai\/dsh-alpha/)
    expect(readFileSync(residualPath)).toEqual(residual)
  })

  it('rejects unsafe archive paths and symlinks that escape the package directory', () => {
    expect(() => { assertSafeTarballPaths(['package/package.json', '../outside']) })
      .toThrow(/unsafe tarball path/)
    expect(() => { assertSafeTarballPaths(['/package/package.json']) })
      .toThrow(/unsafe tarball path/)
    expect(() => { assertSafeTarballPaths(['other/package.json']) })
      .toThrow(/outside package/)

    const root = packageRoot()
    write(join(root, 'package.json'), '{"name":"@deepseek-ai/dsh-alpha","version":"0.1.1-rc.4"}\n')
    symlinkSync('../../outside', join(root, 'escape'))
    expect(() => { projectExtractedPackage(root, target) }).toThrow(/symlink.*escapes/)
  })
})
