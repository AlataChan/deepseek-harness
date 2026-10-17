// @vitest-environment jsdom
/** Browser activation through Cordis' guarded service context, rather than an unrestricted root. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { AssistantPredictionDockInjected } from '../src/client/ComposerPrediction.tsx'

describe('Assistant browser activation', () => {
  it('mounts generated remotes and all entries through the declared service injection', async () => {
    const ctx = new Context()
    const core = new SlotCore()
    core.register({ name: 'root', children: {
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'main': { kind: 'keyed', scope: 'root' },
      'conversation.hero.agentTeam': { kind: 'single', scope: 'root' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.input.overlay': { kind: 'list', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    } }, (() => null) as never)
    const legacy = () => null
    core.register({ name: 'conversation.hero.agentTeam' }, legacy)
    const remoteDispose = vi.fn(async () => {})
    const mount = vi.fn(async () => { ctx.reflect.provide('remote.assistants', {}); return remoteDispose })
    ctx.reflect.provide('remote', { $mount: mount })
    ctx.reflect.provide('remote.session', {})
    const selection = createSnapshotStore<ModelSelectionProjection>({ lastUsed: null, next: { provider: 'mock', model: 'a', reasoningEffort: 'low' } })
    const faceOf = vi.fn(() => selection)
    ctx.reflect.provide('sessions', { binding: () => ({ session: { projections: { faceOf } } }) })
    ctx.reflect.provide('workspaces', {})
    ctx.reflect.provide('layout', {})
    ctx.reflect.provide('uiWorkspace', {})
    ctx.reflect.provide('locale', { register: () => () => {}, bind: () => makeTranslate(zh) })
    ctx.reflect.provide('slots', {
      inject: (_name: string, callback: () => (() => void)) => ctx.effect(callback),
      register: core.register.bind(core),
    })
    const fiber = ctx.plugin({ inject, apply })
    try {
      await fiber.await()
      expect(mount).toHaveBeenCalledOnce()
      expect(core.entries('main')).toHaveLength(1)
      expect(core.entriesOfSlot('conversation.hero.agentTeam')[0]?.component).not.toBe(legacy)
      expect(core.entries('conversation.input.dock')).toHaveLength(2)
      expect(core.entries('conversation.input.overlay')).toHaveLength(1)
      const predictionEntry = core.entries('conversation.input.overlay')[0]!
      const injected = predictionEntry.inject!(SessionId('projection-owner') as never) as AssistantPredictionDockInjected
      expect(faceOf).toHaveBeenCalledWith('modelSelection')
      expect(injected.getPredictionRouteIdentity?.()).toBe(JSON.stringify(['mock', 'a', 'low']))
      const changed = vi.fn()
      const off = injected.subscribePredictionRoute?.(changed)
      selection.set({ lastUsed: null, next: { provider: 'mock', model: 'b', reasoningEffort: 'high' } })
      expect(changed).toHaveBeenCalledOnce()
      expect(injected.getPredictionRouteIdentity?.()).toBe(JSON.stringify(['mock', 'b', 'high']))
      off?.()
      selection.set({ lastUsed: null, next: { provider: 'mock', model: 'a' } })
      expect(changed).toHaveBeenCalledOnce()
      expect(core.entries('conversation.session.header.actions')).toHaveLength(1)
    } finally { await fiber.dispose(); await ctx.fiber.dispose() }
    expect(remoteDispose).toHaveBeenCalledOnce()
    expect(core.entriesOfSlot('conversation.hero.agentTeam')[0]?.component).toBe(legacy)
  })
})
