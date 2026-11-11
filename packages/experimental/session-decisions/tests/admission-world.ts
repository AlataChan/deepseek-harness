/**
 * Real admission path (R10): the service admits answers through a real
 * SessionCommandController over a real production Agent created by the
 * public agent-loop testkit, the real Session store, AgentRegistry, and
 * durable storage stack, with the real session-projection registry
 * projecting the real production inbox. Only external nondeterminism is
 * stubbed: the text-only attachment and file-upload services the prompt
 * path touches, and the Typert protocol lookup seam the controller host
 * needs (no remote transport is exercised), per the session-controller
 * test fixtures. Entry evidence flows through the real durable
 * `agent/inbox/spliced` events and the real inbox projection, so these
 * tests fail when enqueue or entry evidence changes.
 * @module tests/admission-world
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import { ApiSessionAgentController } from '@deepseek-ai/dsh-api-session-controller/src/agent.ts'
import { SessionCommandController } from '@deepseek-ai/dsh-api-session-controller/src/commands.ts'
import type { SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import type { AdmittedPromptContentPart,AttachmentAdmissionPart } from '@deepseek-ai/dsh-attachment'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo, StreamChunk,UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { addAbortListener } from 'node:events'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished,vi,type Mock } from 'vitest'
import type { SessionDecisionsConfig } from '../src/index.ts'
import SessionDecisionsService from '../src/index.ts'

/** The Goal state slice the service's view derivation reads. */
export interface GoalStub {
  phase: 'active' | 'paused' | 'blocked' | 'complete'
  activation: 'armed' | 'disarmed'
}

/** Asking Session shared by real admission tests. */
export const SESSION = SessionId('admit-session')

/** Full validated config with the defaults the service would apply. */
export function serviceConfig(overrides: Partial<SessionDecisionsConfig> = {}): SessionDecisionsConfig {
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

/** Build real question storage, Agent loop and public Session command admission.
 * @param config - Question service configuration overrides.
 * @param options - Optional persistence, model and external card capability.
 * @returns Running isolated services and their owned test controls.
 */
export async function admissionHarness(
  config: Partial<SessionDecisionsConfig> = {},
  options: {
    persistent?: boolean
    hold?: boolean
    model?: LlmAdapter
    beforeService?(ctx: Context, agent: Agent): void | Promise<void>
  } = {},
): Promise<{
  ctx: Context
  root: string
  agent: Agent
  releaseMaintenance(): void
  closeFeature(): Promise<void>
  service: SessionDecisionsService
  followup: Mock<(message: UserMessage) => void>
  followupThrowsAfterEnqueue: () => void
  goalState: { current: GoalStub | undefined }
}> {
  const root = await mkdtemp(join(tmpdir(), 'session-decisions-admit-'))
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await mountAgentLoopTestDependencies(ctx)
  if (options.persistent !== false) await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  const model = options.model
  if (model) ctx.effect(() => ctx.llm.registerAdapter(['unit'], model))
  const loop = await mountAgentLoopTestHarness(ctx)
  const agent = await loop.create(SESSION, options.model ? { provider: 'unit', model: 'unit' } : {}, { cwd: '/workspace' })
  // Mutable Goal seam: viewOf consults `goals.get(agent)` per read, so tests
  // flip `goalState.current` to derive goalDisarmed without a real Goal plugin.
  const goalState: { current: GoalStub | undefined } = { current: undefined }
  ctx.provide('goals', { get: (): GoalStub | undefined => goalState.current })
  // Hold the real loop inside a pending maintenance job: followup wakes latch
  // behind it, so delivered answers stay durably pending with deterministic
  // timing and no unconfigured LLM turn ever runs in these tests. The job
  // resolves when disposal aborts its signal.
  const maintenance = Promise.withResolvers<undefined>()
  if (options.hold !== false) void agent.runMaintenance(async (signal) => {
    const abort = addAbortListener(signal, () => { maintenance.resolve(undefined) })
    try { await maintenance.promise } finally { abort[Symbol.dispose]() }
  })
  const deliverFollowup = agent.followup.bind(agent)
  const followup = vi.spyOn(agent, 'followup')

  // Typert protocol lookup seam only: the controller host registers lookups
  // at construction; no remote transport participates in these tests.
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  } as never)

  // Text-only answers never hit attachments or file receipts; these are the
  // only stubbed services (external attachment plumb), shaped per the
  // session-controller test fixtures.
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
    prompt: (request: SessionPromptRequest) => controller.prompt(request),
  } as never)

  await options.beforeService?.(ctx, agent)
  const feature = ctx.plugin(SessionDecisionsService, serviceConfig(config))
  await feature
  const service = ctx.sessionDecisions
  return {
    ctx,
    root,
    agent,
    releaseMaintenance: () => { maintenance.resolve(undefined) },
    closeFeature: () => feature.dispose(),
    service,
    followup,
    goalState,
    followupThrowsAfterEnqueue: (): void => {
      followup.mockImplementation((message: UserMessage) => {
        // Real durable enqueue through the production inbox first, then the
        // loop dies: the spliced event is already in the log and projected
        // when the rejection surfaces.
        deliverFollowup(message)
        throw new Error('fixture: agent died after enqueue')
      })
    },
  }
}


/** Fixed external model response over the actual Agent loop. */
export class ReplyAdapter extends LlmAdapter {
  /** Number of dispatched model calls. */
  calls = 0
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(): AsyncIterable<StreamChunk> {
    this.calls += 1
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Acknowledged.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Acknowledged.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
