// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ComposerPrediction, type ComposerPredictionData } from '../src/client/ComposerPrediction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const tZh = makeTranslate(zh)

const samplePrediction: ComposerPredictionData = {
  predictionId: 'pred-101',
  text: 'Can you summarize the performance implications?',
  asOfSeq: 12,
}

describe('ComposerPrediction (S24 Client UI)', () => {
  it('renders suggestion when prediction matches sequence revision and draft is empty', () => {
    render(
      <ComposerPrediction
        prediction={samplePrediction}
        currentSeq={12}
        draftText=""
        onAdopt={vi.fn()}
        onDismiss={vi.fn()}
        t={tZh}
      />,
    )

    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.getByText('建议追问')).toBeDefined()
    expect(screen.getByText('Can you summarize the performance implications?')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Tab 采用' })).toBeDefined()
    expect(screen.getByRole('button', { name: '忽略' })).toBeDefined()
  })

  it('adopts suggestion on button click and strictly never triggers form submission', () => {
    const onAdopt = vi.fn()
    const onSubmitForm = vi.fn()

    render(
      <form onSubmit={onSubmitForm}><div data-composer-card><div role="textbox" contentEditable data-composer-input aria-label="editor" />
        <ComposerPrediction
          prediction={samplePrediction}
          currentSeq={12}
          draftText=""
          onAdopt={onAdopt}
          onDismiss={vi.fn()}
          t={tZh}
        />
      </div></form>,
    )

    const adoptBtn = screen.getByRole('button', { name: 'Tab 采用' })
    fireEvent.click(adoptBtn)

    expect(onAdopt).toHaveBeenCalledTimes(1)
    expect(onAdopt).toHaveBeenCalledWith('Can you summarize the performance implications?')
    // CRITICAL: Must NEVER submit form
    expect(onSubmitForm).not.toHaveBeenCalled()
  })

  it('adopts suggestion on Tab keypress and prevents default navigation without submitting form', () => {
    const onAdopt = vi.fn()
    const onSubmitForm = vi.fn()

    render(
      <form onSubmit={onSubmitForm}><div data-composer-card><div role="textbox" contentEditable data-composer-input aria-label="editor" />
        <ComposerPrediction
          prediction={samplePrediction}
          currentSeq={12}
          draftText=""
          onAdopt={onAdopt}
          onDismiss={vi.fn()}
          t={tZh}
        />
      </div></form>,
    )

    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    screen.getByLabelText('editor').focus()
    screen.getByLabelText('editor').dispatchEvent(tabEvent)

    expect(onAdopt).toHaveBeenCalledTimes(1)
    expect(onAdopt).toHaveBeenCalledWith('Can you summarize the performance implications?')
    expect(onSubmitForm).not.toHaveBeenCalled()
  })

  it('dismisses suggestion on Dismiss button click', () => {
    const onDismiss = vi.fn()

    render(
      <ComposerPrediction
        prediction={samplePrediction}
        currentSeq={12}
        draftText=""
        onAdopt={vi.fn()}
        onDismiss={onDismiss}
        t={tZh}
      />,
    )

    const dismissBtn = screen.getByRole('button', { name: '忽略' })
    fireEvent.click(dismissBtn)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('dismisses suggestion on Escape keypress', () => {
    const onDismiss = vi.fn()

    render(
      <div data-composer-card><div role="textbox" contentEditable data-composer-input aria-label="editor" /><ComposerPrediction
        prediction={samplePrediction}
        currentSeq={12}
        draftText=""
        onAdopt={vi.fn()}
        onDismiss={onDismiss}
        t={tZh}
      /></div>,
    )

    const escapeEvent = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    screen.getByLabelText('editor').focus()
    screen.getByLabelText('editor').dispatchEvent(escapeEvent)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not render when sequence revision does not match (revision guarded)', () => {
    const { container } = render(
      <ComposerPrediction
        prediction={samplePrediction}
        currentSeq={13} // Turn advanced from 12 to 13
        draftText=""
        onAdopt={vi.fn()}
        onDismiss={vi.fn()}
        t={tZh}
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('does not render when user is typing in draftText (cancelled on typing)', () => {
    const { container } = render(
      <ComposerPrediction
        prediction={samplePrediction}
        currentSeq={12}
        draftText="Tell me about..." // User is actively typing
        onAdopt={vi.fn()}
        onDismiss={vi.fn()}
        t={tZh}
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('does not render when prediction is null or undefined', () => {
    const { container } = render(
      <ComposerPrediction
        prediction={null}
        currentSeq={12}
        draftText=""
        onAdopt={vi.fn()}
        onDismiss={vi.fn()}
        t={tZh}
      />,
    )

    expect(container.firstChild).toBeNull()
  })
})
