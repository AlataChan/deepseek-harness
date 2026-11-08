import { runtimePlatformQualified } from './runtime-lock.ts'
import { RUNTIME_LOCK_ID, RUNTIME_MANIFEST_DIGEST } from './runtime-lock.ts'
/**
 * Frozen installation plan calculation for action-scoped Agent-Reach setup.
 *
 * Computes deterministic package requirements, destinations, and side-effects
 * without making network requests.
 *
 * @module @deepseek-ai/dsh-experimental-agent-reach/setup-plan
 */

import * as path from 'node:path'
import lock from '../dependency-lock.json' with { type:'json' }
import { RUNTIME_CONTRACT, validateRoute } from './catalog.ts'
import type { AgentReachConfig, SideEffect } from './catalog.ts'

/** Exact package version, destination and license disclosed before acquisition. */
export interface PlannedPackage {
  readonly toolKey?: string
  readonly name: string
  readonly version: string
  readonly role: 'core' | 'tool' | 'bootstrap' | 'build'
  readonly destinationVenv: 'core' | 'tools' | 'runtime' | 'builder'
  readonly license: string
}

/** Frozen action-specific acquisition plan tied to a complete manifest digest. */
export interface SetupPlan {
  readonly channel: string
  readonly action: string
  readonly backend?: string
  readonly manifestDigest: string
  readonly lockId: string
  readonly releaseRoot: string
  readonly packages: readonly PlannedPackage[]
  readonly sideEffects: readonly SideEffect[]
  readonly needsCoreInstall: boolean
  readonly needsToolInstall: boolean
  readonly isFullyProvisioned: boolean
  readonly licenseSummary: readonly string[]
}

/**
 * Compute the frozen installation plan for a specific channel/action route.
 *
 * @param channel - target channel
 * @param action - target action
 * @param declaredBackend - optional declared backend
 * @param config - active configuration
 * @param dshHome - active DSH home directory
 * @param isCoreInstalled - whether the core runtime is already present
 * @param installedTools - map of already installed tool names
 * @returns SetupPlan or failure
 */
export function computeSetupPlan(
  channel: string,
  action: string,
  declaredBackend?: string,
  config: AgentReachConfig = RUNTIME_CONTRACT.defaultConfiguration,
  dshHome: string = path.join(process.env.HOME || '/tmp', '.dsh'),
  isCoreInstalled: boolean = false,
  installedTools: ReadonlySet<string> = new Set(),
): { ok: true; plan: SetupPlan } | { ok: false; error: string; code:'INVALID_ROUTE' | 'UNSUPPORTED' } {
  // Validate route syntax and channel existence
  const routeRes = validateRoute(channel, action, declaredBackend, config)
  if (!routeRes.ok) {
    return { ok: false, code:'INVALID_ROUTE', error: `Cannot compute setup plan for invalid route: ${routeRes.message}` }
  }

  const lockId = RUNTIME_LOCK_ID
  const releaseRoot = path.join(dshHome, 'runtimes', 'agent-reach', 'releases', lockId)

  if (!runtimePlatformQualified()) return { ok:false,code:'UNSUPPORTED',error:'Runtime installation is currently qualified only on macOS arm64' }
  const target = lock.platforms['darwin-arm64']
  const needsCore = !isCoreInstalled
  const needsBili = routeRes.reachableBackends.some(backend => backend.name === 'bili-cli')
  const needsTool = needsBili && !installedTools.has('bili-cli')
  const unsupported = routeRes.reachableBackends.find(backend => ['opencli', 'boss-agent-cli', 'gh'].includes(backend.name))
  if (unsupported) return { ok:false,code:'UNSUPPORTED',error:`No frozen installer for backend ${unsupported.name}` }
  const packagesToInstall: PlannedPackage[] = []
  if (needsCore || needsTool) {
    packagesToInstall.push(
      { name:'uv',version:lock.uvVersion,role:'bootstrap',destinationVenv:'runtime',license:'MIT OR Apache-2.0' },
      { name:'CPython',version:lock.pythonVersion,role:'bootstrap',destinationVenv:'runtime',license:'Python-2.0' },
      { name:'agent-reach',version:RUNTIME_CONTRACT.upstream.version,role:'core',destinationVenv:'core',license:'MIT' },
    )
    for (const group of ['build','core', ...(needsBili ? ['bili'] : [])] as const) {
      const artifacts = group === 'build' ? target.wheels.build : group === 'core' ? target.wheels.core : target.wheels.bili
      for (const artifact of artifacts) packagesToInstall.push({
        name:artifact.name,version:artifact.version,license:artifact.license.split('\n', 1).join('').slice(0,160),
        role:group === 'bili' ? 'tool' : group === 'build' ? 'build' : 'core',
        destinationVenv:group === 'bili' ? 'tools' : group === 'build' ? 'builder' : 'core',
        ...(artifact.name === 'bilibili-cli' ? { toolKey:'bili-cli' } : {}),
      })
    }
  }
  if ((needsCore || needsTool) && needsBili) {
    for (const source of lock.supplementalSources) packagesToInstall.push({
      name:source.name,version:source.version,license:source.license,role:'tool',destinationVenv:'tools',
    })
  }
  const licenses = new Set(packagesToInstall.map(pkg => pkg.license))
  const isFullyProvisioned = !needsCore && !needsTool

  return {
    ok: true,
    plan: {
      channel: routeRes.channel.name,
      action: routeRes.action.name,
      ...(declaredBackend !== undefined ? { backend: declaredBackend } : {}),
      manifestDigest:RUNTIME_MANIFEST_DIGEST,
      lockId,
      releaseRoot,
      packages: packagesToInstall,
      sideEffects: routeRes.requiredEffects,
      needsCoreInstall: needsCore,
      needsToolInstall: needsTool,
      isFullyProvisioned,
      licenseSummary: Array.from(licenses),
    },
  }
}
