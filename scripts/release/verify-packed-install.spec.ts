/** Packed-install consumer manifest construction. */

import { describe, expect, it } from 'vitest'
import { packedInstallManifest } from './verify-packed-install.ts'

describe('packed install verification', () => {
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
})
