import { useEffect, useState } from 'react'
import type { AssistantProfile } from '@deepseek-ai/dsh-experimental-assistant-registry'
import type { InputActions, TokenSpan } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './AssistantExampleChips.module.css'

/** Injected operations and data for Assistant Example Chips. */
export interface AssistantExampleChipsInjected {
  /** Resolve the profile bound to this session, if any. */
  loadProfile: () => Promise<AssistantProfile | undefined>
  examples?: readonly string[] | undefined
  inputActions?: InputActions | undefined
}

/** Component props for AssistantExampleChips in conversation.input.dock. */
export type AssistantExampleChipsProps =
  PropsRuntime<'conversation.input.dock'>
  & AssistantExampleChipsInjected
  & PropsLocale<typeof NS>

/**
 * Derives default role-specific prompts for an assistant when not explicitly provided.
 * @param profile - assistant profile with name and responsibility.
 * @param t - translator for the assistants namespace.
 * @returns up to three role-specific prompts.
 */
function defaultRolePrompts(profile: AssistantProfile, t?: TranslateNS<typeof NS>): readonly string[] {
  if (!t) return []
  const name = profile.name || t('defaultAssistantName')
  return [
    t('chipPromptIntro', { name }),
    t('chipPromptPlan'),
    t('chipPromptAnalyze'),
  ]
}

/**
 * Role-specific example chips rendered in conversation.input.dock.
 * Loads its bound profile through the injected loader; guards against
 * overwriting existing drafts and uses revision-guarded insertion without
 * submitting.
 * @param props - input zone state, actions, and the profile loader.
 * @returns rendered example chips or null if hidden.
 */
export function AssistantExampleChips({
  input,
  inputActions,
  loadProfile,
  examples: providedExamples,
  t,
}: AssistantExampleChipsProps) {
  const [profile, setProfile] = useState<AssistantProfile | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void loadProfile()
      .then((next) => { if (alive) setProfile(next) })
      .catch(() => {})
    return () => { alive = false }
  }, [loadProfile])

  if (!profile) return null

  const draftText = typeof input?.draft === 'string'
    ? input.draft
    : ''

  // Never overwrite or show chips over a non-empty draft
  if (draftText.trim().length > 0) {
    return null
  }

  const examples = (providedExamples && providedExamples.length > 0
    ? providedExamples
    : defaultRolePrompts(profile, t)
  ).slice(0, 3)

  if (examples.length === 0) return null

  const handleChipClick = (text: string) => {
    // Double check draft is empty before inserting
    if (draftText.trim().length > 0) {
      return
    }

    const actions = inputActions ?? (input as { actions?: InputActions } | undefined)?.actions
    if (!actions) return

    const span: TokenSpan = actions.captureInsertion()
    actions.insertText(text, span)
  }

  return (
    <div className={css.container}>
      {examples.map((text, idx) => (
        <button
          key={idx}
          type="button"
          className={css.chip}
          onClick={() => { handleChipClick(text) }}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
