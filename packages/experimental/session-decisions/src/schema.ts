/**
 * Storage-domain declaration for the decision aggregate: one record per
 * question, keyed by the record's UUID. Whole-domain validation at open is
 * the failure mode: one invalid record fails the whole open with
 * `invalid-record`, and the owning service isolates that failure as an
 * unavailable feature — records are never quarantined or skipped. Durable
 * value validation lives here: decision IDs must be server-minted RFC 4122
 * v4 UUIDs (the inert `[0-9a-f-]` alphabet pinned by B0), every durable
 * timestamp must be a valid ISO-8601 UTC `Z` instant, the answer digest must
 * be canonical lowercase SHA-256 hex, and `notificationRefs` must be a
 * {@link JsonValue}. Ordinary Session IDs and request IDs stay plain
 * non-empty strings — no UUID restriction is invented for them. Id fields
 * brand through `z.infer`, keeping {@link DecisionRecord} the single
 * hand-written type. Record-key equality and duplicate-open detection at
 * open are store-owner responsibilities, not schema validation.
 * @module @deepseek-ai/dsh-experimental-session-decisions/schema
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { DecisionId, DecisionRecord } from './types.ts'

const sessionIdSchema = z.string().min(1).transform(value => brandString<SessionId>(value))
const requestIdSchema = z.string().min(1).transform(value => brandString<SessionRequestId>(value))

/**
 * Canonical lowercase RFC 4122 v4 UUID format with the inert `[0-9a-f-]`
 * alphabet pinned by B0 (no `/`, `@`, `[`, `(`, or `:` can reach human
 * authority through a tampered record). Format validation does not prove
 * factory issuance — only the server minting path does; it guarantees that
 * records not minted as factory v4 UUIDs never decode.
 */
const DECISION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const decisionIdSchema = z.string().regex(DECISION_ID_RE).transform(value => brandString<DecisionId>(value))

/**
 * Canonical lowercase SHA-256 hex of the exact submitted payload; computed
 * by the owning service before any durable write.
 */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/

/**
 * Durable timestamp: a real ISO-8601 UTC `Z` instant from the maintained
 * `z.iso.datetime` validator — offsets, lowercase `z`, and calendar
 * rollover (`02-30`, month `13`) are refused natively.
 */
const utcTimestampSchema = z.iso.datetime({ offset: false })

/** JSON-only value for persisted notification references; no `unknown` widening. */
const jsonValueSchema: z.ZodType<JsonValue> = z.json()

/** Discriminated answer pointer; null while no answer was reserved. */
const answerPointerSchema = z.object({
  requestId: requestIdSchema,
  choiceOrdinal: z.number().int().positive().optional(),
  digest: z.string().regex(SHA256_HEX_RE).optional(),
})

/** Full record envelope validated at every open and every durable write. */
export const decisionRecordSchema = z.object({
  formatVersion: z.literal(1),
  decisionId: decisionIdSchema,
  sessionId: sessionIdSchema,
  createdAtUtc: utcTimestampSchema,
  expiresAtUtc: utcTimestampSchema,
  revision: z.number().int().nonnegative(),
  question: z.string(),
  choices: z.array(z.object({ label: z.string() })).readonly(),
  lifecycle: z.enum(['open', 'answered', 'expired', 'cancelled', 'superseded']),
  answerIndex: z.enum([
    'none',
    'submitting',
    'admitted',
    'needs_reconciliation',
    'withdrawn',
    'dismissed',
  ]),
  answer: answerPointerSchema.nullable(),
  notificationRefs: jsonValueSchema.optional(),
  // Optional and backward compatible: records written before the anchor
  // existed stay valid (domain version 1 unchanged, no migration).
  contextAnchorSeq: z.number().int().nonnegative().optional(),
  closedAtUtc: utcTimestampSchema.optional(),
  resolution: z.object({ kind: z.literal('dismissed'), atUtc: utcTimestampSchema }).optional(),
  suspension: z.object({ reason: z.string(), sinceUtc: utcTimestampSchema }).nullable().optional(),
})

/** Storage-domain version 1: separate from per-record `formatVersion`. */
export const decisionsDomain = defineDomain({
  name: 'session_decisions',
  version: 1,
  tables: {
    decisions: domainTable<string, DecisionRecord>(decisionRecordSchema),
  },
})

/** Storage-domain table name holding every decision record. */
export const DECISIONS_TABLE = 'decisions' as const
