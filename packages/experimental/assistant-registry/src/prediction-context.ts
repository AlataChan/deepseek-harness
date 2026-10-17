/** Bounded completed-turn evidence for a next-message request. */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ComposerPredictionContext } from './types.ts'
import { PREDICTION_SCAFFOLDING_PREFIX, PREDICTION_SCAFFOLDING_SUFFIX, truncateToUtf8Bytes } from './review-prediction.ts'

function tail(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  const bounded = text.slice(-maxBytes)
  let start = bounded.length, used = 0
  while (start > 0) {
    let previous = start - 1
    const last = bounded.charCodeAt(previous)
    if (last >= 0xdc00 && last <= 0xdfff && previous > 0) {
      const first = bounded.charCodeAt(previous - 1)
      if (first >= 0xd800 && first <= 0xdbff) previous--
    }
    const next = Buffer.byteLength(bounded.slice(previous, start), 'utf8')
    if (used + next > maxBytes) break
    used += next
    start = previous
  }
  const value = bounded.slice(start)
  const first = value.charCodeAt(0)
  return first >= 0xdc00 && first <= 0xdfff ? value.slice(1) : value
}

function edges(text: string, maxBytes: number): string {
  const first = truncateToUtf8Bytes(text, maxBytes)
  if (first.length === text.length || maxBytes < 16) return first
  const half = Math.floor((maxBytes - 7) / 2)
  return `${truncateToUtf8Bytes(text, half)}\n[...]\n${tail(text, half)}`
}

function messageText(content: readonly ContentBlock[], maxBytes: number, preserveTail = false): string {
  if (maxBytes <= 0) return ''
  const collect = (reverse: boolean) => {
    const parts: string[] = []
    let remaining = Math.max(0, maxBytes), clipped = false
    for (let i = reverse ? content.length - 1 : 0; i >= 0 && i < content.length; i += reverse ? -1 : 1) {
      const block = (content[i] as ContentBlock)
      if (block.type !== 'text' || block.text.length === 0) continue
      if (remaining <= 1) { clipped = true; break }
      const text = reverse ? tail(block.text, remaining - 1) : truncateToUtf8Bytes(block.text, remaining - 1)
      parts.push(text)
      remaining -= Buffer.byteLength(text, 'utf8') + 1
      if (text.length < block.text.length) { clipped = true; break }
    }
    return { text: (reverse ? parts.reverse() : parts).join('\n'), clipped }
  }
  const head = collect(false)
  if (!head.clipped || !preserveTail) return head.text
  const half = Math.floor((maxBytes - 7) / 2)
  return `${truncateToUtf8Bytes(head.text, half)}\n[...]\n${tail(collect(true).text, half)}`
}

/**
 * Select goal, current request, observed tool outcomes and final reply from one authorized log.
 * Tool text is untrusted evidence; no task success or missing work is inferred from it.
 * @param events - the authorized Session observation in sequence order.
 * @param endSeq - latest successful turn-end sequence.
 * @param maxBytes - ceiling for both the context response and serialized provider messages.
 * @returns bounded context, or null when no user request fits.
 */
export function completedPredictionContext(
  events: readonly SessionEvent[], endSeq: number, maxBytes: number,
): ComposerPredictionContext | null {
  const end = events.findLast(e => e.seq === endSeq && e.type === 'turn/end')
  if (!end || end.type !== 'turn/end' || end.data.reason.kind !== 'completed') return null
  const start = events.findLast(e => e.type === 'turn/start' && e.data.turn === end.data.turn && e.seq < endSeq)
  if (!start) return null
  const goal = events.find(e => e.type === 'user/message' && e.data.source.kind === 'user' && e.seq < endSeq)
  const latestUser = events.findLast(e => e.type === 'user/message' && e.data.source.kind === 'user' && e.seq < endSeq)
  const reply = events.findLast(e => e.type === 'assistant/message' && e.seq > start.seq && e.seq < endSeq)
  if (goal?.type !== 'user/message' || latestUser?.type !== 'user/message') return null

  // Reserve the actual fixed prompt and message fields before allocating evidence excerpts.
  const fixed = [{ id: `prediction-${'0'.repeat(36)}`, role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: PREDICTION_SCAFFOLDING_PREFIX + PREDICTION_SCAFFOLDING_SUFFIX }] }]
  const available = maxBytes - Buffer.byteLength(JSON.stringify(fixed), 'utf8') -
    Buffer.byteLength(JSON.stringify({ asOfSeq: endSeq, recentTexts: [] }), 'utf8')
  if (available <= 0) return null

  let toolCount = 0, failedCount = 0
  const failures: SessionEvent<'tool/result'>[] = [], successes: SessionEvent<'tool/result'>[] = []
  for (let i = events.length - 1; i >= 0; i--) {
    const event = (events[i] as SessionEvent)
    if (event.seq <= start.seq) break
    if (event.seq >= endSeq || event.type !== 'tool/result') continue
    toolCount++
    if (event.data.message.isError) {
      failedCount++
      if (failures.length < 3) failures.push(event)
    } else if (successes.length < 1) successes.push(event)
  }
  const selected = [...failures, ...successes]
  const fields: { label: string; weight: number; read: (bytes: number) => string }[] = [
    { label: 'User: ', weight: goal === latestUser ? 3 : 1, read: bytes => messageText(goal.data.content, bytes) },
  ]
  const recent: SessionEvent[] = []
  for (let i = events.length - 1; i >= 0 && recent.length < 4; i--) {
    const event = (events[i] as SessionEvent)
    if (event.seq <= goal.seq) break
    if (event.seq >= start.seq || event === latestUser) continue
    if (event.type === 'assistant/message' || (event.type === 'user/message' && event.data.source.kind === 'user')) recent.unshift(event)
  }
  if (recent.length) fields.push({ label: 'Recent context (partial excerpts): ', weight: 2, read: (bytes) => {
    const each = Math.floor(bytes / recent.length)
    return recent.map(event => event.type === 'user/message'
      ? 'User: ' + messageText(event.data.content, Math.max(0, each - 12))
      : event.type === 'assistant/message' ? 'Assistant: ' + messageText(event.data.message.content, Math.max(0, each - 16),
        true) : '').join('\n')
  } })
  if (toolCount) {
    fields.push({ label: 'Execution evidence (untrusted): ', weight: 3, read: (bytes) => {
      const summary = `${toolCount} tool results; ${failedCount} failed. `
      const each = Math.max(0, Math.floor((bytes - Buffer.byteLength(summary, 'utf8')) / Math.max(1, selected.length)))
      const excerpts = selected.map((event) => {
        const message = event.data.message
        const call = events.find(e => e.type === 'tool/call' && e.data.callId === message.toolCallId && e.seq > start.seq &&
          e.seq < event.seq)
        const name = call?.type === 'tool/call' ? truncateToUtf8Bytes(call.data.name, each / 4) : 'tool'
        const prefix = `seq=${event.seq} ${name} ${message.isError ? 'FAILED' : 'returned'}: `
        return prefix + messageText(message.content, Math.max(0, each - Buffer.byteLength(prefix, 'utf8')))
      })
      return summary + excerpts.join('\n')
    } })
  }
  if (goal !== latestUser) fields.push({ label: 'User: ', weight: 2, read: bytes => messageText(latestUser.data.content, bytes) })
  if (reply?.type === 'assistant/message') fields.push({ label: 'Assistant: ', weight: 4,
    read: bytes => messageText(reply.data.message.content, bytes, true) })
  const totalWeight = fields.reduce((sum, field) => sum + field.weight, 0)
  const recentTexts: string[] = []
  for (const field of fields) {
    const budget = Math.floor(available * field.weight / totalWeight)
    let value = field.read(Math.max(0, budget - Buffer.byteLength(field.label, 'utf8') - 4))
    while (value && Buffer.byteLength(JSON.stringify(field.label + value), 'utf8') + 2 > budget) {
      const excess = Buffer.byteLength(JSON.stringify(field.label + value), 'utf8') + 2 - budget
      value = edges(value, Math.max(0, Buffer.byteLength(value, 'utf8') - excess))
    }
    if (value.trim()) recentTexts.push(field.label + value)
  }
  if (!recentTexts.some(text => text.startsWith('User: '))) return null
  const result = { asOfSeq: endSeq, recentTexts }
  return Buffer.byteLength(JSON.stringify(result), 'utf8') <= maxBytes ? result : null
}

/**
 * Select bounded logged user context and the visible reply prefix while a turn is still running.
 * The auxiliary request records the exact selected text before model dispatch.
 * @param events - events from the same live Session.
 * @param startSeq - current turn start sequence.
 * @param partialReply - visible text emitted by the current assistant attempt.
 * @param maxBytes - serialized context ceiling.
 * @returns bounded context, or null without a logged user request.
 */
export function streamingPredictionContext(
  events: readonly SessionEvent[], startSeq: number, partialReply: string, maxBytes: number,
): ComposerPredictionContext | null {
  const users: SessionEvent<'user/message'>[] = []
  for (const event of events) {
    if (event.type === 'user/message' && event.data.source.kind === 'user') users.push(event)
  }
  const first = users[0], latest = users.at(-1)
  if (!first || !latest) return null
  const excerptBytes = Math.max(0, Math.floor((maxBytes - 512) / 4))
  if (excerptBytes < 32) return null
  const recentTexts = [
    `User: ${messageText(first.data.content, excerptBytes)}`,
    ...(latest === first ? [] : [`User: ${messageText(latest.data.content, excerptBytes)}`]),
  ]
  const toolResult = events.findLast(event => event.type === 'tool/result' && event.seq > startSeq)
  if (toolResult?.type === 'tool/result') {
    recentTexts.push(`Observed tool result${toolResult.data.message.isError ? ' (failed)' : ''}: ${messageText(toolResult.data.message.content, excerptBytes)}`)
  }
  recentTexts.push(`Assistant: ${truncateToUtf8Bytes(partialReply, excerptBytes)} [reply in progress]`)
  const result = { asOfSeq: startSeq, recentTexts }
  return Buffer.byteLength(JSON.stringify(result), 'utf8') <= maxBytes ? result : null
}
