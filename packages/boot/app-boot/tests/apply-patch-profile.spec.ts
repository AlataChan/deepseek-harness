/**
 * Effective profile composition for guarded apply_patch.
 * Layers go through the same overlay parser and `composeEntries` call boot uses.
 * This does not import a profile package or start its plugins.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { DshBundleManifest } from '@deepseek-ai/dsh-package-manifest'
import { bundlePatchFiles, composeEntries, loadOverlayPatches } from '../src/index.ts'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const temps: string[] = []

afterEach(async () => {
  await Promise.all(temps.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

interface Row {
  id?: string
  disabled?: unknown
  config?: unknown
}

function bundlePatches(relativeDir: string) {
  const manifest = JSON.parse(readFileSync(join(repoRoot, relativeDir, 'package.json'), 'utf8')) as {
    dsh?: { bundle?: DshBundleManifest }
  }
  const bundle = manifest.dsh?.bundle
  if (bundle === undefined) throw new Error(`${relativeDir} declares no dsh.bundle`)
  return bundlePatchFiles(bundle).flatMap(file => loadOverlayPatches('apply-patch', join(repoRoot, relativeDir, file)))
}

function rows(value: unknown, found: Row[] = []): Row[] {
  if (Array.isArray(value)) {
    for (const item of value) rows(item, found)
    return found
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.id === 'string') found.push(record)
    for (const child of Object.values(record)) rows(child, found)
  }
  return found
}

function applyPatchValue(row: Row): unknown {
  if (row.config === null || typeof row.config !== 'object' || Array.isArray(row.config)) return undefined
  return Reflect.get(row.config, 'applyPatch')
}

function assertDefaultOff(entries: unknown, label: string): void {
  const found = rows(entries)
  const tools = found.filter(row => row.id === 'tool-fs')
  const policy = found.filter(row => row.id === 'fs-observation-policy')
  expect(tools.length, label).toBeGreaterThan(0)
  expect(policy.length, label).toBeGreaterThan(0)
  for (const row of tools) expect(applyPatchValue(row), `${label} tool-fs`).not.toBe(true)
  for (const row of policy) expect(row.disabled, `${label} observation`).not.toBe(true)
}

async function overlay(source: string) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-apply-patch-profile-'))
  temps.push(dir)
  const file = join(dir, 'cordis.patch.yml')
  await writeFile(file, source)
  return loadOverlayPatches('apply-patch', file)
}

describe('resolved apply_patch profile composition', () => {
  const base = bundlePatches('packages/bundle/base')
  const headless = bundlePatches('packages/bundle/headless')
  const web = bundlePatches('packages/bundle/web-app')
  const desktop = bundlePatches('packages/bundle/desktop-app')
  const persistent = loadOverlayPatches('apply-patch', join(
    repoRoot, 'packages/experimental/session-decisions/preset.cordis.yml',
  ))

  it('keeps apply_patch off and observation policy enabled for headless, desktop, and persistent-question', () => {
    assertDefaultOff(composeEntries([base, headless]), 'headless')
    assertDefaultOff(composeEntries([base, web, desktop]), 'desktop')
    assertDefaultOff(composeEntries([base, web, persistent]), 'persistent-question')
  })

  it('lets an explicit user overlay enable apply_patch without disabling observation policy', async () => {
    const enabled = await overlay([
      '- id: tool-fs',
      '  config:',
      '    applyPatch: true',
    ].join('\n'))
    const entries = composeEntries([base, headless, enabled])
    const tools = rows(entries).filter(row => row.id === 'tool-fs')
    expect(tools.some(row => applyPatchValue(row) === true)).toBe(true)
    for (const row of rows(entries).filter(item => item.id === 'fs-observation-policy')) {
      expect(row.disabled).not.toBe(true)
    }
  })

  it('sees an overlay that disables observation policy', async () => {
    const disabled = await overlay([
      '- id: fs-observation-policy',
      '  disabled: true',
    ].join('\n'))
    const policy = rows(composeEntries([base, headless, disabled])).filter(row => row.id === 'fs-observation-policy')
    expect(policy.some(row => row.disabled === true)).toBe(true)
  })
})
