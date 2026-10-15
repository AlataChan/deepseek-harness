/** Durable auxiliary model requests, outcomes and observed billing. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, type GenerateOptions, type TokenUsage, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type { UsageAggregator } from './cursors-usage.ts'
import type { AuxiliaryUsageRecord } from './types.ts'

/** A tool-free auxiliary call's observed output and accounting. */
export interface AuxiliaryInferenceResult {
  readonly text: string
  readonly finish: string
  readonly usage?: TokenUsage
  readonly record?: AuxiliaryUsageRecord
}

/**
 * Checkpoint request before dispatch and outcome after stream settlement, including failures.
 * @param ctx - live service context.
 * @param accounting - durable auxiliary billing owner.
 * @param sessionId - exact owning session.
 * @param asOfSeq - completed turn or explicit manual review revision.
 * @param purpose - auxiliary task.
 * @param options - resolved model request, including cancellation.
 * @returns observed output, terminal outcome and billed usage.
 */
export async function runAuxiliaryInference(
  ctx: Context,
  accounting: UsageAggregator,
  sessionId: SessionId,
  asOfSeq: number,
  purpose: 'memory_review' | 'prediction',
  options: GenerateOptions,
): Promise<AuxiliaryInferenceResult> {
  const sessions = ctx.get('sessions') as SessionStore | undefined
  const session = sessions?.get(sessionId)
  if (!sessions || !session) throw new Error('Auxiliary inference requires a live owning session')
  const id = `aux-${randomUUID()}`
  const identity = { id, purpose, asOfSeq, provider: options.provider, model: options.model }
  session.append('assistant/auxiliary', {
    ...identity, phase: 'request', messages: options.messages, maxTokens: options.maxTokens ?? 0,
  })
  await sessions.flush(session)
  const assembler = new BlockAssembler()
  const llm = ctx.get('llm') as LlmRuntime | undefined
  if (!llm) throw new Error('Auxiliary inference requires the model runtime')
  let finish = 'error'
  try {
    for await (const chunk of llm.stream(options)) assembler.push(chunk)
    finish = assembler.finish?.kind ?? 'error'
  } catch (error) {
    // Provider failures are normalized by LlmRuntime; middleware failures retain observed chunks.
    finish = options.signal?.aborted ? 'aborted' : 'error'
    ctx.logger.debug('Auxiliary inference failed: %s', error)
  }
  const usage = assembler.usage
  const text = assembler.blocks().filter(b => b.type === 'text').map(b => b.text).join('')
  const metrics = usage ? {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens ?? usage.inputTokens + usage.outputTokens,
  } : undefined
  session.append('assistant/auxiliary', {
    ...identity, phase: 'result', text, finish, ...metrics ? { usage: metrics } : {},
  })
  await sessions.flush(session)
  let record: AuxiliaryUsageRecord | undefined
  if (metrics && metrics.totalTokens > 0) {
    record = { ...identity, sessionId, seq: asOfSeq, usage: metrics, timestamp: Date.now() }
    await accounting.recordAuxiliaryUsage(record)
  }
  return { text, finish, ...usage ? { usage } : {}, ...record ? { record } : {} }
}
