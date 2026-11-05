/** Durable Host-wide Schedule tasks, independently of Session activation. */
import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { decodeScheduleRecord } from './domain.ts'
import type { ScheduleId, ScheduleRecord, ScheduleSessionCreateSpec } from './types.ts'

const recordSchema = z.unknown().transform((value, context): ScheduleRecord => {
  try {
    return decodeScheduleRecord(value)
  } catch (error: unknown) {
    context.addIssue({ code: 'custom', message: String(error) })
  }
  return z.NEVER
})

const instantSchema = z.iso.datetime({ precision: 3 }).refine(value => !value.startsWith('0000-'), {
  message: 'Expected a canonical four-digit-year UTC calendar instant',
})

const deliveryReceiptSchema = z.object({
  scheduledAt: instantSchema,
  deliveredAt: instantSchema,
  targetSessionId: z.string().min(1).transform(SessionId).optional(),
  messageId: z.string().min(1).refine(value => value.trim() === value).transform(MessageId),
}).strict()

const deliveryHistorySchema = z.object({
  records: z.array(deliveryReceiptSchema.extend({ prompt: z.string().optional() }).strict()),
  earlierRecordsUnavailable: z.boolean(),
  earlierRecordsPruned: z.boolean().optional(),
}).strict().refine(history => new Set(history.records.map(record => record.messageId)).size === history.records.length, {
  message: 'Delivery history message identities must be unique within a task',
})

const sessionIdSchema = z.string().min(1).refine(value => value.trim() === value).transform(SessionId)
const createSpecSchema = z.object({
  cwd: z.string().min(1).optional(), agentPreset: z.string().min(1).optional(),
}).strict().transform((value): ScheduleSessionCreateSpec => ({
  ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
  ...(value.agentPreset === undefined ? {} : { agentPreset: value.agentPreset }),
}))
const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), sessionId: sessionIdSchema }).strict(),
  z.object({ kind: z.literal('new_once'), sessionId: sessionIdSchema, create: createSpecSchema }).strict(),
  z.object({ kind: z.literal('new'), create: createSpecSchema }).strict(),
])

/** Current task rows also decode the released v1 binding without writing during open. */
export const scheduleTaskSchema = z.object({
  sessionId: sessionIdSchema.optional(),
  target: targetSchema.optional(),
  involvedSessionIds: z.array(sessionIdSchema).optional(),
  record: recordSchema,
  status: z.enum(['active', 'paused', 'ended', 'inactive']).default('active'),
  createdAt: instantSchema.optional(),
  updatedAt: instantSchema.optional(),
  pendingDelivery: z.object({ targetSessionId: sessionIdSchema }).strict().optional(),
  lastDelivery: deliveryReceiptSchema.optional(),
  deliveryHistory: deliveryHistorySchema.optional(),
}).strict().transform(({ sessionId, target: savedTarget, lastDelivery, deliveryHistory, ...task }, context) => {
  const target = savedTarget ?? (sessionId === undefined ? undefined : { kind: 'session' as const, sessionId })
  if (target === undefined) {
    context.addIssue({ code: 'custom', message: 'A task requires a target or a released Session binding' })
    return z.NEVER
  }
  const receipt = <T extends z.infer<typeof deliveryReceiptSchema>>(value: T): T & { targetSessionId: SessionId } => {
    if (value.targetSessionId !== undefined) return { ...value, targetSessionId: value.targetSessionId }
    if (target.kind === 'new') {
      context.addIssue({ code: 'custom', message: 'A fresh-Session delivery requires a target Session receipt' })
      return z.NEVER
    }
    return { ...value, targetSessionId: target.sessionId }
  }
  return {
    ...task, target,
    status: task.status === 'inactive' ? 'ended' as const : task.status,
    involvedSessionIds: task.involvedSessionIds ?? (target.kind === 'new' ? [] : [target.sessionId]),
    ...(lastDelivery === undefined ? {} : { lastDelivery: receipt(lastDelivery) }),
    ...(deliveryHistory === undefined ? {} : {
      deliveryHistory: { ...deliveryHistory, records: deliveryHistory.records.map(value => receipt(value)) },
    }),
  }
}).refine((task) => {
  if (task.deliveryHistory === undefined) return true
  const latest = task.deliveryHistory.records.at(-1)
  if (latest === undefined) return task.lastDelivery === undefined
  return task.lastDelivery !== undefined
    && latest.scheduledAt === task.lastDelivery.scheduledAt
    && latest.deliveredAt === task.lastDelivery.deliveredAt
    && latest.messageId === task.lastDelivery.messageId
    && latest.targetSessionId === task.lastDelivery.targetSessionId
}, { message: 'Last delivery must match the latest saved delivery receipt' })

/** Persistent task value; absent history retains only its legacy last receipt without a read-time rewrite. */
export type ScheduleTask = z.infer<typeof scheduleTaskSchema>

/** Authoritative Schedule storage; malformed tasks reject opening the domain. */
export const scheduleDomain = defineDomain({
  name: 'schedule', version: 2, compatibleVersions: [1],
  tables: { tasks: domainTable<ScheduleId, ScheduleTask>(scheduleTaskSchema) },
})
