/**
 * Shared fixtures for session-decisions tests: a fake UTC clock, validated
 * test limits, and a real storage-domain mount over a private temp root.
 * @module tests/harness
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { decisionsDomain } from '../src/schema.ts'
import { DecisionStore, type DecisionLimits } from '../src/store.ts'
import type { DecisionClock } from '../src/types.ts'

/** Deterministic manual UTC clock; tests advance it explicitly. */
export class FakeClock implements DecisionClock {
  constructor(public nowMs = 0) {}

  now(): number {
    return this.nowMs
  }

  advance(ms: number): void {
    this.nowMs += ms
  }
}

/** Tight test limits: small enough to exercise capacity and bounds quickly. */
export function testLimits(overrides: Partial<DecisionLimits> = {}): DecisionLimits {
  return {
    maxRecords: 4,
    defaultTtlMs: 24 * 60 * 60 * 1000,
    closedRetentionMs: 30 * 24 * 60 * 60 * 1000,
    maxQuestionBytes: 1024,
    maxChoices: 4,
    maxChoiceLabelBytes: 64,
    ...overrides,
  }
}

export function sessionId(value: string): SessionId {
  return brandString<SessionId>(value)
}

export function requestId(value: string): SessionRequestId {
  return brandString<SessionRequestId>(value)
}

/** A real durable domain over a private temp root plus a store over it. */
export interface StoreFixture {
  readonly ctx: Context
  readonly store: DecisionStore
  /** The opened decisions domain; tests wrap its table to gate updates. */
  readonly domain: Domain<typeof decisionsDomain>
  readonly root: string
  /** Close the domain and plugins, keeping the root for reopen tests. */
  close(): Promise<void>
  /** Close everything and delete the private temp root. */
  dispose(): Promise<void>
}

export async function openStore(
  clock: DecisionClock,
  limits: DecisionLimits = testLimits(),
): Promise<StoreFixture> {
  const root = await mkdtemp(join(tmpdir(), 'session-decisions-'))
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const domain = await ctx.storageDomain.open(decisionsDomain)
  const store = new DecisionStore(domain, clock, limits)
  const close = async (): Promise<void> => {
    await domain.close()
    await ctx.fiber.dispose()
  }
  return {
    ctx,
    store,
    domain,
    root,
    close,
    dispose: async () => {
      await close()
      await rm(root, { recursive: true, force: true })
    },
  }
}
