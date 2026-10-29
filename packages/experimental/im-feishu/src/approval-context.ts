/**
 * Private approval-context resolver for Feishu IM interactions.
 *
 * Resolves approval targets to either native tool calls or nested PTC inner dispatches
 * strictly within the currently open turn, ensuring that malformed, settled, stale,
 * cancelled, or out-of-scope calls fail closed.
 *
 * Security Note:
 * This resolver performs pure Session log metadata lookup. It is NOT an authentication
 * or authorization boundary; the ingress adapter owns verifying tenant identity,
 * user permissions, and Agent scope before presenting or executing decisions.
 *
 * @module @deepseek-ai/dsh-experimental-im-feishu/approval-context
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { ResolvedApprovalContext } from './types.ts'

/**
 * Request payload describing a pending approval question, matching actual
 * fields from `approval/request` ({@link ApprovalRequestEvent}).
 */
export interface ApprovalTargetQuery {
  /** Expected tool name being requested. */
  readonly toolName: string
  /** Tool call identifier (native callId or PTC subCallId). */
  readonly callId?: ToolCallId | undefined
  /** Optional cancellation signal for the pending request. */
  readonly signal?: AbortSignal | undefined
}

/**
 * Safely parse native tool call argument payload into a JsonValue object.
 * Returns undefined (unavailable) if the payload is malformed JSON or not an object.
 *
 * @param value - Raw arguments payload from tool/call event data.
 * @returns Parsed JsonValue object, or undefined on malformed syntax.
 */
function parseArgumentsPayload(value: unknown): JsonValue | undefined {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as JsonValue
      }
      return undefined
    } catch {
      return undefined
    }
  }
  if (typeof value === 'object' && value !== null) {
    return value as JsonValue
  }
  return undefined
}

/**
 * Resolve the tool execution context for an approval request within the active turn.
 *
 * Enforces strict fail-closed invariants:
 * 1. Aborted signals immediately fail resolution (cannot approve cancelled work).
 * 2. Missing or empty callId fails resolution.
 * 3. Settled calls (matching `tool/result` or `tool/ptc-dispatch` in the log) cannot be approved.
 * 4. Calls crossing `turn/end` or outside the active turn cannot be approved.
 * 5. Tool name mismatch fails resolution.
 * 6. Malformed argument JSON returns `undefined` (never a context with null/fallback arguments).
 *
 * @param events - Ordered slice or full list of Session events from the target session.
 * @param query - The pending tool request query (toolName, callId, optional signal).
 * @returns The resolved execution context, or `undefined` if resolution fails closed.
 */
export function resolveApprovalContext(
  events: readonly SessionEvent[],
  query: ApprovalTargetQuery,
): ResolvedApprovalContext | undefined {
  if (query.signal?.aborted) {
    return undefined
  }

  const callId = query.callId
  if (callId === undefined || callId === '') {
    return undefined
  }

  const expectedName = query.toolName
  if (expectedName.trim() === '') {
    return undefined
  }

  let settled = false

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event === undefined) continue

    // Never cross completed turn boundaries
    if (event.type === 'turn/end') {
      return undefined
    }

    // Detect settlement of native tool call
    if (event.type === 'tool/result') {
      if (event.data.message.toolCallId === callId) {
        settled = true
      }
    }

    // Detect settlement of nested PTC dispatch
    if (event.type === 'tool/ptc-dispatch') {
      if (event.data.subCallId === callId) {
        settled = true
      }
    }

    if (event.type === 'tool/call') {
      const data = event.data
      if (data.callId === callId) {
        if (settled || data.name !== expectedName) {
          return undefined
        }
        const parsedArgs = parseArgumentsPayload(data.arguments)
        if (parsedArgs === undefined) {
          return undefined
        }
        return {
          kind: 'native',
          callId,
          name: expectedName,
          arguments: parsedArgs,
        }
      }
    }

    if (event.type === 'tool/ptc-dispatch-start') {
      const data = event.data
      if (data.subCallId === callId) {
        if (settled || data.name !== expectedName) {
          return undefined
        }
        const parsedArgs = parseArgumentsPayload(data.arguments)
        if (parsedArgs === undefined) {
          return undefined
        }
        return {
          kind: 'ptc',
          subCallId: callId,
          rootCallId: data.rootCallId,
          parentCallId: data.parentCallId,
          name: expectedName,
          arguments: parsedArgs,
        }
      }
    }
  }

  return undefined
}
