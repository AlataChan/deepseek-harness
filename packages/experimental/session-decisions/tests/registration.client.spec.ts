/**
 * Client registration surface: the plugin declares exactly its consumed
 * services, registers the Session-header card, the Session-row mark, and both
 * question tool cards under the real declared slots, registers both locale
 * dictionaries, and removes everything with its fiber. The default entry path
 * mounts the package's own generated Remote contribution first and leaves the
 * Remote mount and the UI registrations together — including when the
 * registration fails. A changed slot name, entry id, tool key, or service
 * declaration fails here.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { QuestionComposerCard } from '../src/client/QuestionComposerCard.tsx'
import { QuestionCard } from '../src/client/QuestionCard.tsx'
import { SessionQuestionMark } from '../src/client/SessionQuestionMark.tsx'
import { QuestionToolCard } from '../src/client/QuestionToolCard.tsx'
import { inject, mountQuestionsUi, registerUi } from '../src/client/mount.ts'
import { apply } from '../src/client/index.ts'
import TYPERT_REMOTE from '@deepseek-ai/dsh-experimental-session-decisions/remote'
import { en, NS, zh } from '../src/client/locales.ts'

const Empty = () => null

/** The generated Remote contribution shape the default entry imports. */
const REMOTE: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-experimental-session-decisions',
  descriptors: [],
}

/** Scripted `sessionDecisions` namespace face; calls are not asserted here. */
function scriptedNamespace(): Record<string, () => Promise<unknown>> {
  return {
    catalog: () => Promise.resolve({ ok: true, value: [] }),
    get: () => Promise.resolve({ ok: true, value: undefined }),
    submit: () => Promise.resolve({ ok: true, value: { outcome: 'submitting', requestId: 'req' } }),
    dismiss: () => Promise.resolve({ ok: true, value: { ok: true, record: undefined } }),
    cancel: () => Promise.resolve({ ok: true, value: { ok: true, record: undefined } }),
    pause: () => Promise.resolve({ ok: true, value: { ok: true, record: undefined } }),
    resume: () => Promise.resolve({ ok: true, value: { ok: true, record: undefined } }),
  }
}

/**
 * Scripted Remote service whose `$mount` publishes the namespace the way the
 * generated contribution does, and records the mount disposer for cleanup
 * assertions.
 */
class MountRemote extends Service {
  readonly mount = vi.fn((_contribution: unknown) => {
    // A repeated $mount of the same contribution re-publishes nothing; the
    // rollback test's retry must not collide with the first mount.
    if (!this.published) {
      this.published = true
      this.serviceCtx.provide('remote.sessionDecisions', this.namespace)
    }
    return Promise.resolve(this.disposeMount)
  })
  readonly disposeMount = vi.fn(() => Promise.resolve())
  private published = false

  constructor(
    private readonly serviceCtx: Context,
    private readonly namespace: Record<string, () => Promise<unknown>>,
  ) {
    super(serviceCtx, 'remote')
  }

  $mount(contribution: unknown): Promise<() => Promise<void>> {
    return this.mount(contribution)
  }
}

async function baseContext(namespace: Record<string, () => Promise<unknown>> | undefined): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('remote', namespace === undefined ? {} : { sessionDecisions: namespace })
  if (namespace !== undefined) {
    await ctx.plugin({ apply: (provider) => { provider.provide('remote.sessionDecisions', namespace) } }).await()
  }
  ctx.provide('locale', new LocaleRuntime(ctx))
  return ctx
}

function declareSeats(ctx: Context): () => void {
  return ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'sidebar.session.row.leading': { kind: 'list', scope: 'root' },
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
    },
  } as never, Empty)
}

describe('session-decisions client registration', () => {
  it('declares exactly the services registration consumes', () => {
    expect(inject).toEqual(['remote', 'slots', 'locale'])
  })

  it('waits for the real slot declarations, registers every seat, and tears down with the fiber', async () => {
    const ctx = await baseContext(scriptedNamespace())
    const fiber = ctx.plugin({ inject: [...inject], apply: clientCtx => registerUi(clientCtx) })
    await fiber.await()
    // The registrations wait for the declarations; nothing is seated before.
    expect(ctx.slots.entries('conversation.session.header.utilities')).toEqual([])
    expect(ctx.slots.entries('sidebar.session.row.leading')).toEqual([])
    expect(ctx.slots.entries('tool.call.toolview')).toEqual([])

    const owner = declareSeats(ctx)
    const header = ctx.slots.entries('conversation.session.header.utilities')[0]!
    expect(header.component).toBe(QuestionCard)
    expect(header.options).toMatchObject({ id: 'session-questions', order: -6 })
    expect(header.locale).toBe(NS)
    const composer = ctx.slots.entries('conversation.input.dock')[0]!
    expect(composer.component).toBe(QuestionComposerCard)
    expect(composer.options.id).toBe('session-question-answer')
    const mark = ctx.slots.entries('sidebar.session.row.leading')[0]!
    expect(mark.component).toBe(SessionQuestionMark)
    expect(mark.options).toMatchObject({ id: 'session-questions-mark', order: 15 })
    expect(mark.locale).toBe(NS)
    const toolviews = ctx.slots.entries('tool.call.toolview')
    expect(toolviews.map(entry => entry.options.key)).toEqual(['request_persistent_question', 'read_persistent_question'])
    for (const entry of toolviews) {
      expect(entry.component).toBe(QuestionToolCard)
      expect(entry.locale).toBe(NS)
    }

    const headerProps = header.inject?.('session-for-injection' as never)
    const markProps = mark.inject?.()
    expect(headerProps?.sessionId).toBe('session-for-injection')
    expect(markProps?.source).toBe(headerProps?.source)
    expect(composer.inject?.('session-for-injection' as never).source).toBe(headerProps?.source)
    for (const entry of toolviews) expect(entry.inject?.().source).toBe(headerProps?.source)

    await fiber.dispose()
    expect(ctx.slots.entries('conversation.session.header.utilities')).toEqual([])
    expect(ctx.slots.entries('sidebar.session.row.leading')).toEqual([])
    expect(ctx.slots.entries('tool.call.toolview')).toEqual([])
    owner()
    await ctx.fiber.dispose()
  })

  it('registers both dictionaries with key parity and releases them with its fiber', async () => {
    const ctx = await baseContext(scriptedNamespace())
    const fiber = ctx.plugin({ inject: [...inject], apply: clientCtx => registerUi(clientCtx) })
    await fiber.await()
    const translate = ctx.locale.bind(NS)
    ctx.locale.setLocale('zh')
    expect(translate('title')).toBe(zh.title)
    expect(translate('goalHint')).toBe(zh.goalHint)
    ctx.locale.setLocale('en')
    expect(translate('title')).toBe(en.title)
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())

    await fiber.dispose()
    expect(translate('title')).not.toBe(en.title)
    await ctx.fiber.dispose()
  })

  it('mounts the generated Remote contribution, registers under it, and leaves together', async () => {
    const namespace = scriptedNamespace()
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const remote = new MountRemote(ctx, namespace)

    const dispose = await mountQuestionsUi(ctx, REMOTE)
    expect(remote.mount).toHaveBeenCalledTimes(1)
    expect(remote.mount).toHaveBeenCalledWith(REMOTE)
    // The child registration consumed the service $mount published.
    expect((ctx.remote as { sessionDecisions?: unknown }).sessionDecisions).toBe(namespace)

    const owner = declareSeats(ctx)
    expect(ctx.slots.entries('conversation.session.header.utilities')[0]!.component).toBe(QuestionCard)
    expect(ctx.slots.entries('sidebar.session.row.leading')[0]!.component).toBe(SessionQuestionMark)
    expect(ctx.slots.entries('tool.call.toolview')).toHaveLength(2)

    await dispose()
    expect(remote.disposeMount).toHaveBeenCalledTimes(1)
    expect(ctx.slots.entries('conversation.session.header.utilities')).toEqual([])
    expect(ctx.slots.entries('sidebar.session.row.leading')).toEqual([])
    expect(ctx.slots.entries('tool.call.toolview')).toEqual([])
    const translate = ctx.locale.bind(NS)
    expect(translate('title')).not.toBe(zh.title)
    owner()
    await ctx.fiber.dispose()
  })

  it('default entry apply mounts the actual generated Remote contribution and its UI together', async () => {
    // Wire proof: the real generated artifact (not a fabricated contribution)
    // flows through the public default entry `apply`.
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const remote = new MountRemote(ctx, scriptedNamespace())

    const dispose = await apply(ctx)
    expect(remote.mount).toHaveBeenCalledTimes(1)
    expect(remote.mount).toHaveBeenCalledWith(TYPERT_REMOTE)
    expect(TYPERT_REMOTE.package).toBe('@deepseek-ai/dsh-experimental-session-decisions')

    const owner = declareSeats(ctx)
    expect(ctx.slots.entries('conversation.session.header.utilities')[0]!.component).toBe(QuestionCard)
    expect(ctx.slots.entries('sidebar.session.row.leading')[0]!.component).toBe(SessionQuestionMark)
    expect(ctx.slots.entries('tool.call.toolview')).toHaveLength(2)

    await dispose()
    expect(remote.disposeMount).toHaveBeenCalledTimes(1)
    expect(ctx.slots.entries('conversation.session.header.utilities')).toEqual([])
    expect(ctx.slots.entries('sidebar.session.row.leading')).toEqual([])
    expect(ctx.slots.entries('tool.call.toolview')).toEqual([])
    owner()
    await ctx.fiber.dispose()
  })

  it('rolls back the poll and dictionaries when the registration fails, and a retry registers cleanly', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const remote = new MountRemote(ctx, scriptedNamespace())
    // The failure injects after the source (poll interval) and the locale
    // dictionaries exist: the first `slots.inject` throws.
    const openIntervals = vi.spyOn(globalThis, 'setInterval')
    const clearedIntervals = vi.spyOn(globalThis, 'clearInterval')
    const injectSpy = vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot registration failed') })

    await expect(mountQuestionsUi(ctx, REMOTE)).rejects.toThrow('slot registration failed')
    expect(remote.disposeMount).toHaveBeenCalledTimes(1)
    // The failed attempt released its own poll timer and dictionaries: the
    // interval it opened was closed again, and the namespace is free.
    expect(openIntervals).toHaveBeenCalledTimes(1)
    expect(clearedIntervals).toHaveBeenCalledTimes(1)
    expect(ctx.locale.bind(NS)('title')).not.toBe(zh.title)
    expect(ctx.slots.entries('conversation.session.header.utilities')).toEqual([])

    // A retry registers cleanly (no leaked dictionary collision, no extra
    // timer) and leaves no interval after its own disposal.
    injectSpy.mockRestore()
    const dispose = await mountQuestionsUi(ctx, REMOTE)
    expect(openIntervals).toHaveBeenCalledTimes(2)
    const owner = declareSeats(ctx)
    expect(ctx.slots.entries('conversation.session.header.utilities')[0]!.component).toBe(QuestionCard)
    await dispose()
    expect(clearedIntervals).toHaveBeenCalledTimes(2)
    expect(ctx.slots.entries('conversation.session.header.utilities')).toEqual([])
    expect(ctx.locale.bind(NS)('title')).not.toBe(zh.title)
    owner()
    openIntervals.mockRestore()
    clearedIntervals.mockRestore()
    await ctx.fiber.dispose()
  })

  it('registers every seat without a mounted namespace, degrading to unavailable states', async () => {
    const ctx = await baseContext(undefined)
    const owner = declareSeats(ctx)
    const fiber = ctx.plugin({ inject: [...inject], apply: clientCtx => registerUi(clientCtx) })
    await fiber.await()
    expect(ctx.slots.entries('conversation.session.header.utilities')[0]!.component).toBe(QuestionCard)
    expect(ctx.slots.entries('sidebar.session.row.leading')[0]!.component).toBe(SessionQuestionMark)
    expect(ctx.slots.entries('tool.call.toolview')).toHaveLength(2)
    await fiber.dispose()
    expect(ctx.slots.entries('conversation.session.header.utilities')).toEqual([])
    owner()
    await ctx.fiber.dispose()
  })

  it('registerUi cleans up its own seats and dictionaries', async () => {
    const ctx = await baseContext(scriptedNamespace())
    const owner = declareSeats(ctx)
    const dispose = registerUi(ctx)
    expect(ctx.slots.entries('conversation.session.header.utilities')).toHaveLength(1)
    dispose()
    expect(ctx.slots.entries('conversation.session.header.utilities')).toEqual([])
    expect(ctx.slots.entries('sidebar.session.row.leading')).toEqual([])
    expect(ctx.slots.entries('tool.call.toolview')).toEqual([])
    const translate = ctx.locale.bind(NS)
    expect(translate('title')).not.toBe(zh.title)
    owner()
    await ctx.fiber.dispose()
  })
})


it('mounts over an existing namespace without a generated contribution and disposes all seats', async () => {
  const ctx = await baseContext(scriptedNamespace())
  const owner = declareSeats(ctx)
  try {
    const dispose = await mountQuestionsUi(ctx)
    expect(ctx.slots.entries('tool.call.toolview')).toHaveLength(2)
    await dispose()
    expect(ctx.slots.entries('tool.call.toolview')).toEqual([])
  } finally { owner(); await ctx.fiber.dispose() }
})

it('fails explicitly when a generated contribution has no Remote service', async () => {
  const ctx = new Context()
  try {
    await expect(mountQuestionsUi(ctx, REMOTE)).rejects.toThrow('requires the remote service')
  } finally { await ctx.fiber.dispose() }
})

it('keeps the registration error while releasing later allocations after a rollback failure', async () => {
  const ctx = await baseContext(scriptedNamespace())
  const owner = declareSeats(ctx)
  const original = ctx.slots.inject.bind(ctx.slots)
  const registration = vi.spyOn(ctx.slots, 'inject')
  registration.mockImplementationOnce((...args) => {
    const dispose = original(...args)
    return () => { dispose(); throw new Error('rollback failed') }
  }).mockImplementationOnce(() => { throw new Error('registration failed') })
  try {
    expect(() => registerUi(ctx)).toThrow('registration failed')
    expect(ctx.slots.entries('conversation.session.header.utilities')).toEqual([])
    expect(ctx.locale.bind(NS)('title')).not.toBe(zh.title)
  } finally { registration.mockRestore(); owner(); await ctx.fiber.dispose() }
})
