/**
 * Boot one installed profile under a temporary home and report whether
 * `apply_patch` is registered. Desktop and persistent-question call
 * `process.exit` after startup, so the e2e runs this file in a child process.
 */

import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { provideCmdline, type AppReady } from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-tools'
import {
  boot,
  createRuntimeResolution,
  initProfile,
  loadProfile,
  PluginPackages,
  PROFILE_PATCH_FILENAME,
  PROFILE_TEMPLATES,
  type Profile,
  type ProfileContext,
} from '../src/index.ts'

const installAnchor = fileURLToPath(new URL('../../../../apps/cli/package.json', import.meta.url))
const persistentPreset = fileURLToPath(new URL(
  '../../../../packages/experimental/session-decisions/preset.cordis.yml',
  import.meta.url,
))
const BIN = 'apply-patch'

function applyPatchOf(config: unknown): unknown {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return undefined
  if (!('applyPatch' in config)) return undefined
  return config.applyPatch
}

/** Throw when the booted tree does not match the guarded apply_patch rule. */
export function assertInstalledBoot(ctx: Context, label: string, enabled: boolean): void {
  const entries = [...ctx.loader.entries()]
  const tools = entries.filter(entry => entry.options.id === 'tool-fs' && entry.options.disabled !== true)
  const policy = entries.filter(entry => entry.options.id === 'fs-observation-policy' && entry.options.disabled !== true)
  if (policy.length === 0) throw new Error(`${label}: observation policy is not mounted`)
  for (const entry of policy) {
    if (entry.options.disabled === true) throw new Error(`${label}: observation policy is disabled`)
    if (entry.fiber?.state !== FiberState.ACTIVE) throw new Error(`${label}: observation policy is not active`)
  }
  if (enabled) {
    if (!tools.some(entry => applyPatchOf(entry.options.config) === true)) {
      throw new Error(`${label}: no active tool-fs row opts in`)
    }
    if (!tools.some(entry => entry.fiber?.ctx.tools.get('apply_patch') !== undefined)) {
      throw new Error(`${label}: apply_patch is not registered`)
    }
    return
  }
  for (const entry of tools) {
    if (applyPatchOf(entry.options.config) === true) throw new Error(`${label}: tool-fs opts in by default`)
    if (entry.fiber?.ctx.tools.get('apply_patch') !== undefined) {
      throw new Error(`${label}: apply_patch is registered by default`)
    }
  }
}

/** Initialize a temporary home. Persistent-question copies the preset into its user layer. */
export function createInstalledHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-apply-patch-installed-'))
  const web = PROFILE_TEMPLATES.web
  if (web === undefined) throw new Error('web profile template is missing')
  const dir = join(home, 'profiles', 'persistent-question')
  initProfile(dir, web.bundles)
  copyFileSync(persistentPreset, join(dir, PROFILE_PATCH_FILENAME))
  return home
}

/** Boot one profile. The caller disposes `ctx` and removes `home`. */
export async function bootInstalled(
  home: string,
  name: string,
  extra: readonly PatchOptions[] = [],
  args: readonly string[] = [],
): Promise<Context> {
  const profile: Profile = loadProfile(BIN, name, installAnchor, home)
  const skipped = profile.skippedBundles.map(item => item.packageName)
  if (skipped.length > 0) throw new Error(`${name}: skipped bundles ${skipped.join(', ')}`)
  const rootConfig = join(profile.dir, 'cordis.yml')
  writeFileSync(rootConfig, '[]\n')
  const resolution = await createRuntimeResolution({ installAnchor, profile, home })
  const profileContext: ProfileContext = {
    name,
    dir: profile.dir,
    patchPath: profile.patchPath,
    installAnchor,
    cwd: process.cwd(),
    home,
    startedBundles: profile.layers.map(layer => layer.packageName),
    overlays: extra,
    telemetryDisabledEnv: undefined,
  }
  const ready: AppReady = { onReady: () => () => {} }
  return boot(BIN, rootConfig, [
    ...profile.layers.flatMap(layer => layer.patches),
    ...profile.patches,
    ...extra,
  ], async (host) => {
    host.provide('profileContext', profileContext)
    await host.plugin(PluginPackages, { resolution })
    provideCmdline(host, { args, exit: () => {}, ready })
  })
}

async function main(): Promise<void> {
  const name = process.argv[2]
  if (name !== 'desktop' && name !== 'persistent-question') {
    throw new Error('expected desktop or persistent-question')
  }
  const home = createInstalledHome()
  const args = name === 'desktop'
    ? ['--workspace-root', home]
    : ['--no-open', '--port', '0']
  let ctx: Context | undefined
  try {
    ctx = await bootInstalled(home, name, [], args)
    assertInstalledBoot(ctx, name, false)
    process.stdout.write(`apply-patch boot ok ${name}\n`)
  } finally {
    await ctx?.fiber.dispose()
    rmSync(home, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
