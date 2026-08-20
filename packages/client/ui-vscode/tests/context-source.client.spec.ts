// @vitest-environment jsdom
/** Editor-context source ownership, immutable retention, and missing-reference failure. */

import { describe, expect, it, vi } from 'vitest'
import { EditorContextId, type EditorContextSnapshot } from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { InputTriggerService } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { ComposerBlockRegistry } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/blocks.ts'
import { InputHub } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/hub.ts'
import { ConversationController } from '@deepseek-ai/dsh-client-ui-conversation/src/client/service.ts'
import { zh as conversationZh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { EditorContextSource } from '../src/client/context-source.ts'

function snapshot(): EditorContextSnapshot {
  return {
    id: EditorContextId('capture-1'),
    kind: 'selection',
    uri: 'file:///workspace/src/main.ts',
    workspacePath: 'src/main.ts',
    languageId: 'typescript',
    version: 4,
    range: { startLine: 4, startColumn: 1, endLine: 5, endColumn: 8 },
    text: 'const value = 1',
    capturedAt: 42,
  }
}

describe('EditorContextSource', () => {
  it('creates a chip projection and retains an immutable snapshot', async () => {
    const registry = new EditorContextSource()
    const captured = snapshot()
    const reference = registry.remember(captured, 'src/main.ts:5-6')
    captured.text = 'mutated after capture'
    if (captured.range !== undefined) captured.range.startLine = 99

    expect(reference).toEqual({
      source: 'ide-context',
      ref: 'capture-1',
      label: 'src/main.ts:5-6',
      clipboardText: '@src/main.ts:5-6',
    })
    await expect(registry.source.codec?.serialize(reference.ref, new AbortController().signal))
      .resolves.toContain('range="5:2-6:9"')
    await expect(registry.source.codec?.serialize(reference.ref, new AbortController().signal))
      .resolves.toContain('const value = 1')
  })

  it('blocks missing, disposed, duplicate, and aborted references', async () => {
    const registry = new EditorContextSource()
    const signal = new AbortController()
    signal.abort(new Error('submission stopped'))
    await expect(registry.source.codec?.serialize('missing', new AbortController().signal))
      .rejects.toThrow('no longer available')
    registry.remember(snapshot(), 'main.ts')
    expect(() => registry.remember(snapshot(), 'main.ts')).toThrow('duplicate editor context id')
    await expect(registry.source.codec?.serialize('capture-1', signal.signal)).rejects.toThrow('submission stopped')
    registry.dispose()
    await expect(registry.source.codec?.serialize('capture-1', new AbortController().signal))
      .rejects.toThrow('no longer available')
  })

  it('registers a non-candidate @ source used only by explicit actions', async () => {
    const registry = new EditorContextSource()
    expect(registry.source).toMatchObject({ trigger: '@', name: 'ide-context' })
    expect(registry.source.codec?.clipboardText('capture-1')).toBe('@capture-1')
    await expect(registry.source.candidates({} as never, {
      query: '', position: 'inline', signal: new AbortController().signal,
    } as never)).resolves.toEqual([])
    expect(registry.source.onPick({} as never)).toBeUndefined()
  })

  it('uses a stable error when an abort has no Error reason', async () => {
    const registry = new EditorContextSource()
    const controller = new AbortController()
    controller.abort('stopped')
    await expect(registry.source.codec?.serialize('capture-1', controller.signal))
      .rejects.toThrow('editor context serialization aborted')
  })

  it('delivers the exact serialized snapshot through one Session prompt', async () => {
    const runtime = await SlotTestRuntime.create()
    const prompt = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
    await runtime.sessions.add({ id: 's1', session: { prompt } })
    await runtime.ctx.plugin(InputTriggerService).await()
    const hub = new InputHub(runtime.ctx, makeTranslate(conversationZh, {}))
    await runtime.ctx.plugin(ConversationController, {
      input: hub,
      blocks: new ComposerBlockRegistry(),
    }).await()
    const registry = new EditorContextSource()
    runtime.ctx.inputTriggers.registerSource(registry.source)
    const reference = registry.remember(snapshot(), 'src/main.ts:5-6')
    const scoped = runtime.sessions.scope('s1')!
    const conversation = scoped.get('conversation') as ConversationController
    expect(conversation.appendReference(reference)).toBe(true)
    hub.shell('s1' as never).submit()

    await vi.waitFor(() => { expect(prompt).toHaveBeenCalledOnce() })
    expect(prompt).toHaveBeenCalledWith([{
      type: 'text',
      text: '<ide_context kind="selection" uri="file:///workspace/src/main.ts" path="src/main.ts" language="typescript" version="4" range="5:2-6:9">\n'
        + 'const value = 1\n'
        + '</ide_context>',
    }], 'queue')
    await runtime.dispose()
  })
})
