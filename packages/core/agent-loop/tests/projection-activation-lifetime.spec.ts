/** Projection handoff cancellation must not publish stale plugin contributions. */
import { Context, FiberState, Service } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import AgentLoop from '../src/index.ts'
import * as Todo from '../../../todo/tool-todo/src/index.ts'
import * as Time from '../../../context/time-context/src/index.ts'
import * as Tmux from '../../../context/tmux-context/src/index.ts'
import * as Retry from '../../../llm/llm-retry/src/index.ts'
import * as Subagent from '../../../subagent/tool-subagent/src/index.ts'
import * as Team from '../../../experimental/tool-agent-team/src/index.ts'
import * as Media from '../../../experimental/desktop-media/src/index.ts'
import PermissionPresetService from '../../../interaction/permission-presets/src/index.ts'
import * as Commerce from '../../../experimental/commerce-mode/src/tools/index.ts'

class InitializableAgentLoop extends AgentLoop {
  initialize(): Promise<void> { return this[Service.init]() }
}

class InitializablePermission extends PermissionPresetService {
  initialize(): Promise<void> { return this[Service.init]() }
}

const installers: Array<[string, (ctx: Context) => Promise<void>]> = [
  ['media', ctx => Media.apply(ctx, {
    maxPaidCallsPerSession: 8, maxEstimatedSpendYuan: 40, maxClipCount: 4,
    maxClipDurationSeconds: 15, maxFileBytes: 1024, pollIntervalMs: 4000,
    pollTimeoutMs: 600000, videoModel: 'MiniMax-H3-Max', ttsModel: 'speech-2.8-hd',
    defaultDurationSeconds: 5, defaultResolution: '768P', defaultRatio: '16:9',
  })],
  ['permission', ctx => new InitializablePermission(ctx, {
    presets: { 'workspace-write': { sandbox: 'workspace-write', approval: 'ask' } },
    defaultPreset: { get: () => undefined },
  }).initialize()],
  ['todo', ctx => Todo.apply(ctx, { allowParallelInProgress: true })],
  ['time', ctx => Time.apply(ctx, {})],
  ['tmux', ctx => Tmux.apply(ctx, { refreshIntervalMs: 0 })],
  ['retry', ctx => Retry.apply(ctx)],
  ['subagent', ctx => Subagent.apply(ctx, { provider: 'fixture' })],
  ['team', ctx => Team.apply(ctx)],
  ['commerce', ctx => Commerce.apply(ctx, {
    maxImportBytes: 1024, maxResultChars: 1024, maxListingIds: 10, maxMetaBytes: 1024,
    maxStagedChanges: 10,
    guardrails: {
      maxItemsPerChange: 10, maxPriceDeltaPct: 10, maxPromotionDiscountPct: 10,
      maxRestockQuantity: 10, maxCampaignBudget: 10, maxListingFieldChars: 100,
      protectedFields: [], priceBearingFields: [], listingUpdateBlockedFields: [],
    },
  })],
  ['agent-loop', ctx => new InitializableAgentLoop(ctx, AgentLoop.Config({
    agents: [], maxParallelToolCalls: 1,
  })).initialize()],
]

describe.each(['unloading', 'disposed'] as const)('projection-ready continuation on %s owner', (transition) => {
  it.each(installers)('%s publishes no late contributions', async (_name, install) => {
    const root = new Context()
    onTestFinished(async () => { await root.fiber.dispose() })
    await mountAgentLoopTestDependencies(root)
    root.provide('shell', { sandboxMode: 'workspace-write' })
    root.provide('approval', { config: { policy: 'ask' } })
    const session = root.sessions.create()
    const initialCheckpoint = root.sessionProjections.checkpoint(session)
    const owner = await root.plugin(Object.assign(function owner() {}, {
      inject: ['shell', 'approval', 'agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'sessionProjections'],
    }))
    const projections = owner.ctx.sessionProjections
    let handoffs = 0
    // Keep the real effect-owned registry; move owner teardown into the exact
    // interval after handle creation and before the installer's await resumes.
    Object.defineProperty(owner.ctx, 'sessionProjections', {
      value: new Proxy(projections, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver)
          if (key !== 'register') return value
          return new Proxy(projections.register.bind(projections), {
            apply(register, _thisArg, args) {
              return Promise.resolve(register(...args as Parameters<typeof register>)).then((handle) => {
                handoffs++
                if (transition === 'unloading') {
                  expect(owner.uid).not.toBeNull()
                  owner.state = FiberState.UNLOADING
                }
                else void owner.dispose()
                return handle
              })
            },
          })
        },
      }),
    })
    Object.defineProperty(owner.ctx, 'get', {
      value: new Proxy(owner.ctx.get.bind(owner.ctx), {
        apply(get, receiver, args) {
          if (args[0] === 'sessionProjections') return owner.ctx.sessionProjections
          const value: unknown = Reflect.apply(get, receiver, args)
          return value
        },
      }),
    })
    const tools = vi.spyOn(root.tools, 'register')
    const factory = vi.spyOn(root.agents, 'setFactory')
    const listeners = vi.spyOn(owner.ctx, 'on')
    try {
      const pending = install(owner.ctx)
      const initialListeners = listeners.mock.calls.length
      await expect(pending).resolves.toBeUndefined()
      expect(handoffs).toBeGreaterThan(0)
      expect(tools).not.toHaveBeenCalled()
      expect(factory).not.toHaveBeenCalled()
      expect(listeners).toHaveBeenCalledTimes(initialListeners)
      expect(session.seq).toBe(0)
    } finally {
      if (transition === 'unloading') owner.state = FiberState.ACTIVE
      await owner.dispose()
      expect(root.sessionProjections.checkpoint(session)).toEqual(initialCheckpoint)
    }
  })
})
