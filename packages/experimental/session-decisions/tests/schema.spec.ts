/**
 * Durable value validation of the decision record schema: the exact schema
 * instance the storage domain validates at open. Covers server-minted UUID
 * v4 decision IDs, ISO-8601 UTC `Z` timestamps on every durable field,
 * canonical SHA-256 hex digests, JSON-only notification refs, and future
 * `formatVersion` refusal — plus the real durable decode path through a
 * storage-domain open over a tampered medium.
 * @module tests/schema
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { DomainError } from '@deepseek-ai/dsh-storage-domain'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { DECISIONS_TABLE, decisionRecordSchema, decisionsDomain } from '../src/schema.ts'

/** A real SHA-256 digest in canonical form; fixtures must use real hashes. */
function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload).digest('hex')
}

/** A schema-valid record exactly as the store writes it. */
function validRecord(): Record<string, unknown> {
  return {
    formatVersion: 1,
    decisionId: randomUUID(),
    sessionId: 'session-1',
    createdAtUtc: '2026-01-01T00:00:00.000Z',
    expiresAtUtc: '2026-01-02T00:00:00.000Z',
    revision: 0,
    question: 'Which database?',
    choices: [{ label: 'Postgres' }],
    lifecycle: 'open',
    answerIndex: 'none',
    answer: null,
    notificationRefs: { revision: 0 },
  }
}

function tampered(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...validRecord(), ...overrides }
}

function parseFails(record: unknown): boolean {
  return !decisionRecordSchema.safeParse(record).success
}

describe('decisionId', () => {
  it('accepts factory-minted UUID v4 records', () => {
    for (let index = 0; index < 8; index++) {
      expect(decisionRecordSchema.safeParse(validRecord()).success).toBe(true)
    }
  })

  it('refuses tampered, path, gesture, and mention ids before branding', () => {
    const hostile = [
      '',
      '../../etc/passwd',
      '/deploy-prod',
      '@[other](dsh-session:session-9)',
      'x'.repeat(36),
      `${randomUUID()}-extra`,
      randomUUID().replaceAll('-', ''),
    ]
    for (const decisionId of hostile) {
      expect(parseFails(tampered({ decisionId })), decisionId).toBe(true)
    }
  })

  it('refuses non-v4 versions, uppercase, and bad variants', () => {
    const uppercase = randomUUID().toUpperCase()
    const v1 = `${randomUUID().slice(0, 14)}1${randomUUID().slice(15)}`
    const v7 = `${randomUUID().slice(0, 14)}7${randomUUID().slice(15)}`
    const badVariant = `${randomUUID().slice(0, 19)}c${randomUUID().slice(20)}`
    for (const decisionId of [uppercase, v1, v7, badVariant]) {
      expect(parseFails(tampered({ decisionId })), decisionId).toBe(true)
    }
  })
})

describe('durable timestamps', () => {
  /** Every record field that persists a timestamp, addressed through its override. */
  const timestampFields: { name: string; override: (value: string) => Record<string, unknown> }[] = [
    { name: 'createdAtUtc', override: value => ({ createdAtUtc: value }) },
    { name: 'expiresAtUtc', override: value => ({ expiresAtUtc: value }) },
    { name: 'closedAtUtc', override: value => ({ closedAtUtc: value, lifecycle: 'expired' }) },
    { name: 'resolution.atUtc', override: value => ({ resolution: { kind: 'dismissed', atUtc: value } }) },
    { name: 'suspension.sinceUtc', override: value => ({ suspension: { reason: 'pause', sinceUtc: value } }) },
  ]

  it.each(timestampFields)('accepts valid UTC instants in $name', ({ override }) => {
    for (const value of ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00Z', '2026-12-31T23:59:59.999Z', '0001-01-01T00:00:00Z']) {
      expect(parseFails(tampered(override(value))), value).toBe(false)
    }
  })

  it.each(timestampFields)('refuses malformed and non-UTC values in $name', ({ override }) => {
    const invalid = [
      '',
      'not-a-date',
      '2026-01-01',
      '2026-01-01T00:00:00',
      '2026-01-01T00:00:00+01:00',
      '2026-01-01T00:00:00+00:00',
      '2026-01-01T00:00:00.000z',
      '2026-02-30T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:00:00.000Z ',
      'NaN',
    ]
    for (const value of invalid) {
      expect(parseFails(tampered(override(value))), value).toBe(true)
    }
  })

  it('refuses non-string timestamp values', () => {
    for (const value of [1767225600000, null, Number.NaN, new Date(0)]) {
      expect(parseFails(tampered({ createdAtUtc: value }))).toBe(true)
    }
  })
})

describe('answer digest', () => {
  it('accepts a canonical real SHA-256 hex digest', () => {
    const record = tampered({
      answerIndex: 'submitting',
      answer: { requestId: 'request-1', choiceOrdinal: 1, digest: sha256Hex('payload') },
    })
    expect(parseFails(record)).toBe(false)
  })

  it('accepts an absent digest and rejects placeholder or non-canonical values', () => {
    const noDigest = tampered({ answerIndex: 'submitting', answer: { requestId: 'request-1', choiceOrdinal: 1 } })
    expect(parseFails(noDigest)).toBe(false)
    const invalid = [
      'd1',
      sha256Hex('payload').slice(1),
      `${sha256Hex('payload')}0`,
      sha256Hex('payload').toUpperCase(),
      'g'.repeat(64),
      null,
    ]
    for (const digest of invalid) {
      expect(parseFails(tampered({
        answerIndex: 'submitting',
        answer: { requestId: 'request-1', choiceOrdinal: 1, digest },
      })), String(digest).slice(0, 12)).toBe(true)
    }
  })
})

describe('notificationRefs', () => {
  it('accepts arbitrary JSON values and preserves them through the parse', () => {
    const values: unknown[] = [
      null,
      true,
      0,
      -3.5,
      'text',
      [],
      { channels: ['desktop'], retries: 2, nested: { deep: [null, { flag: false }] } },
    ]
    for (const notificationRefs of values) {
      const parsed = decisionRecordSchema.safeParse(tampered({ notificationRefs }))
      expect(parsed.success, JSON.stringify(notificationRefs)).toBe(true)
      if (parsed.success) {
        expect(parsed.data.notificationRefs).toEqual(notificationRefs)
      }
    }
  })

  it('refuses non-JSON values', () => {
    const invalid: unknown[] = [Number.NaN, Number.POSITIVE_INFINITY, () => {}, Symbol('x')]
    for (const notificationRefs of invalid) {
      expect(parseFails(tampered({ notificationRefs }))).toBe(true)
    }
  })
})

describe('formatVersion', () => {
  it('refuses future and malformed versions', () => {
    for (const formatVersion of [2, 0, 1.5, '1', null]) {
      expect(parseFails(tampered({ formatVersion })), String(formatVersion)).toBe(true)
    }
  })
})

describe('storage-domain wiring', () => {
  it('validates records with the exact schema declared in the domain', () => {
    expect(decisionsDomain.tables.decisions.valueSchema).toBe(decisionRecordSchema)
    expect(decisionsDomain.tables[DECISIONS_TABLE].valueSchema).toBe(decisionRecordSchema)
  })
})

describe('durable decode', () => {
  /** Unit document layout of the `single`-layout JSON backend (format.ts serialize). */
  async function openDecisionsDomain(root: string) {
    const ctx = new Context()
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    const domain = await ctx.storageDomain.open(decisionsDomain)
    return { ctx, domain }
  }

  async function tamperUnitFile(root: string, decisionId: string, overrides: Record<string, unknown>): Promise<void> {
    const record = { ...validRecord(), decisionId, ...overrides }
    const document = {
      unit: { name: 'session_decisions', version: 1 },
      global: null,
      tables: { decisions: { [decisionId]: record } },
    }
    await writeFile(join(root, 'session_decisions.json'), `${JSON.stringify(document, null, 2)}\n`)
  }

  it('round-trips a valid record through a real durable open', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-decisions-schema-'))
    try {
      const first = await openDecisionsDomain(root)
      const record = decisionRecordSchema.parse(validRecord())
      await first.domain.table(DECISIONS_TABLE).put(record.decisionId, record)
      await first.domain.close()
      await first.ctx.fiber.dispose()

      const second = await openDecisionsDomain(root)
      const restored = second.domain.table(DECISIONS_TABLE).get(record.decisionId)
      expect(restored).toEqual(record)
      expect(restored?.decisionId).toBe(record.decisionId)
      await second.domain.close()
      await second.ctx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails the whole open with invalid-record on a tampered timestamp', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-decisions-schema-'))
    const decisionId = randomUUID()
    try {
      await tamperUnitFile(root, decisionId, { createdAtUtc: 'not-a-date' })
      const failure = await openDecisionsDomain(root).then(() => null, (error: unknown) => error)
      expect(failure).toBeInstanceOf(DomainError)
      expect((failure as DomainError).code).toBe('invalid-record')
      expect((failure as DomainError).detail).toEqual({ table: 'decisions', key: decisionId })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails the whole open with invalid-record on a tampered decision id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-decisions-schema-'))
    try {
      await tamperUnitFile(root, '../../etc/passwd', {})
      const failure = await openDecisionsDomain(root).then(() => null, (error: unknown) => error)
      expect(failure).toBeInstanceOf(DomainError)
      expect((failure as DomainError).code).toBe('invalid-record')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
