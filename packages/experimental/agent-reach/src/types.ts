/**
 * Domain types, branded identifiers, and result models for Agent-Reach.
 *
 * @module @deepseek-ai/dsh-experimental-agent-reach/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ResolvedAgentReachConfig, ChannelDefinition } from './catalog.ts'

/** Opaque identity for one adapter execution. */
export type AgentReachExecutionId = Branded<'AgentReachExecutionId'>

/** Observed access mode; permission alone does not imply session access. */
export type AccessScope = 'public' | 'native' | 'session'

/** Explicit content completeness, including unverified and truncated results. */
export type Completeness = 'complete' | 'truncated' | 'partial' | 'snippet' | 'unknown'

/**
 * Whitelisted, sanitized public item extracted from upstream channel output.
 * Never retains arbitrary nested payload blobs, cookies, or raw protocol records.
 */
export interface AgentReachItem {
  readonly url?: string | undefined
  readonly title?: string | undefined
  readonly author?: string | undefined
  readonly publishedAt?: string | undefined
  readonly text?: string | undefined
}

/** Whitelisted execution evidence; arbitrary upstream metadata is excluded. */
export interface AgentReachMeta {
  readonly elapsedMs: number
  readonly attempts: readonly string[]
  readonly accessMode?: string | undefined
  readonly completenessVerified?: boolean | undefined
}

/** Stable failure code with scrubbed diagnostic text. */
export interface AgentReachError {
  readonly code: string
  readonly message: string
  readonly hint?: string | undefined
}

/** Bounded read result consumed by tools and pure presenters. */
export interface AgentReachResult {
  readonly ok: boolean
  readonly channel: string
  readonly action: string
  readonly backend?: string | undefined
  readonly items: readonly AgentReachItem[]
  readonly meta: AgentReachMeta
  readonly error?: AgentReachError | undefined
  readonly accessScope: AccessScope
  readonly completeness: Completeness
  readonly truncated?: boolean | undefined
}

/** One read request; backend and parameters are validated before execution. */
export interface AgentReachExecutionRequest {
  readonly channel: string
  readonly action: string
  readonly params?: Record<string, unknown> | undefined
  readonly backend?: string | undefined
  readonly timeoutMs?: number | undefined
  readonly signal?: AbortSignal | undefined
}

/** Read-only collision inspection, including inability to inspect. */
export type ToolResolutionResult =
  | { readonly found: false; readonly isShadowedConflict?: false; readonly inspectionError?: false }
  | { readonly found: true; readonly isShadowedConflict: true; readonly shadowPath: string; readonly inspectionError?: false }
  | { readonly found: false; readonly inspectionError: true; readonly error: string; readonly isShadowedConflict?: false }

/** Shared platform-read service used by the model tools. */
export interface AgentReachService {
  readonly config: ResolvedAgentReachConfig
  /**
   * Run one validated read through the owned transient runtime.
   * @param request - Exact action, backend, inputs and cancellation.
   * @returns Bounded public result or an explicit refusal.
   */
  query(request: AgentReachExecutionRequest): Promise<AgentReachResult>
  /**
   * Inspect the local static action catalog without spawning.
   * @returns Checked-in channel definitions.
   */
  channels(): Promise<{ ok: boolean; channels: readonly ChannelDefinition[] }>
  /**
   * Inspect installed prerequisites without installing or logging in.
   * @param channel - Optional known platform filter.
   * @returns Bounded cached doctor facts or a setup diagnostic.
   */
  status(channel?: string): Promise<{ ok: boolean; doctor?: unknown; version?: string | undefined; error?: AgentReachError | undefined }>
}
