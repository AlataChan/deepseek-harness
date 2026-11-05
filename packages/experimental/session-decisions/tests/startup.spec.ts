/**
 * Declarative startup of the Host service: an enabled composition activates
 * inside the framework's injection callback once the required session
 * services become available, whatever order the composition mounted them in;
 * losing a dependency later unwinds the activation; and a disabled service
 * never demands the session stack. No reordering, late mounting, or timing
 * in the tests.
 * @module tests/startup
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { ApiSessionAgentController } from '@deepseek-ai/dsh-api-session-controller/src/agent.ts'
import { SessionCommandController } from '@deepseek-ai/dsh-api-session-controller/src/commands.ts'
import type { AdmittedPromptContentPart, AttachmentAdmissionPart } from '@deepseek-ai/dsh-attachment'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import SessionDecisionsService from '../src/index.ts'
import type { SessionDecisionsConfig } from '../src/index.ts'

const SESSION = SessionId('startup-session')

function serviceConfig(overrides: Partial<SessionDecisionsConfig> = {}): SessionDecisionsConfig {
  return {
    enabled: true,
    feishuEnabled: false,
    defaultTtlMs: 24 * 60 * 60 * 1000,
    closedRetentionMs: 30 * 24 * 60 * 60 * 1000,
    maxRecords: 1000,
    maxQuestionBytes: 16384,
    maxChoiceLabelBytes: 512,
    maxAnswerTextBytes: 16384,
    maxChoices: 8,
    reconcileMaxEvents: 100_000,
    ...overrides,
  }
}

/**
 * Storage stack over a private temp root plus the maintained real session
 * controller fixture (same shape the ordering harness uses): the feature's
 * own dependency and the full typed controller, no hand-rolled stubs.
 */
async function startupContext(): Promise<{ ctx: Context; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'session-decisions-startup-'))
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  return { ctx, root }
}

/** Mount the real session stack and controller after the feature did. */
async function mountSessionStack(ctx: Context): Promise<void> {
  await mountAgentLoopTestDependencies(ctx)
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  } as never)
  ctx.provide('attachments', {
    admitPromptContent: async (
      content: readonly AttachmentAdmissionPart[],
    ): Promise<AdmittedPromptContentPart[]> => {
      const admitted: AdmittedPromptContentPart[] = []
      for (const part of content) {
        if (part.type === 'image') throw new Error('fixture did not configure image persistence')
        admitted.push(part)
      }
      return admitted
    },
  } as never)
  ctx.provide('fileUploads', {
    resolve: () => undefined,
    bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
    retirePrompt: () => {},
  } as never)
  const controller = new SessionCommandController(ctx, new ApiSessionAgentController(ctx), '/workspace')
  ctx.provide('sessionController', {
    prompt: (request: Parameters<typeof controller.prompt>[0]) => controller.prompt(request),
  })
}

describe('declarative service startup', () => {
  it('activates an enabled composition whose session services arrive after the feature', async () => {
    const { ctx } = await startupContext()
    // The feature mounts before the session stack exists — the real Host
    // ordering that left the service inactive when activation was not
    // declarative. The injection callback context holds activation until
    // every required service is actually available.
    await ctx.plugin(SessionDecisionsService, serviceConfig())
    const waiting = await ctx.sessionDecisions.status()
    expect(waiting.available).toBe(false)
    expect(waiting.reason).toContain('waiting for required services')

    await mountSessionStack(ctx)

    await vi.waitFor(async () => {
      expect(await ctx.sessionDecisions.status()).toEqual({ available: true })
    }, { timeout: 2_000, interval: 10 })

    // The activated service admits: the public create path works end to end.
    const view = await ctx.sessionDecisions.create({ sessionId: SESSION, question: 'Late?', choices: ['A', 'B'] })
    expect(view).toMatchObject({ question: 'Late?', lifecycle: 'open', answerIndex: 'none' })
  })

  it('unwinds the activation when a required service is later lost', async () => {
    const { ctx } = await startupContext()
    await ctx.plugin(SessionDecisionsService, serviceConfig())
    await mountSessionStack(ctx)
    await vi.waitFor(async () => {
      expect(await ctx.sessionDecisions.status()).toEqual({ available: true })
    }, { timeout: 2_000, interval: 10 })

    // Losing a dependency unloads the injection callback context, whose
    // teardown effect closes the domain and degrades the service.
    const removed = ctx.registry.delete(AgentRegistry)
    expect(removed).toBeDefined()
    await vi.waitFor(async () => {
      const status = await ctx.sessionDecisions.status()
      expect(status.available).toBe(false)
      expect(status.reason).toContain('lost a required service')
    }, { timeout: 2_000, interval: 10 })
    try {
      void ctx.sessionDecisions.catalog(SESSION)
      expect.unreachable('catalog must refuse after the activation unwound')
    } catch (error) {
      expect(error).toMatchObject({ code: 'DECISION_UNAVAILABLE' })
    }
  })

  it('reacquires the activation when a lost required service returns', async () => {
    const { ctx } = await startupContext()
    await ctx.plugin(SessionDecisionsService, serviceConfig())
    await mountSessionStack(ctx)
    await vi.waitFor(async () => {
      expect(await ctx.sessionDecisions.status()).toEqual({ available: true })
    }, { timeout: 2_000, interval: 10 })

    // Lose and restore the dependency: the injection fiber unloads and then
    // reloads, and the re-activation must not inherit stale stopping state.
    expect(ctx.registry.delete(AgentRegistry)).toBeDefined()
    await vi.waitFor(async () => {
      expect(await ctx.sessionDecisions.status()).toMatchObject({ available: false })
    }, { timeout: 2_000, interval: 10 })
    await ctx.plugin(AgentRegistry)
    await vi.waitFor(async () => {
      expect(await ctx.sessionDecisions.status()).toEqual({ available: true })
    }, { timeout: 2_000, interval: 10 })

    // The reacquired service admits through the public create path again.
    const view = await ctx.sessionDecisions.create({ sessionId: SESSION, question: 'Back?', choices: ['A', 'B'] })
    expect(view).toMatchObject({ question: 'Back?', lifecycle: 'open', answerIndex: 'none' })
  })

  it('stays unavailable without crashing while the session stack never arrives', async () => {
    const { ctx } = await startupContext()
    await ctx.plugin(SessionDecisionsService, serviceConfig())
    await new Promise(resolve => setTimeout(resolve, 20))
    const status = await ctx.sessionDecisions.status()
    expect(status.available).toBe(false)
    expect(status.reason).toContain('waiting for required services')
    await expect(ctx.sessionDecisions.create({ sessionId: SESSION, question: 'X?', choices: [] }))
      .rejects.toMatchObject({ code: 'DECISION_UNAVAILABLE' })
  })

  it('activates a disabled service immediately without the session stack', async () => {
    const { ctx } = await startupContext()
    await ctx.plugin(SessionDecisionsService, serviceConfig({ enabled: false }))
    expect(await ctx.sessionDecisions.status()).toMatchObject({ available: false })
    // The disabled refusal throws synchronously (the catalog is a sync
    // Remote method whose store guard throws before a promise exists).
    try {
      void ctx.sessionDecisions.catalog(SESSION)
      expect.unreachable('catalog must refuse while the feature is disabled')
    } catch (error) {
      expect(error).toMatchObject({ code: 'DECISION_UNAVAILABLE' })
    }
  })
})
