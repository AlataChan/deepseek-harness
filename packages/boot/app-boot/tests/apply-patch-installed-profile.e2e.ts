/**
 * Installed-profile bootstrap for guarded apply_patch.
 * Profiles are initialized under a temporary home and booted through the
 * same Loader path as `dsh --profile`. Bundle patches resolve from the
 * workspace installation. This file is the proof to run after the built
 * runtime exists; it does not read or write the user's Harness home.
 * Desktop and persistent-question exit the process after startup, so those
 * two boots run in a child.
 */

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  assertInstalledBoot,
  bootInstalled,
  createInstalledHome,
} from './apply-patch-installed-boot.ts'

const bootScript = fileURLToPath(new URL('./apply-patch-installed-boot.ts', import.meta.url))
const homes: string[] = []

afterAll(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function childBoot(name: 'desktop' | 'persistent-question'): void {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', bootScript, name], {
    cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
    encoding: 'utf8',
    timeout: 180_000,
  })
  expect(result.stdout, result.stderr).toContain(`apply-patch boot ok ${name}`)
  expect(result.status, result.stderr).toBe(0)
}

describe('installed apply_patch profile boot', () => {
  it('boots headless with apply_patch off and observation policy active', async () => {
    const home = createInstalledHome()
    homes.push(home)
    const ctx = await bootInstalled(home, 'headless')
    try {
      assertInstalledBoot(ctx, 'headless', false)
    } finally {
      await ctx.fiber.dispose()
    }
  }, 180_000)

  it('boots a headless user opt-in without disabling observation policy', async () => {
    const home = createInstalledHome()
    homes.push(home)
    const ctx = await bootInstalled(home, 'headless', [{ id: 'tool-fs', config: { applyPatch: true } }])
    try {
      assertInstalledBoot(ctx, 'headless opt-in', true)
    } finally {
      await ctx.fiber.dispose()
    }
  }, 180_000)

  it('boots desktop with apply_patch off and observation policy active', () => {
    childBoot('desktop')
  }, 180_000)

  it('boots persistent-question with apply_patch off and observation policy active', () => {
    childBoot('persistent-question')
  }, 180_000)
})
