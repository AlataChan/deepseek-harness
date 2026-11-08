/**
 * Agent-Reach lightweight platform reader and lazy dependency setup plugin.
 *
 * @module @deepseek-ai/dsh-experimental-agent-reach
 */

import type {} from '@deepseek-ai/dsh-system-prompt'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  type AgentReachConfig,
  validateConfig,
} from './catalog.ts'
import { reachGuidance } from './guidance.ts'
import { AgentReachRunner } from './runner.ts'
import { AgentReachSetupService } from './setup.ts'
import { registerReachTools } from './tools.ts'
import type { AgentReachService } from './types.ts'

export {
  buildSafeArgv,
  decodeRuntimeContract,
  findAction,
  findChannel,
  RUNTIME_CONTRACT,
  validateConfig,
  validateRoute,
  type ActionDefinition,
  type AgentReachConfig,
  type BackendDefinition,
  type ChannelDefinition,
  type ParamDefinition,
  type RouteTuple,
  type RouteValidationResult,
  type SideEffect,
} from './catalog.ts'
export { AGENT_REACH_GUIDANCE } from './guidance.ts'
export {
  INSTALLATION_RECORD_SCHEMA_VERSION,
  readInstallationRecord,
  validateInstallationRecord,
  writeInstallationRecordAtomic,
  type InstallationRecord,
  type InstalledToolEntry,
} from './installation-record.ts'
export {
  queryPresentationMeta,
  renderQueryResult,
  type ChannelsPresentationMeta,
  type QueryPresentationMeta,
  type SetupPresentationMeta,
  type StatusPresentationMeta,
} from './presentation.ts'
export { AgentReachRunner, checkShadowedTools, type RunnerDependencies } from './runner.ts'
export { AgentReachSetupService, type SetupExecutionOptions, type SetupExecutionResult } from './setup.ts'
export {
  computeSetupPlan,
  type PlannedPackage,
  type SetupPlan,
} from './setup-plan.ts'
export { registerReachTools, type ReachToolsRegistrationOptions } from './tools.ts'
export type {
  AccessScope,
  AgentReachError,
  AgentReachExecutionRequest,
  AgentReachItem,
  AgentReachMeta,
  AgentReachResult,
  AgentReachService,
  Completeness,
  ToolResolutionResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentReach: AgentReachService
  }
}

/** Plugin identifier for Cordis loading. */
export const name = 'experimental-agent-reach'

/** Wait for subprocess and tools seams; systemPrompt is optional. */
export const inject = ['subprocess', 'tools']

/** Deployment configuration for reading and separately approved setup. */
export interface Config extends AgentReachConfig {
  /** Expose the narrow frozen-runtime installer in ordinary sessions. */
  enableSetupTool?: boolean
}

/** Runtime configuration schema with strict bounds and defaults. */
export const Config: z<Config> = z.object({
  runtimeOverride: z.string(),
  enabledChannels: z.array(z.string()).default(['bilibili', 'youtube', 'v2ex']),
  sessionAccessRoutes: z.array(z.string()).default([]),
  allowExperimentalChannels: z.boolean().default(false),
  setupTimeoutMs: z.number().default(900000),
  queryTimeoutMs: z.number().default(90000),
  maxConcurrentQueries: z.number().default(4),
  maxStdoutBytes: z.number().default(1048576),
  maxStderrBytes: z.number().default(32768),
  maxOutputChars: z.number().default(24000),
  maxItems: z.number().default(20),
  terminateGraceMs: z.number().default(5000),
  enableSetupTool: z.boolean().default(true),
}) as z<AgentReachConfig & { enableSetupTool?: boolean }>

/**
 * Mount the Agent-Reach execution service, setup infrastructure, and model tools.
 *
 * @param ctx - Cordis Context
 * @param config - validated plugin configuration
 */
export function apply(ctx: Context, config: Config): void {
  const validation = validateConfig(config)
  if (!validation.valid) {
    throw new Error(`Invalid agent-reach configuration: ${validation.error}`)
  }

  const runner = new AgentReachRunner(ctx, config)
  const setupService = new AgentReachSetupService(ctx, config)

  // Provide service
  ctx.provide('agentReach', runner)

  ctx.inject(['systemPrompt'], scope => scope.systemPrompt.section({
    name:'agent-reach:guidance',order:95,text:() => reachGuidance(config.enableSetupTool !== false),
  }))

  // Register tools
  ctx.effect(
    () =>
      registerReachTools(ctx, runner, setupService, {
        enableSetupTool: config.enableSetupTool !== false,
      }),
    'agent-reach.tools',
  )
}
