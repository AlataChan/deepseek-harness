/** Private interaction wire messages; raw tool arguments never cross this protocol. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ApprovalActionId } from './approval-actions.ts'
import { questionSchema, answerSchema, questionActionIdSchema } from './question-broker.ts'

const actorSchema = z.object({ provider: z.enum(['feishu', 'dingtalk']), appId: z.string().min(1), tenantId: z.string().min(1),
  chatId: z.string().min(1), senderId: z.string().min(1) }).strict()
/** Operator-bound poll of the current delivery's live interactions. */
export const listInteractionsRequestSchema = z.object({
  id: z.string().min(1), type: z.literal('list_interactions'), deliveryKey: z.string().min(1), operatorId: z.string().min(1),
}).strict()
/** Validated interaction poll. */
export type ListInteractionsRequest = z.infer<typeof listInteractionsRequestSchema>
/** Live cards contain redacted summaries or bounded question text only. */
export const listInteractionsResponseSchema = z.object({
  id: z.string().min(1), type: z.literal('list_interactions_ack'), deliveryKey: z.string().min(1),
  approvals: z.array(z.object({
    actionId: z.uuid().transform(value => brandString<ApprovalActionId>(value)), deliveryKey: z.string(), toolName: z.string(),
    summary: z.string().nullable(), expiresAt: z.number(), canAllow: z.boolean(),
  }).strict()),
  questions: z.array(z.object({ actionId: questionActionIdSchema, questions: z.array(questionSchema), expiresAt: z.number() }).strict()),
}).strict()
/** Validated redacted interaction list. */
export type ListInteractionsResponse = z.infer<typeof listInteractionsResponseSchema>
/** Verified platform callback identity accompanies an explicit structured answer. */
export const answerInteractionRequestSchema = z.object({
  id: z.string().min(1), type: z.literal('answer_interaction'), deliveryKey: z.string().min(1), operatorId: z.string().min(1),
  actor: actorSchema, actionId: z.uuid(),
  response: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('approval'), decision: z.enum(['allow', 'reject']) }).strict(),
    z.object({ kind: z.literal('question'), answer: answerSchema }).strict(),
  ]),
}).strict()
/** One explicit card response; natural-language consent cannot satisfy this type. */
export type AnswerInteractionRequest = z.infer<typeof answerInteractionRequestSchema>
/** Acceptance of a live answer does not claim that a tool executed. */
export const answerInteractionResponseSchema = z.object({
  id: z.string().min(1), type: z.literal('answer_interaction_ack'), accepted: z.boolean(),
}).strict()
/** Correlated consumption result. */
export type AnswerInteractionResponse = z.infer<typeof answerInteractionResponseSchema>
