/** Target-aware release packing through real npm tarballs. */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { packReleaseMembers } from './pack.ts'
import { resolvePublicationTarget } from './targets.ts'
import { packedIdentity, PUBLISH_ORDER_FILE, readPublishOrder } from './tarball.ts'

const VERSION = '0.1.1-rc.4'
const roots: string[] = []

/** Write one fixture file, creating its parent directory. */
function write(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/**
 * Create one packable source package and its release member.
 * @param root - fixture repository root.
 * @param name - source package name.
 * @param dependencies - runtime dependencies.
 * @returns Release member for the package.
 */
function writePackage(root: string, name: string, dependencies: Record<string, string>): ReleaseMember {
  const suffix = name === '@deepseek-ai/dsh' ? 'cli' : name.slice('@deepseek-ai/dsh-'.length)
  const directory = join(root, suffix)
  const manifest = {
    name,
    version: VERSION,
    type: 'module',
    files: ['lib', 'cordis.yml', 'assets'],
    scripts: { prepack: 'node prepack.mjs' },
    dependencies,
  }
  write(join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  write(join(directory, 'prepack.mjs'), "import { mkdirSync, writeFileSync } from 'node:fs'; mkdirSync('lib', { recursive: true }); writeFileSync('lib/prepacked.txt', 'once\\n')\n")
  write(join(directory, 'lib/index.js'), "export { name } from '@deepseek-ai/dsh-alpha/invariant'\n")
  write(join(directory, 'lib/index.d.ts'), "export * from '@deepseek-ai/dsh-alpha'\n")
  write(join(directory, 'cordis.yml'), "plugin: '@deepseek-ai/dsh'\n")
  write(join(directory, 'assets/payload.bin'), Buffer.from([0, 255, 1, 2, 128]))
  return { directory, name, version: VERSION, manifest }
}

/**
 * Create the two-package fixture in dependency order.
 * @returns Fixture root, members, and source binary bytes.
 */
function fixture(): { root: string; members: ReleaseMember[]; binary: Buffer } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pack-target-'))
  roots.push(root)
  const binary = Buffer.from([0, 255, 1, 2, 128])
  const cli = writePackage(root, '@deepseek-ai/dsh', {
    '@deepseek-ai/dsh-alpha': VERSION,
    '@deepseek-ai/cordis': '^4.0.0',
  })
  const alpha = writePackage(root, '@deepseek-ai/dsh-alpha', {})
  return { root, members: [alpha, cli], binary }
}

/** Read one file from an npm tarball as bytes. */
function tarballFile(tarball: string, path: string): Buffer {
  return execFileSync('tar', ['-xOzf', tarball, `package/${path}`])
}

/** Return a tarball's SHA-512 digest. */
function digest(path: string): string {
  return createHash('sha512').update(readFileSync(path)).digest('hex')
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('release pack projection', () => {
  it('packs projected identities and deterministic payloads through the normal lifecycle', () => {
    const { root, members, binary } = fixture()
    const family = releaseFamily('dsh')
    const target = resolvePublicationTarget('alatastudio', family, members)
    const first = join(root, 'first')
    const second = join(root, 'second')

    packReleaseMembers(family, members, target, first)
    packReleaseMembers(family, members, target, second)

    expect(readPublishOrder(first)).toEqual([
      `alatastudio-dsh-alpha-${VERSION}.tgz`,
      `alatastudio-dsh-${VERSION}.tgz`,
    ])
    const alphaTarball = join(first, `alatastudio-dsh-alpha-${VERSION}.tgz`)
    const cliTarball = join(first, `alatastudio-dsh-${VERSION}.tgz`)
    expect(packedIdentity(alphaTarball)).toEqual({ name: '@alatastudio/dsh-alpha', version: VERSION })
    expect(packedIdentity(cliTarball)).toEqual({ name: '@alatastudio/dsh', version: VERSION })

    const cliManifest = JSON.parse(tarballFile(cliTarball, 'package.json').toString('utf8')) as Record<string, unknown>
    expect(cliManifest).toMatchObject({
      name: '@alatastudio/dsh',
      dependencies: {
        '@alatastudio/dsh-alpha': VERSION,
        '@deepseek-ai/cordis': '^4.0.0',
      },
    })
    expect(tarballFile(cliTarball, 'lib/index.js').toString('utf8'))
      .toBe("export { name } from '@alatastudio/dsh-alpha/invariant'\n")
    expect(tarballFile(cliTarball, 'lib/index.d.ts').toString('utf8'))
      .toBe("export * from '@alatastudio/dsh-alpha'\n")
    expect(tarballFile(cliTarball, 'cordis.yml').toString('utf8')).toBe("plugin: '@alatastudio/dsh'\n")
    expect(tarballFile(cliTarball, 'assets/payload.bin')).toEqual(binary)
    expect(tarballFile(cliTarball, 'lib/prepacked.txt').toString('utf8')).toBe('once\n')

    for (const filename of readPublishOrder(first)) {
      expect(digest(join(first, filename))).toBe(digest(join(second, filename)))
    }
  })

  it('does not authorize publication when one projected member fails', () => {
    const { root, members } = fixture()
    const family = releaseFamily('dsh')
    const target = resolvePublicationTarget('alatastudio', family, members)
    const destination = join(root, 'failed')
    write(join(members[1]!.directory, 'lib/index.js'), "import '@deepseek-ai/dsh-unknown'\n")

    expect(() => { packReleaseMembers(family, members, target, destination) })
      .toThrow(/unresolved source DSH package reference/)
    expect(existsSync(join(destination, PUBLISH_ORDER_FILE))).toBe(false)
    expect(readdirSync(destination).some(name => name.startsWith('alatastudio-dsh-') && !name.includes('-alpha-')))
      .toBe(false)
  })
})
