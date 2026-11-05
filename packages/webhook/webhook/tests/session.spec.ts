import { Context } from '@deepseek-ai/cordis'
import { AgentModel, modelSelectionProjectionDefinition, type ModelSelection } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WebhookDeliveryId,
  WebhookRuleId,
  WebhookSourceId,
  type VerifiedWebhookDelivery,
  type WebhookSessionRequest,
} from '../src/index.ts'
import { createWebhookSession } from '../src/session.ts'

interface HarnessOptions {
  failAt?: 'permission-resolve' | 'preset-resolve' | 'standing' | 'workspace' | 'agent' | 'attach' | 'permission-set' | 'title' | 'followup'
  failDetach?: boolean
  failDispose?: boolean
  abortAt?: 'workspace' | 'agent'
}

interface SessionHarness {
  readonly ctx: Context
  readonly calls: string[]
  readonly messages: unknown[]
  readonly session: Session
  readonly model: AgentModel
  markRequestHeader(config: ModelSelection): void
  readonly controller: AbortController
  readonly request: WebhookSessionRequest
}

const active: SessionHarness[] = []

afterEach(async () => {
  await Promise.all(active.splice(0).map(test => test.ctx.fiber.dispose()))
})

/** Build a same-process fake around the private creation transaction. */
async function harness(options: HarnessOptions = {}): Promise<SessionHarness> {
  const calls: string[] = []
  const messages: unknown[] = []
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  const projection = await ctx.sessionProjections.register(modelSelectionProjectionDefinition)
  const controller = new AbortController()
  const session = Session.create(SessionId('webhook-session'))
  const model = new AgentModel(() => projection.stateOf(session), session, {})
  const agent = {
    id: session.id,
    session,
    model,
    followup(message: unknown) {
      calls.push('followup')
      if (options.failAt === 'followup') throw new Error('followup failed')
      messages.push(message)
    },
  }
  const handle = {
    agent,
    async dispose() {
      calls.push('dispose')
      if (options.failDispose) throw new Error('dispose failed')
    },
  }
  const workspace = {
    path: '/workspace',
    async attachSession() {
      calls.push('attach')
      if (options.failAt === 'attach') throw new Error('attach failed')
    },
    async detachSession() {
      calls.push('detach')
      if (options.failDetach) throw new Error('detach failed')
    },
  }
  const fake = {
    logger: { warn: vi.fn() },
    permissionPresets: {
      resolve(name: string) {
        calls.push(`permission-resolve:${name}`)
        if (options.failAt === 'permission-resolve') throw new Error('permission resolve failed')
        return {}
      },
      set(_session: unknown, name: string) {
        calls.push(`permission-set:${name}`)
        if (options.failAt === 'permission-set') throw new Error('permission set failed')
      },
    },
    agentDefaultModel: {
      currentSelection() {
        calls.push('default-model')
        return { provider: 'default-provider', model: 'default-model', reasoningEffort: 'high' }
      },
    },
    agentPresets: {
      async resolve(name: string) {
        calls.push(`preset-resolve:${name}`)
        if (options.failAt === 'preset-resolve') throw new Error('preset resolve failed')
        return { id: name }
      },
      async acquireScope(name: string) {
        calls.push(`standing:${name}`)
        if (options.failAt === 'standing') throw new Error('standing failed')
        return { key: {}, [Symbol.asyncDispose]: async () => {} }
      },
      async mount(_agentCtx: unknown, name: string) {
        calls.push(`mount:${name}`)
        return { id: name }
      },
    },
    workspaceRegistry: {
      async create(path: string) {
        calls.push(`workspace:${path}`)
        if (options.failAt === 'workspace') throw new Error('workspace failed')
        if (options.abortAt === 'workspace') controller.abort(new Error('abort after workspace'))
        return workspace
      },
    },
    agents: {
      async create(createOptions: { setup?: (ctx: unknown, agent: unknown) => Promise<void> }) {
        calls.push('agent-create')
        if (options.failAt === 'agent') throw new Error('agent failed')
        await createOptions.setup?.(ctx, agent)
        if (options.abortAt === 'agent') controller.abort(new Error('abort after agent'))
        return handle
      },
    },
    sessionTitle: {
      rename() {
        calls.push('title')
        if (options.failAt === 'title') throw new Error('title failed')
        return {}
      },
    },
  }
  Object.assign(ctx, fake)
  const result: SessionHarness = {
    ctx,
    calls,
    messages,
    session,
    model,
    markRequestHeader(config) {
      session.append('request/header', { header: { config }, reason: 'initial' })
    },
    controller,
    request: {
      workspacePath: '/workspace',
      title: 'Review PR',
      prompt: 'Review it',
      agentPreset: 'standard',
      permissionPreset: 'read-only',
    },
  }
  active.push(result)
  return result
}

const delivery: VerifiedWebhookDelivery = {
  kind: 'github',
  source: WebhookSourceId('primary'),
  deliveryId: WebhookDeliveryId('delivery'),
  event: { action: 'ready_for_review' },
  receivedAt: 1,
}

async function create(test: SessionHarness, request = test.request): Promise<void> {
  await createWebhookSession(
    test.ctx,
    delivery,
    WebhookRuleId('review'),
    request,
    test.controller.signal,
  )
}

describe('webhook Session creation', () => {
  it('preflights, mounts, attaches, configures, titles, and prompts in order', async () => {
    const test = await harness()
    await create(test)
    expect(test.calls).toEqual([
      'default-model',
      'permission-resolve:read-only',
      'preset-resolve:standard',
      'standing:standard',
      'workspace:/workspace',
      'agent-create',
      'mount:standard',
      'attach',
      'permission-set:read-only',
      'title',
      'followup',
    ])
    expect(test.messages).toHaveLength(1)
    expect(test.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Review it' }],
      source: {
        kind: 'webhook', provider: 'github', source: 'primary', deliveryId: 'delivery', ruleId: 'review',
      },
    })
  })

  it('uses a complete explicit model without consulting the default', async () => {
    const test = await harness()
    await create(test, { ...test.request, model: { provider: 'p', model: 'm', maxTokens: 10 } })
    expect(test.calls).not.toContain('default-model')
    const withoutCap = await harness()
    withoutCap.markRequestHeader({ provider: 'p', model: 'm', reasoningEffort: ReasoningEffortId('inherited') })
    await create(withoutCap, { ...withoutCap.request, model: { provider: 'p', model: 'm' } })
    expect(withoutCap.calls).not.toContain('default-model')
    expect(test.model.current()).toEqual({ provider: 'p', model: 'm' })
    expect(withoutCap.model.current()).toEqual({ provider: 'p', model: 'm' })
    expect(withoutCap.session.snapshotEvents().filter(event => event.type === 'model/selection')).toMatchObject([
      { type: 'model/selection', data: { provider: 'p', model: 'm' } },
    ])
    expect(withoutCap.model.current()).not.toHaveProperty('reasoningEffort')
  })

  it('preserves default reasoning until a matching request header is durable', async () => {
    const test = await harness()
    await create(test)
    const selected = {
      provider: 'default-provider',
      model: 'default-model',
      reasoningEffort: ReasoningEffortId('high'),
    }
    expect(test.model.current()).toEqual(selected)
    for (const config of [
      { ...selected, provider: 'other-provider' },
      { ...selected, model: 'other-model' },
      { ...selected, reasoningEffort: ReasoningEffortId('inherited') },
    ]) {
      test.markRequestHeader(config)
      expect(test.model.current()).toEqual(selected)
    }
    test.markRequestHeader(selected)
    expect(test.model.current()).toEqual(selected)
    const later = {
      provider: 'later-provider',
      model: 'later-model',
      reasoningEffort: ReasoningEffortId('later'),
    }
    test.markRequestHeader(later)
    expect(test.model.current()).toEqual(later)
  })

  it.each([
    [null, /must be null or a Session request object/],
    [{}, /workspacePath/],
    [{ workspacePath: 'relative', title: 't', prompt: 'p', agentPreset: 'a', permissionPreset: 'x' }, /must be absolute/],
    [{ workspacePath: '/w', title: ' ', prompt: 'p', agentPreset: 'a', permissionPreset: 'x' }, /title/],
    [{ workspacePath: '/w', title: 't', prompt: '', agentPreset: 'a', permissionPreset: 'x' }, /prompt/],
    [{ workspacePath: '/w', title: 't', prompt: 'p', agentPreset: '', permissionPreset: 'x' }, /agentPreset/],
    [{ workspacePath: '/w', title: 't', prompt: 'p', agentPreset: 'a', permissionPreset: '' }, /permissionPreset/],
    [{ workspacePath: '/w', title: 't', prompt: 'p', agentPreset: 'a', permissionPreset: 'x', model: null }, /model must be an object/],
    [{ workspacePath: '/w', title: 't', prompt: 'p', agentPreset: 'a', permissionPreset: 'x', model: {} }, /provider/],
    [{ workspacePath: '/w', title: 't', prompt: 'p', agentPreset: 'a', permissionPreset: 'x', model: { provider: 'p', model: 'm', maxTokens: 0 } }, /maxTokens/],
  ] as const)('rejects malformed rule result %# before side effects', async (request, message) => {
    const test = await harness()
    await expect(create(test, request as never)).rejects.toThrow(message)
    expect(test.calls).toEqual([])
  })

  it.each([
    'permission-resolve', 'preset-resolve', 'standing', 'workspace', 'agent', 'attach',
  ] as const)('contains a %s failure before prompt admission', async (failAt) => {
    const test = await harness({ failAt })
    await expect(create(test)).rejects.toThrow()
    expect(test.calls).not.toContain('followup')
    if (failAt === 'attach') expect(test.calls).toContain('dispose')
  })

  it.each(['permission-set', 'title', 'followup'] as const)(
    'detaches and disposes after a %s failure',
    async (failAt) => {
      const test = await harness({ failAt })
      await expect(create(test)).rejects.toThrow()
      expect(test.calls).toContain('detach')
      expect(test.calls).toContain('dispose')
    },
  )

  it('preserves the original failure while reporting rollback failures', async () => {
    const test = await harness({ failAt: 'title', failDetach: true, failDispose: true })
    await expect(create(test)).rejects.toThrow('title failed')
    expect((test.ctx.logger.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2)
  })

  it.each(['workspace', 'agent'] as const)('honors cancellation after %s settlement', async (abortAt) => {
    const test = await harness({ abortAt })
    await expect(create(test)).rejects.toThrow(/abort after/)
    expect(test.calls).not.toContain('followup')
    if (abortAt === 'agent') expect(test.calls).toContain('dispose')
  })
})
