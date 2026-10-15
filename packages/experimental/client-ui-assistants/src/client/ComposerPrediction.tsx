import { useEffect, useRef, useState } from 'react'
import type { InputActions, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ComposerPredictionRequest,
  ComposerPredictionResult,
  ComposerPredictionContext,
} from '@deepseek-ai/dsh-experimental-assistant-registry/types'
import { NS, type AssistantLocaleKey } from './locales.ts'
import css from './ComposerPrediction.module.css'

/** Payload describing an available composer prediction. */
export interface ComposerPredictionData {
  readonly predictionId: string
  readonly text: string
  readonly asOfSeq: number
}

/** Injected properties for the ComposerPrediction component. */
export interface ComposerPredictionProps {
  /** The current prediction suggestion, or null/undefined if none. */
  readonly prediction?: ComposerPredictionData | null | undefined
  /** The current sequence number of the active conversation. */
  readonly currentSeq: number
  /** The current draft text in the composer input. */
  readonly draftText?: string | undefined
  /** Callback when the user adopts the prediction into the input. Strictly never submits. */
  readonly onAdopt: (text: string) => void
  /** Callback when the prediction is dismissed or cancelled. */
  readonly onDismiss?: (() => void) | undefined
  /** Localizer function for the assistants namespace. */
  readonly t: (key: AssistantLocaleKey) => string
}

/**
 * Contextual composer prediction suggestion with revision guarding and ghost-text acceptance.
 * Pressing Tab or clicking the button inserts the suggestion into the draft input and never submits.
 * Discarded automatically when typing, navigating away, or when sequence revision changes.
 * @param props - prediction data, current sequence, draft text, and adoption handlers.
 * @returns rendered prediction banner or null if discarded.
 */
export function ComposerPrediction({ prediction, currentSeq, draftText, onAdopt, onDismiss, t }: ComposerPredictionProps) {
  const [discardedId, setDiscardedId] = useState<string | null>(null)
  const discardedRef = useRef<Set<string>>(new Set())

  const isUserTyping = Boolean(draftText && draftText.trim().length > 0)
  if (isUserTyping && prediction) {
    discardedRef.current.add(prediction.predictionId)
    if (discardedId !== prediction.predictionId) {
      setDiscardedId(prediction.predictionId)
    }
  }

  const isDiscarded = Boolean(prediction && (discardedId === prediction.predictionId || discardedRef.current.has(prediction.predictionId)))

  // Discard if absent, outdated sequence revision, user has typed, or discarded
  const isEligible = Boolean(prediction && prediction.asOfSeq === currentSeq && !isUserTyping && !isDiscarded)

  useEffect(() => {
    if (!isEligible || !prediction) return

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        // Tab adopts suggestion into draft text; never submits!
        e.preventDefault()
        if (prediction) {
          discardedRef.current.add(prediction.predictionId)
          setDiscardedId(prediction.predictionId)
        }
        onAdopt(prediction.text)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        if (prediction) {
          discardedRef.current.add(prediction.predictionId)
          setDiscardedId(prediction.predictionId)
        }
        onDismiss?.()
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown)
    }
  }, [isEligible, prediction, onAdopt, onDismiss])

  if (!isEligible || !prediction) {
    return null
  }

  const handleAdoptClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Explicit click on adopt button; never triggers form submission
    e.preventDefault()
    e.stopPropagation()
    discardedRef.current.add(prediction.predictionId)
    setDiscardedId(prediction.predictionId)
    onAdopt(prediction.text)
  }

  const handleDismissClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    discardedRef.current.add(prediction.predictionId)
    setDiscardedId(prediction.predictionId)
    onDismiss?.()
  }

  return (
    <div className={css.container} role="status" aria-label={t('predictionLabel')} title={t('predictionHint')}>
      <span className={css.badge}>{t('predictionLabel')}</span>
      <span className={css.ghostText}>{prediction.text}</span>
      <div className={css.actions}>
        <button type="button" className={css.adoptButton} onClick={handleAdoptClick} aria-label={t('predictionAdoptTab')}>
          {t('predictionAdoptTab')}
        </button>
        <button type="button" className={css.dismissButton} onClick={handleDismissClick} aria-label={t('predictionDismiss')}>
          {t('predictionDismiss')}
        </button>
      </div>
    </div>
  )
}

/** Injected operations and data for Assistant Prediction Dock. */
export interface AssistantPredictionDockInjected {
  readonly predictComposer?:
    ((request: ComposerPredictionRequest, signal?: AbortSignal) => Promise<ComposerPredictionResult | null>) | undefined
  readonly getComposerContext?:
    ((sessionId: import('@deepseek-ai/dsh-session/types').SessionId) => Promise<ComposerPredictionContext | null>) | undefined
}

/** Component props for AssistantPredictionDock in conversation.input.dock. */
export type AssistantPredictionDockProps = PropsRuntime<'conversation.input.dock'> &
  AssistantPredictionDockInjected &
  PropsLocale<typeof NS> & {
    readonly seq?: number | undefined
  }

/**
 * Mounted container component for conversation.input.dock.
 * Subscribes to conversation/generation/sequence/draft guards, requests predictions
 * for eligible completed turns, and captures editable insertion into the composer.
 */
export function AssistantPredictionDock({
  sessionId,
  session,
  seq,
  input,
  inputActions,
  useInput,
  predictComposer,
  getComposerContext,
  t,
}: AssistantPredictionDockProps) {
  const [prediction, setPrediction] = useState<ComposerPredictionData | null>(null)
  const currentDraft = useInput ? useInput(s => s.draft) : (input?.draft ?? '')

  // Strict eligibility: session must be open, non-blank, not running, and not awaiting first turn
  const isEligible =
    session !== undefined && !session.blank && !session.running && !session.awaitingFirstTurn && session.openState === 'open'

  const [effectiveSeq, setEffectiveSeq] = useState(0)
  const requestedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    setPrediction(null)
    if (!predictComposer || !getComposerContext || !isEligible || currentDraft.trim().length > 0) return
    let active = true
    const abortController = new AbortController()
    void getComposerContext(sessionId)
      .then(async (context) => {
        if (!active || !context || context.asOfSeq <= 0) return null
        const key = `${sessionId}:${context.asOfSeq}`
        if (requestedKeyRef.current === key) return null
        requestedKeyRef.current = key
        setEffectiveSeq(context.asOfSeq)
        return predictComposer(
          { sessionId, asOfSeq: context.asOfSeq, recentTexts: context.recentTexts, draftText: currentDraft },
          abortController.signal,
        )
      })
      .then((result) => {
        if (!active || abortController.signal.aborted) return
        if (result && (!currentDraft || currentDraft.trim().length === 0)) {
          setPrediction({
            predictionId: result.predictionId,
            text: result.text,
            asOfSeq: result.asOfSeq,
          })
        } else {
          setPrediction(null)
        }
      })
      .catch(() => {
        if (active) setPrediction(null)
      })

    return () => {
      active = false
      abortController.abort()
    }
  }, [sessionId, session, isEligible, seq, currentDraft, predictComposer, getComposerContext])

  if (!prediction || !isEligible || currentDraft.trim().length > 0) return null

  const handleAdopt = (text: string) => {
    const actions = inputActions ?? (input as { actions?: InputActions } | undefined)?.actions
    if (actions) {
      if (typeof actions.captureInsertion === 'function' && typeof actions.insertText === 'function') {
        const span: TokenSpan = actions.captureInsertion()
        actions.insertText(text, span)
      } else if (typeof actions.setDraft === 'function') {
        actions.setDraft(text)
      }
    }
    setPrediction(null)
  }

  const handleDismiss = () => {
    setPrediction(null)
  }

  return (
    <ComposerPrediction
      prediction={prediction}
      currentSeq={effectiveSeq}
      draftText={currentDraft}
      onAdopt={handleAdopt}
      onDismiss={handleDismiss}
      t={t}
    />
  )
}
