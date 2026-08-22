/** Packed-install consumer manifest construction. */

import { describe, expect, it } from 'vitest'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { packedInstallEntry, packedInstallManifest, packedInstallNpmArguments } from './verify-packed-install.ts'

/** Create the source CLI member used to resolve target-specific entries. */
function cliMember(): ReleaseMember {
  return {
    directory: 'apps/cli',
    name: '@deepseek-ai/dsh',
    version: '0.1.1-rc.4',
    manifest: { name: '@deepseek-ai/dsh', version: '0.1.1-rc.4' },
  }
}

describe('packed install verification', () => {
  it('installs platform optional dependencies', () => {
    expect(packedInstallNpmArguments()).toEqual([
      'install',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
    ])
  })

  it('overrides transitive package ranges with the supplied tarballs', () => {
    const packed = new Map([
      ['@deepseek-ai/dsh-alpha', { url: 'file:///tmp/dsh-alpha.tgz', version: '0.1.0-rc.1' }],
      ['@deepseek-ai/dsh-bravo', { url: 'file:///tmp/dsh-bravo.tgz', version: '0.1.0-rc.1' }],
    ])

    expect(packedInstallManifest('dsh', packed)).toEqual({
      name: 'dsh-packed-install-dsh',
      version: '0.0.0',
      private: true,
      dependencies: {
        '@deepseek-ai/dsh-alpha': 'file:///tmp/dsh-alpha.tgz',
        '@deepseek-ai/dsh-bravo': 'file:///tmp/dsh-bravo.tgz',
      },
      overrides: {
        '@deepseek-ai/dsh-alpha': '$@deepseek-ai/dsh-alpha',
        '@deepseek-ai/dsh-bravo': '$@deepseek-ai/dsh-bravo',
      },
    })
  })

  it('selects the official installed entry when the target is omitted', () => {
    const packed = new Map([
      ['@deepseek-ai/dsh', { url: 'file:///tmp/dsh.tgz', version: '0.1.1-rc.4' }],
    ])

    expect(packedInstallEntry(releaseFamily('dsh'), undefined, [cliMember()], packed)).toEqual({
      entry: { packageName: '@deepseek-ai/dsh', binPath: 'lib/bin.js' },
      expected: { url: 'file:///tmp/dsh.tgz', version: '0.1.1-rc.4' },
    })
  })

  it('selects the projected entry and rejects a missing tarball', () => {
    const packed = new Map([
      ['@alatastudio/dsh', { url: 'file:///tmp/alatastudio-dsh.tgz', version: '0.1.1-rc.4' }],
    ])

    expect(packedInstallEntry(releaseFamily('dsh'), 'alatastudio', [cliMember()], packed)).toEqual({
      entry: { packageName: '@alatastudio/dsh', binPath: 'lib/bin.js' },
      expected: { url: 'file:///tmp/alatastudio-dsh.tgz', version: '0.1.1-rc.4' },
    })
    expect(() => { packedInstallEntry(releaseFamily('dsh'), 'alatastudio', [cliMember()], new Map()) })
      .toThrow(/@alatastudio\/dsh is not among the packed tarballs/)
  })

  it('rejects a projected target for the vendor family', () => {
    const vendor = {
      ...cliMember(),
      directory: 'vendor/cordis',
      name: '@deepseek-ai/cordis',
      manifest: { name: '@deepseek-ai/cordis', version: '4.0.0' },
      version: '4.0.0',
    }

    expect(() => { packedInstallEntry(releaseFamily('vendor'), 'alatastudio', [vendor], new Map()) })
      .toThrow(/target alatastudio.*family dsh/)
  })
})
