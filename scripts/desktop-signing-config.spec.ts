/** CLI checks that do not require access to the operating-system signing store. */
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('configuration-only signing preflight', () => {
  it('accepts named public credentials without querying the keychain or importing a key', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', 'scripts/verify-desktop-release.ts', 'config-preflight', 'public', 'macos-arm64'], {
      encoding: 'utf8', env: { ...process.env, DSH_MAC_SIGNING_IDENTITY: 'Synthetic unavailable identity', DSH_MAC_TEAM_ID: 'SYNTHETIC', DSH_NOTARY_PROFILE: 'Unavailable profile' },
    })
    expect(result.status, result.stderr).toBe(0)
  })
  it('refuses missing public settings and invalid modes before unsigned assembly', () => {
    for (const mode of ['public', 'invalid']) {
      const result = spawnSync(process.execPath, ['--import', 'tsx/esm', 'scripts/verify-desktop-release.ts', 'config-preflight', mode, 'macos-arm64'], {
        encoding: 'utf8', env: { ...process.env, DSH_MAC_SIGNING_IDENTITY: '', DSH_MAC_TEAM_ID: '', DSH_NOTARY_PROFILE: '' },
      })
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/Public build requires|Expected internal or public mode/)
    }
  })
})
