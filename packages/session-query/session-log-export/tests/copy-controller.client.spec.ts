// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionMarkdownCopyController } from '../src/client/copy-controller.ts'

const SID = 'session-copy-controller' as SessionId
const OTHER = 'session-copy-other' as SessionId

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SessionMarkdownCopyController', () => {
  it('writes the prepared transcript through the clipboard primitive after the read', async () => {
    const responses = Promise.withResolvers<Response>()
    const writeText = vi.fn(async () => true)
    const controller = new SessionMarkdownCopyController(
      (_input: string | URL, _init?: RequestInit) => responses.promise,
      { writeText },
    )

    const pending = controller.copy(SID)
    expect(writeText).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot().copying).toBe(true)
    responses.resolve(new Response('# Title\n\nText\n'))
    await pending

    expect(writeText).toHaveBeenCalledWith('# Title\n\nText\n')
    expect(controller.store.getSnapshot()).toMatchObject({
      copying: false,
      notice: { kind: 'success' },
    })
  })

  it('joins a second-Session request to the pending copy and keeps its captured target', async () => {
    const responses = Promise.withResolvers<Response>()
    const fetcher = vi.fn((_input: string | URL, _init?: RequestInit) => responses.promise)
    const controller = new SessionMarkdownCopyController(fetcher, { writeText: async () => true })

    const first = controller.copy(SID)
    const second = controller.copy(OTHER)
    expect(first).toBe(second)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]?.[0]).toBe(`api/session.markdown?sessionId=${SID}`)

    responses.resolve(new Response('markdown for first'))
    await first
    expect(controller.store.getSnapshot().copying).toBe(false)

    await controller.copy(OTHER)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]?.[0]).toBe(`api/session.markdown?sessionId=${OTHER}`)
  })

  it('classifies HTTP and transport failures as preparation failures', async () => {
    const http = new SessionMarkdownCopyController(
      async () => new Response('hidden detail', { status: 500 }),
      { writeText: vi.fn(async () => true) },
    )
    await http.copy(SID)
    expect(http.store.getSnapshot().notice?.kind).toBe('preparationFailed')

    const transport = new SessionMarkdownCopyController(
      async () => { throw new Error('offline') },
      { writeText: vi.fn(async () => true) },
    )
    await transport.copy(SID)
    expect(transport.store.getSnapshot().notice?.kind).toBe('preparationFailed')
  })

  it('classifies a rejected or throwing clipboard write as a clipboard failure', async () => {
    const rejected = new SessionMarkdownCopyController(
      async () => new Response('markdown'),
      { writeText: async () => false },
    )
    await rejected.copy(SID)
    expect(rejected.store.getSnapshot().notice?.kind).toBe('clipboardFailed')

    const throwing = new SessionMarkdownCopyController(
      async () => new Response('markdown'),
      { writeText: async () => { throw new Error('write failed') } },
    )
    await throwing.copy(SID)
    expect(throwing.store.getSnapshot().notice?.kind).toBe('clipboardFailed')
  })

  it('aborts the read and does not write after disposal before readiness', async () => {
    const responses = Promise.withResolvers<Response>()
    const writeText = vi.fn(async () => true)
    const controller = new SessionMarkdownCopyController(
      (_input: string | URL, _init?: RequestInit) => responses.promise,
      { writeText },
    )

    const pending = controller.copy(SID)
    const disposing = controller.dispose()
    responses.resolve(new Response('late markdown'))
    await disposing
    await pending

    expect(writeText).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot()).toEqual({ copying: false, notice: null })
  })

  it('awaits an admitted clipboard write and suppresses its notice on disposal', async () => {
    const writeGate = Promise.withResolvers<boolean>()
    const controller = new SessionMarkdownCopyController(
      async () => new Response('markdown'),
      { writeText: () => writeGate.promise },
    )

    const pending = controller.copy(SID)
    await vi.waitFor(() => { expect(controller.store.getSnapshot().copying).toBe(true) })
    const disposing = controller.dispose()
    writeGate.resolve(true)
    await disposing
    await pending

    expect(controller.store.getSnapshot()).toEqual({ copying: false, notice: null })
  })

  it('suppresses a preparation failure after disposal', async () => {
    const responses = Promise.withResolvers<Response>()
    const controller = new SessionMarkdownCopyController(
      (_input: string | URL, _init?: RequestInit) => responses.promise,
      { writeText: vi.fn(async () => true) },
    )

    const pending = controller.copy(SID)
    const disposing = controller.dispose()
    responses.reject(new Error('late read failure'))
    await disposing
    await pending

    expect(controller.store.getSnapshot()).toEqual({ copying: false, notice: null })
  })

  it('ignores copy after disposal', async () => {
    const writeText = vi.fn(async () => true)
    const controller = new SessionMarkdownCopyController(
      async () => new Response('markdown'),
      { writeText },
    )
    await controller.dispose()
    await expect(controller.copy(SID)).resolves.toBeUndefined()
    expect(writeText).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot()).toEqual({ copying: false, notice: null })
  })

  it('dismisses a notice and ignores a dismissal with no notice', async () => {
    const controller = new SessionMarkdownCopyController(
      async () => new Response('markdown'),
      { writeText: async () => true },
    )
    controller.dismiss()
    expect(controller.store.getSnapshot().notice).toBeNull()

    await controller.copy(SID)
    expect(controller.store.getSnapshot().notice?.kind).toBe('success')
    controller.dismiss()
    expect(controller.store.getSnapshot().notice).toBeNull()
  })

  it('uses the document-relative route and writeClipboard by default', async () => {
    const fetcher = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response('default markdown'))
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const controller = new SessionMarkdownCopyController()

    await controller.copy(SID)

    expect(fetcher).toHaveBeenCalledOnce()
    const [route, init] = fetcher.mock.calls[0]!
    expect(route).toBe(`api/session.markdown?sessionId=${SID}`)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(writeText).toHaveBeenCalledWith('default markdown')
    expect(writeClipboard).toBeTypeOf('function')
    expect(controller.store.getSnapshot().notice?.kind).toBe('success')
  })
})
