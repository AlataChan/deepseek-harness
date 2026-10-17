import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { InputActions, InputZone, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { GlobalStandardProps, SessionStandardProps, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
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
  /** Insert without submitting; return false to retain a refused suggestion for retry. */
  readonly onAdopt: (text: string) => boolean | void
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
 * @returns an inline suggestion or null when unavailable.
 */
export function ComposerPrediction({ prediction, currentSeq, draftText, onAdopt, onDismiss, t }: ComposerPredictionProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [discardedId, setDiscardedId] = useState<string | null>(null)
  const discardedRef = useRef<Set<string>>(new Set())

  const isUserTyping = Boolean(draftText && draftText.length > 0)
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

    const container = containerRef.current
    const card = container?.closest<HTMLElement>('[data-composer-card]')
    if (!card) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key !== 'Tab' && e.key !== 'Escape') return
      if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.isComposing || ('keyCode' in e && (e as { keyCode: number }).keyCode === 229)) return

      const editor = card.querySelector<HTMLElement>('[data-composer-input]')
      if (!editor) return
      const active = document.activeElement
      const target = e.target
      if (!active || (active !== editor && !editor.contains(active))) return
      if (!(target instanceof Node) || (target !== editor && !editor.contains(target))) return
      if (editor.hasAttribute('data-composer-composing')) return

      // Respect open menus
      if (card) {
        const openMenu = card.querySelector('[aria-expanded="true"], [role="menu"], [role="listbox"], [data-composer-menu]')
        if (openMenu) return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        if (onAdopt(prediction.text) !== false) {
          discardedRef.current.add(prediction.predictionId)
          setDiscardedId(prediction.predictionId)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (prediction) {
          discardedRef.current.add(prediction.predictionId)
          setDiscardedId(prediction.predictionId)
        }
        onDismiss?.()
      }
    }

    const eventTarget = card
    eventTarget.addEventListener('keydown', handleKeyDown as EventListener, false)
    return () => {
      eventTarget.removeEventListener('keydown', handleKeyDown as EventListener, false)
    }
  }, [isEligible, prediction, onAdopt, onDismiss])

  useLayoutEffect(() => {
    if (!isEligible) return
    const container = containerRef.current
    const card = container?.closest<HTMLElement>('[data-composer-card]')
    const editor = card?.querySelector<HTMLElement>('[data-composer-input]')
    const anchor = container?.offsetParent
    if (!container || !card || !editor) return
    const placeholder = card.querySelector<HTMLElement>('[data-composer-placeholder]')
    const oldVisibility = placeholder?.style.visibility ?? ''
    const measure = () => {
      const bounds = editor.getBoundingClientRect()
      const origin = (anchor instanceof HTMLElement ? anchor : container.parentElement)?.getBoundingClientRect()
      const style = getComputedStyle(editor)
      container.style.left = `${bounds.left - (origin?.left ?? 0)}px`
      container.style.top = `${bounds.top - (origin?.top ?? 0)}px`
      container.style.width = `${bounds.width}px`
      container.style.font = style.font
      container.style.lineHeight = style.lineHeight
      container.style.padding = style.padding
    }
    measure()
    if (placeholder) placeholder.style.visibility = 'hidden'
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(editor)
    observer?.observe(card)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      if (placeholder) placeholder.style.visibility = oldVisibility
    }
  }, [isEligible])

  if (!isEligible || !prediction) {
    return null
  }

  const handleAdoptClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Explicit click on adopt button; never triggers form submission
    e.preventDefault()
    e.stopPropagation()
    const editor = containerRef.current?.closest('[data-composer-card]')?.querySelector('[data-composer-input]')
    if (editor?.hasAttribute('data-composer-composing')) return
    if (onAdopt(prediction.text) !== false) {
      discardedRef.current.add(prediction.predictionId)
      setDiscardedId(prediction.predictionId)
    }
  }

  const handleDismissClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    discardedRef.current.add(prediction.predictionId)
    setDiscardedId(prediction.predictionId)
    onDismiss?.()
  }

  return (
    <div ref={containerRef} data-composer-prediction className={css.container} role="status" aria-label={t('predictionLabel')} title={t('predictionHint')}>
      <span className={css.srOnly}>{t('predictionLabel')}</span>
      <span data-composer-prediction-text className={css.ghostText}>{prediction.text}</span>
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
    ((sessionId: SessionId) => Promise<ComposerPredictionContext | null>) | undefined
  readonly isPredictionEnabled?: (() => boolean) | undefined
  readonly subscribePredictionEnabled?: ((listener: () => void) => () => void) | undefined
  /** Identity of the conversation's next provider/model/reasoning selection. */
  readonly getPredictionRouteIdentity?: (() => string) | undefined
  /** Observe durable selection changes without starting another inference. */
  readonly subscribePredictionRoute?: ((listener: () => void) => () => void) | undefined
}

/** Component props for AssistantPredictionDock in conversation.input.dock or overlay. */
export type AssistantPredictionDockProps =
  (
    | (Partial<GlobalStandardProps> & Partial<SessionStandardProps>)
    | PropsRuntime<'conversation.input.dock'>
    | PropsRuntime<'conversation.input.overlay'>
  ) &
  Partial<InputZone> &
  AssistantPredictionDockInjected &
  PropsLocale<typeof NS> & {
    readonly sessionId: SessionId
    readonly session?: SessionSnapshot | undefined
    readonly seq?: number | undefined
  }

/**
 * Mounted container component for conversation.input.dock or overlay.
 * Subscribes to conversation/generation/sequence/draft guards, requests predictions
 * for eligible completed turns, and captures editable insertion into the composer.
 */
export function AssistantPredictionDock(props: AssistantPredictionDockProps) {
  const {
    sessionId,
    inputActions,
    useInput,
    useSession,
    predictComposer,
    getComposerContext,
    isPredictionEnabled,
    subscribePredictionEnabled,
    getPredictionRouteIdentity,
    subscribePredictionRoute,
    t,
  } = props
  const session = 'session' in props ? props.session : undefined
  const input = 'input' in props ? props.input : undefined
  const [prediction, setPrediction] = useState<ComposerPredictionData | null>(null)
  const currentDraft = useInput ? useInput(s => s.draft) : (input?.draft ?? '')
  const currentDraftRev = useInput ? useInput(s => s.draftRev) : (input?.draftRev ?? 0)

  // Strict eligibility: session must be open, non-blank, not running, and not awaiting first turn
  const currentSession = session ?? (useSession ? useSession(s => s) : undefined)
  const sessionRunning = currentSession?.running ?? false
  const sessionBlank = currentSession?.blank ?? false
  const sessionOpenState = currentSession?.openState
  const sessionAwaitingFirstTurn = currentSession?.awaitingFirstTurn ?? false

  const isEligible =
    currentSession !== undefined && !sessionBlank && !sessionRunning && !sessionAwaitingFirstTurn && sessionOpenState === 'open'

  const [effectiveSeq, setEffectiveSeq] = useState(0)
  const [completion, setCompletion] = useState(0)
  const [, refreshPolicy] = useState(0)
  const observedRef = useRef({ sessionId, running: sessionRunning, completedPending: false })
  const requestRef = useRef<AbortController | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const composingRef = useRef(false)
  const dismissedKeysRef = useRef<Set<string>>(new Set())
  const capturedSpanRef = useRef<TokenSpan | null>(null)
  const ownerRef = useRef<{ sessionId: SessionId; draftRev: number; route: string | undefined } | null>(null)
  const attemptedCompletionRef = useRef(0)
  const liveRef = useRef({ sessionId, currentDraft, currentDraftRev, isEligible, effectiveSeq })
  liveRef.current = { sessionId, currentDraft, currentDraftRev, isEligible, effectiveSeq }

  const invalidatePrediction = useCallback(() => {
    requestRef.current?.abort()
    requestRef.current = null
    ownerRef.current = null
    capturedSpanRef.current = null
    const live = liveRef.current
    if (live.effectiveSeq > 0) dismissedKeysRef.current.add(`${live.sessionId}:${live.effectiveSeq}`)
    setPrediction(null)
  }, [])

  useLayoutEffect(() => {
    composingRef.current = false
    const card = anchorRef.current?.closest('[data-composer-card]')
    if (!card) return
    const editor = card.querySelector('[data-composer-input]')
    const ownsEvent = (event: Event) => event.target instanceof Node && editor?.contains(event.target)
    const start = (event: Event) => {
      if (!ownsEvent(event)) return
      composingRef.current = true
      invalidatePrediction()
    }
    const end = (event: Event) => { if (ownsEvent(event)) composingRef.current = false }
    card.addEventListener('compositionstart', start)
    card.addEventListener('compositionend', end)
    return () => {
      card.removeEventListener('compositionstart', start)
      card.removeEventListener('compositionend', end)
    }
  }, [sessionId, invalidatePrediction])

  useLayoutEffect(() => {
    if (!getPredictionRouteIdentity || !subscribePredictionRoute) return
    let previous = getPredictionRouteIdentity()
    return subscribePredictionRoute(() => {
      const next = getPredictionRouteIdentity()
      if (next === previous) return
      previous = next
      invalidatePrediction()
    })
  }, [sessionId, getPredictionRouteIdentity, subscribePredictionRoute, invalidatePrediction])

  // Only an observed foreground turn completion grants an inference opportunity.
  useEffect(() => {
    const previous = observedRef.current
    const sameSession = previous.sessionId === sessionId
    const completedPending = sameSession && !sessionRunning &&
      (previous.completedPending || previous.running)
    observedRef.current = { sessionId, running: sessionRunning, completedPending }
    // Completion projections can settle after running becomes false.
    if (completedPending && isEligible) {
      observedRef.current.completedPending = false
      setCompletion(value => value + 1)
    }
    if (previous.sessionId !== sessionId || sessionRunning || !isEligible) {
      requestRef.current?.abort()
      setPrediction(null)
    }
  }, [sessionId, sessionRunning, isEligible])

  useEffect(() => {
    if (!subscribePredictionEnabled) return
    let previousEnabled = isPredictionEnabled ? isPredictionEnabled() : true
    return subscribePredictionEnabled(() => {
      const enabled = isPredictionEnabled ? isPredictionEnabled() : true
      if (enabled === previousEnabled) return
      previousEnabled = enabled
      // Invalidate even if a disable/enable pair settles before React renders.
      requestRef.current?.abort()
      requestRef.current = null
      setPrediction(null)
      refreshPolicy(value => value + 1)
    })
  }, [subscribePredictionEnabled, isPredictionEnabled])

  useEffect(() => {
    if (currentDraft.length > 0) {
      if (effectiveSeq > 0) dismissedKeysRef.current.add(`${sessionId}:${effectiveSeq}`)
      requestRef.current?.abort()
      setPrediction(null)
    }
  }, [sessionId, effectiveSeq, currentDraft])

  useEffect(() => {
    if (!completion || attemptedCompletionRef.current === completion) return
    attemptedCompletionRef.current = completion
    if ((isPredictionEnabled && !isPredictionEnabled()) || !isEligible || currentDraft.length > 0 || composingRef.current) return
    if (!predictComposer || !getComposerContext) return
    const controller = new AbortController()
    requestRef.current = controller
    const capturedDraftRev = currentDraftRev
    const capturedRoute = getPredictionRouteIdentity?.()
    ownerRef.current = { sessionId, draftRev: capturedDraftRev, route: capturedRoute }
    const actions = inputActions ?? (input as { actions?: InputActions } | undefined)?.actions
    capturedSpanRef.current = actions?.captureInsertion() ?? null
    const ownsRequest = () => {
      const live = liveRef.current
      return requestRef.current === controller && !controller.signal.aborted &&
        live.sessionId === sessionId && live.currentDraftRev === capturedDraftRev &&
        live.currentDraft.length === 0 && live.isEligible &&
        !composingRef.current && getPredictionRouteIdentity?.() === capturedRoute &&
        (!isPredictionEnabled || isPredictionEnabled())
    }
    void getComposerContext(sessionId).then(async (context) => {
      if (!ownsRequest() || !context || context.asOfSeq <= 0) return null
      const requestKey = `${sessionId}:${context.asOfSeq}`
      if (dismissedKeysRef.current.has(requestKey)) return null
      setEffectiveSeq(context.asOfSeq)
      return predictComposer({ sessionId, asOfSeq: context.asOfSeq, recentTexts: context.recentTexts, draftText: '' }, controller.signal)
    }).then((result) => {
      if (!ownsRequest()) return
      if (result && !dismissedKeysRef.current.has(`${sessionId}:${result.asOfSeq}`)) {
        setPrediction({ predictionId: result.predictionId, text: result.text, asOfSeq: result.asOfSeq })
      }
    }).catch(() => {
      if (ownsRequest()) setPrediction(null)
    })
    return () => { controller.abort() }
  }, [completion, sessionId, isEligible, currentDraft, currentDraftRev])

  const visible = prediction && isEligible && currentDraft.length === 0 && !composingRef.current &&
    ownerRef.current?.sessionId === sessionId && ownerRef.current.draftRev === currentDraftRev &&
    ownerRef.current.route === getPredictionRouteIdentity?.() && (!isPredictionEnabled || isPredictionEnabled())

  const handleAdopt = (text: string): boolean => {
    const live = liveRef.current
    const editor = anchorRef.current?.closest('[data-composer-card]')?.querySelector('[data-composer-input]')
    if (!live.isEligible || live.sessionId !== sessionId || live.currentDraft.length > 0 ||
      composingRef.current || editor?.hasAttribute('data-composer-composing') ||
      ownerRef.current?.route !== getPredictionRouteIdentity?.() ||
      (isPredictionEnabled && !isPredictionEnabled())) return false
    const actions = inputActions ?? (input as { actions?: InputActions } | undefined)?.actions
    if (!actions || !capturedSpanRef.current) return false
    if (!actions.insertText(text, capturedSpanRef.current)) return false
    dismissedKeysRef.current.add(`${sessionId}:${effectiveSeq}`)
    setPrediction(null)
    return true
  }
  const handleDismiss = () => {
    dismissedKeysRef.current.add(`${sessionId}:${effectiveSeq}`)
    setPrediction(null)
  }
  return <><span ref={anchorRef} hidden />{visible && <ComposerPrediction prediction={prediction} currentSeq={effectiveSeq}
    draftText={currentDraft}
    onAdopt={handleAdopt} onDismiss={handleDismiss} t={t} />}</>
}
