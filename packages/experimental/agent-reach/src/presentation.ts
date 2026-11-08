/**
 * Pure presenters and durable metadata generators for Agent-Reach tools.
 *
 * @module @deepseek-ai/dsh-experimental-agent-reach/presentation
 */

import type { AgentReachError, AgentReachItem, AgentReachResult } from './types.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Canonical tool value projected to model text. */
export interface RenderQueryResultInput {
  readonly ok: boolean
  readonly channel: string
  readonly action: string
  readonly backend?: string | undefined
  readonly items: readonly (AgentReachItem | Record<string, unknown> | JsonValue)[]
  readonly meta: { readonly elapsedMs: number; readonly attempts?: readonly (string | JsonValue)[] | undefined }
  readonly accessScope: string
  readonly completeness: string
  readonly truncated?: boolean | undefined
  readonly error?: AgentReachError | undefined
}

/** Durable query facts rendered by the Client card. */
export type QueryPresentationMeta = {
  readonly kind: 'query'
  readonly channel: string
  readonly action: string
  readonly backend?: string
  readonly accessScope: string
  readonly itemCount: number
  readonly completeness: string
  readonly elapsedMs: number
  readonly truncated?: boolean
  readonly errorCode?: string
}

/** Durable discovery count; the catalog remains in model-visible text. */
export type ChannelsPresentationMeta = {
  readonly kind: 'channels'
  readonly channelCount: number
}

/** Local runtime status, without raw doctor payloads. */
export type StatusPresentationMeta = {
  readonly kind: 'status'
  readonly channel?: string
  readonly ok: boolean
  readonly version?: string
  readonly errorCode?: string
}

/** Durable setup state; installation details stay in the approved plan. */
export type SetupPresentationMeta = {
  readonly kind: 'setup'
  readonly channel: string
  readonly action: string
  readonly status: 'planned' | 'installed' | 'declined' | 'failed' | 'not_needed' | 'unsupported'
  readonly packagesCount?: number
  readonly planOnly?: boolean
}

/**
 * Format a human-readable text presentation of query results for the model.
 *
 * @param result - query result
 * @returns text block
 */
export function renderQueryResult(result: AgentReachResult | RenderQueryResultInput): string {
  if (!result.ok) {
    const err = result.error
    let msg = `Agent-Reach [${result.channel}/${result.action}] failed (${err?.code || 'ERROR'}): ${err?.message || 'Unknown failure'}`
    if (err?.hint) {
      msg += `\nHint: ${err.hint}`
    }
    if (result.items.length > 0) {
      return msg + '\nAvailable partial content:\n' + renderQueryResult({ ...result,ok:true,completeness:'partial' })
    }
    return msg
  }

  const items = result.items
  if (items.length === 0) {
    return `Agent-Reach [${result.channel}/${result.action}] returned 0 items (${result.meta.elapsedMs}ms).`
  }

  const lines = [
    `Agent-Reach [${result.channel}/${result.action}] returned ${items.length} item(s) [${result.accessScope}, ${result.completeness}]:`,
  ]

  let idx = 1
  for (const it of items) {
    if (typeof it !== 'object' || it === null) continue
    const item = it as Record<string, unknown>
    lines.push(`\n--- Item ${idx++} ---`)
    if (typeof item.title === 'string' && item.title) lines.push(`Title: ${item.title}`)
    if (typeof item.url === 'string' && item.url) lines.push(`URL: ${item.url}`)
    if (typeof item.author === 'string' && item.author) lines.push(`Author: ${item.author}`)
    if (typeof item.publishedAt === 'string' && item.publishedAt) lines.push(`Date: ${item.publishedAt}`)
    if (typeof item.text === 'string' && item.text) {
      lines.push(`Content:\n${item.text}`)
    }
  }

  if (result.truncated) {
    lines.push('\n[Note: Content was truncated due to output limit]')
  }

  return lines.join('\n')
}

/**
 * Extract durable presentation metadata from a query result.
 *
 * @param result - query result
 * @returns QueryPresentationMeta
 */
export function queryPresentationMeta(result: AgentReachResult | RenderQueryResultInput): QueryPresentationMeta {
  return {
    kind: 'query',
    channel: result.channel,
    action: result.action,
    accessScope: result.accessScope,
    itemCount: result.items.length,
    completeness: result.completeness,
    elapsedMs: result.meta.elapsedMs,
    ...(result.backend !== undefined ? { backend: result.backend } : {}),
    ...(result.truncated !== undefined ? { truncated: result.truncated } : {}),
    ...(result.error?.code !== undefined ? { errorCode: result.error.code } : {}),
  }
}
