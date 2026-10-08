/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import {
  MINIMAX_API_KEY_NAME,
  MinimaxKeyCard,
} from '../src/client/MinimaxKeyCard.tsx'
import { zh } from '../src/client/locales.ts'
import type { MediaCredentialsRemotes } from '../src/client/remotes.ts'

const t = (key: keyof typeof zh) => zh[key]

function credentials(overrides: Partial<MediaCredentialsRemotes> = {}): MediaCredentialsRemotes {
  return {
    describe: vi.fn(async () => ({
      ok: true as const,
      value: { [MINIMAX_API_KEY_NAME]: { configured: false, writable: true } },
    })),
    set: vi.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

describe('MinimaxKeyCard', () => {
  it('saves a trimmed key and marks the card configured', async () => {
    const remotes = credentials()
    const view = render(<MinimaxKeyCard credentials={remotes} t={t} />)
    await waitFor(() => { expect(view.getByText(zh['settings.missing'])).toBeTruthy() })
    fireEvent.change(view.getByLabelText(zh['settings.apiKey']), { target: { value: '  sk-live  ' } })
    fireEvent.click(view.getByRole('button', { name: zh['settings.save'] }))
    await waitFor(() => {
      expect(remotes.set).toHaveBeenCalledWith(MINIMAX_API_KEY_NAME, 'sk-live')
    })
    await waitFor(() => { expect(view.getByText(zh['settings.configured'])).toBeTruthy() })
    expect((view.getByLabelText(zh['settings.apiKey']) as HTMLInputElement).value).toBe('')
  })

  it('refuses a blank draft and a missing credentials face', async () => {
    const remotes = credentials()
    const missing = render(<MinimaxKeyCard t={t} />)
    await waitFor(() => { expect(missing.getByRole('alert').textContent).toBe(zh['settings.saveFailed']) })
    expect(missing.getByLabelText(zh['settings.apiKey'])).toHaveProperty('disabled', true)
    missing.unmount()

    const view = render(<MinimaxKeyCard credentials={remotes} t={t} />)
    await waitFor(() => { expect(remotes.describe).toHaveBeenCalled() })
    fireEvent.click(view.getByRole('button', { name: zh['settings.save'] }))
    expect(view.getByRole('alert').textContent).toBe(zh['settings.blank'])
    expect(remotes.set).not.toHaveBeenCalled()
  })

  it('shows Host refuse text, then the generic failure when the message is blank', async () => {
    const named = credentials({
      set: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'credential/rejected', message: 'shadowed' },
      })),
    })
    const namedView = render(<MinimaxKeyCard credentials={named} t={t} />)
    await waitFor(() => { expect(named.describe).toHaveBeenCalled() })
    fireEvent.change(namedView.getByLabelText(zh['settings.apiKey']), { target: { value: 'k' } })
    fireEvent.click(namedView.getByRole('button', { name: zh['settings.save'] }))
    await waitFor(() => { expect(namedView.getByRole('alert').textContent).toBe('shadowed') })
    namedView.unmount()

    const blank = credentials({
      set: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'credential/rejected', message: '   ' },
      })),
    })
    const blankView = render(<MinimaxKeyCard credentials={blank} t={t} />)
    await waitFor(() => { expect(blank.describe).toHaveBeenCalled() })
    fireEvent.change(blankView.getByLabelText(zh['settings.apiKey']), { target: { value: 'k' } })
    fireEvent.submit(blankView.getByRole('button', { name: zh['settings.save'] }).closest('form')!)
    await waitFor(() => { expect(blankView.getByRole('alert').textContent).toBe(zh['settings.saveFailed']) })
  })

  it('locks a launch-environment key and ignores describe after unmount', async () => {
    let finish!: (value: Awaited<ReturnType<MediaCredentialsRemotes['describe']>>) => void
    const remotes = credentials({
      describe: vi.fn(() => new Promise<Awaited<ReturnType<MediaCredentialsRemotes['describe']>>>((resolve) => {
        finish = resolve
      })),
    })
    const pending = render(<MinimaxKeyCard credentials={remotes} t={t} />)
    pending.unmount()
    finish({
      ok: true,
      value: { [MINIMAX_API_KEY_NAME]: { configured: true, writable: true } },
    })

    const locked = credentials({
      describe: vi.fn(async () => ({
        ok: true as const,
        value: { [MINIMAX_API_KEY_NAME]: { configured: true, writable: false } },
      })),
    })
    const view = render(<MinimaxKeyCard credentials={locked} t={t} />)
    await waitFor(() => { expect(view.getByText(zh['settings.locked'])).toBeTruthy() })
    expect(view.getByText(zh['settings.configured'])).toBeTruthy()
    fireEvent.change(view.getByLabelText(zh['settings.apiKey']), { target: { value: 'k' } })
    fireEvent.click(view.getByRole('button', { name: zh['settings.save'] }))
    expect(locked.set).not.toHaveBeenCalled()
  })

  it('ignores a second submit while a save is in flight', async () => {
    let finish!: (value: Awaited<ReturnType<MediaCredentialsRemotes['set']>>) => void
    const remotes = credentials({
      set: vi.fn(() => new Promise<Awaited<ReturnType<MediaCredentialsRemotes['set']>>>((resolve) => {
        finish = resolve
      })),
    })
    const view = render(<MinimaxKeyCard credentials={remotes} t={t} />)
    await waitFor(() => { expect(remotes.describe).toHaveBeenCalled() })
    fireEvent.change(view.getByLabelText(zh['settings.apiKey']), { target: { value: 'k' } })
    fireEvent.click(view.getByRole('button', { name: zh['settings.save'] }))
    fireEvent.click(view.getByRole('button', { name: zh['settings.save'] }))
    expect(remotes.set).toHaveBeenCalledTimes(1)
    finish({ ok: true, value: undefined })
    await waitFor(() => { expect(view.getByText(zh['settings.configured'])).toBeTruthy() })
  })

  it('treats a refused or empty describe as unset and writable', async () => {
    const refused = credentials({
      describe: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'gateway/internal', message: 'down' },
      })),
    })
    const refusedView = render(<MinimaxKeyCard credentials={refused} t={t} />)
    await waitFor(() => { expect(refusedView.getByRole('alert').textContent).toBe(zh['settings.saveFailed']) })
    refusedView.unmount()

    const empty = credentials({
      describe: vi.fn(async () => ({ ok: true as const, value: {} })),
    })
    const emptyView = render(<MinimaxKeyCard credentials={empty} t={t} />)
    await waitFor(() => { expect(emptyView.getByText(zh['settings.missing'])).toBeTruthy() })
    expect(emptyView.getByLabelText(zh['settings.apiKey'])).toHaveProperty('disabled', false)
  })
})
