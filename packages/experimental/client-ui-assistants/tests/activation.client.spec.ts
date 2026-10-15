// @vitest-environment jsdom
/** Browser activation through Cordis' guarded service context, rather than an unrestricted root. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

describe('Assistant browser activation', () => {
  it('mounts generated remotes and all entries through the declared service injection', async () => {
    const ctx = new Context()
    const core = new SlotCore()
    core.register({ name: 'root', children: {
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'main': { kind: 'keyed', scope: 'root' },
      'conversation.hero.agentTeam.card': { kind: 'list', scope: 'root' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    } }, (() => null) as never)
    const remoteDispose = vi.fn(async () => {})
    const mount = vi.fn(async () => { ctx.reflect.provide('remote.assistants', {}); return remoteDispose })
    ctx.reflect.provide('remote', { $mount: mount })
    ctx.reflect.provide('remote.session', {})
    ctx.reflect.provide('sessions', {})
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
      expect(core.entries('conversation.input.dock')).toHaveLength(3)
      expect(core.entries('conversation.session.header.actions')).toHaveLength(1)
    } finally { await fiber.dispose(); await ctx.fiber.dispose() }
    expect(remoteDispose).toHaveBeenCalledOnce()
  })
})
