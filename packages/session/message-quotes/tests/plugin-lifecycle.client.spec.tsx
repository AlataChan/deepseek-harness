// @vitest-environment jsdom
/** Quote contributions follow their plugin and keyed slot lifetimes. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { SlotTestRuntime, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { apply as applyConversation, inject as conversationInject } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyHost } from '../src/index.ts'

it('registers one localized quote action per declaration and removes it on plugin unload', async () => {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  locale.setLocale('zh')
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.ctx.provide('uiWorkspace', { openWorkspace: vi.fn(), openSession: vi.fn() } as never)
  runtime.ctx.provide('configForms', {
    developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope,
  } as never)
  await runtime.mount({ inject: [...conversationInject], apply: applyConversation })
  const plugin = await runtime.mount({ inject: [...inject], apply })
  expect(runtime.slots.entries('conversation.chat.text-interaction')).toEqual([])
  await runtime.root.declare({ 'conversation.chat.text-interaction': { kind: 'keyed', scope: 'session' } }, () => null)
  expect(runtime.slots.entries('conversation.chat.text-interaction').map(entry => entry.options.key)).toEqual(['quote'])
  expect(locale.bind('messageQuotes')('quote.add')).toBe('引用文本')
  locale.setLocale('en')
  expect(locale.bind('messageQuotes')('quote.add')).toBe('Quote text')
  await plugin.dispose()
  expect(runtime.slots.entries('conversation.chat.text-interaction')).toEqual([])
  const reloaded = await runtime.mount({ inject: [...inject], apply })
  expect(runtime.slots.entries('conversation.chat.text-interaction')).toHaveLength(1)
  await reloaded.dispose()
  expect(runtime.slots.entries('conversation.chat.text-interaction')).toEqual([])
  expect(applyHost).not.toThrow()
})
