/** Compact composer control for explicit VS Code editor-context capture. */

import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCodeOutline16, Menu, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './ContextButton.module.css'

/** Explicit editor capture choices exposed by the composer control. */
export type EditorCaptureKind = 'selection' | 'file' | 'diagnostics'

/** Business callbacks injected into the context control. */
export interface ContextButtonInjected {
  /**
   * Capture and append one explicit editor snapshot.
   * @param kind - user-selected capture action.
   * @returns true when a chip was inserted; false when no source context exists.
   */
  capture: (kind: EditorCaptureKind) => Promise<boolean>
}

/** Full context-control props from the input-left owner, inject, and locale shares. */
export type ContextButtonProps = PropsRuntime<'conversation.input.left'>
  & InjectFace<ContextButtonInjected>
  & PropsLocale<'vscode'>

/** Explicit editor-context dropdown occupying one composer tool-row seat. */
export function ContextButton({ input, session, capture, t }: ContextButtonProps) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; title?: string } | null>(null)
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false }, [])

  const busy = input.phase === 'adjudicating' || input.phase === 'submitting'
  const disabled = busy || session.removed
  const items: MenuEntry[] = [
    { id: 'selection', label: t('context.selection') },
    { id: 'file', label: t('context.file') },
    { id: 'diagnostics', label: t('context.diagnostics') },
  ]
  const choose = (id: string): void => {
    setOpen(false)
    setPending(true)
    setFeedback(null)
    void capture(id as EditorCaptureKind).then(
      (inserted) => {
        if (!alive.current) return
        setPending(false)
        if (!inserted) setFeedback({ text: t('context.empty') })
      },
      (reason: unknown) => {
        if (!alive.current) return
        setPending(false)
        setFeedback({
          text: t('context.failed'),
          title: reason instanceof Error ? reason.message : String(reason),
        })
      },
    )
  }

  return (
    <span className={css.root}>
      <Menu
        open={open}
        side="top"
        compact
        items={items}
        onClose={() => { setOpen(false) }}
        onSelect={choose}
        anchor={(
          <button
            type="button"
            className={css.button}
            aria-label={t('context.button.aria')}
            title={t('context.button.title')}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={disabled || pending}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconCodeOutline16 />
          </button>
        )}
      />
      {feedback !== null && <span className={css.status} role="status" title={feedback.title}>{feedback.text}</span>}
    </span>
  )
}
