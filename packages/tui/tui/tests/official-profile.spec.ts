import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadProfile, composeEntries, PROFILE_TEMPLATES } from '@deepseek-ai/dsh-app-boot'

describe('T6 Official Profile Acceptance', () => {
  it('loads the tui profile template from clean DSH_HOME without source fallback', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'dsh-tui-home-'))
    const installAnchor = join(process.cwd(), 'apps/cli/package.json')

    try {
      expect(PROFILE_TEMPLATES.tui).toBeDefined()
      expect(PROFILE_TEMPLATES.tui?.bundles).toEqual([
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-tui-bundle',
      ])

      const profile = loadProfile('dsh', 'tui', installAnchor, tmpHome)
      expect(profile.name).toBe('tui')
      expect(profile.skippedBundles).toHaveLength(0)

      const bundleNames = profile.layers.map(layer => layer.packageName)
      expect(bundleNames).toContain('@deepseek-ai/dsh-base')
      expect(bundleNames).toContain('@deepseek-ai/dsh-tui-bundle')

      const entries = composeEntries(profile.layers.map(layer => layer.patches))
      const tuiEntry = entries.find(e => e.name === '@deepseek-ai/dsh-tui' || e.id === 'tui')
      expect(tuiEntry).toBeDefined()
      expect(tuiEntry?.name).toBe('@deepseek-ai/dsh-tui')
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })
})
