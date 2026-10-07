/**
 * Keyed tool card for media creation, speech, clone, and compose.
 */

import { useState } from 'react'
import { DisclosureRow, IconPlayOutline16, IconSparkle16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { mediaCardModel, type MediaRowState } from './card-model.ts'
import { NS, type MediaKey } from './locales.ts'
import type { MediaSessionRemotes } from './remotes.ts'
import { setWorksOpen } from './works-state.ts'
import { VoicePicker, encodeMediaBytes } from './VoicePicker.tsx'
import css from './MediaCard.module.css'

/** Injected remotes and session for card actions. */
export interface MediaCardInjected {
  remotes: MediaSessionRemotes
  sessionId: string
  workspaceId?: string
  onCloneImported?: (artifactId: string, label: string, speakerIsUser: boolean) => void
}

/** Full props of a media tool card. */
export type MediaCardProps = ToolCallViewProps & MediaCardInjected & PropsLocale<typeof NS>

const TITLE: Record<string, MediaKey> = {
  media_create_video: 'card.video',
  media_synthesize_speech: 'card.speech',
  media_clone_voice: 'voice.add',
  media_compose: 'card.composed',
}

const STATUS: Readonly<Record<MediaRowState, MediaKey | null>> = {
  running: 'card.running',
  ok: null,
  error: 'card.failed',
  stopped: 'card.stopped',
}

/**
 * Render one media tool call.
 * @param props - keyed toolview payload, remotes, and locale.
 * @returns the media card.
 */
export function MediaCard({
  toolName, block, remotes, sessionId, workspaceId, onCloneImported, t,
}: MediaCardProps) {
  const model = mediaCardModel(block)
  const [expanded, setExpanded] = useState(false)
  const statusKey = STATUS[model.state]
  const title = t(TITLE[toolName] ?? 'card.import')
  const artifactId = model.artifactId
  return (
    <div className={css.card} data-tool={toolName} data-state={model.state}>
      <DisclosureRow
        icon={model.state === 'error'
          ? <StateDot state="error" />
          : toolName === 'media_synthesize_speech' || toolName === 'media_clone_voice'
            ? <IconSparkle16 />
            : <IconPlayOutline16 />}
        title={title}
        open={expanded}
        expandable
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            {statusKey === null ? null : <span className={css.hidden}>{t(statusKey)}</span>}
            <span className={css.summary}>{model.output ?? model.requestId ?? model.jobId ?? toolName}</span>
          </>
        )}
      >
        <div className={css.body}>
          {artifactId === null
            ? null
            : (
              <div className={css.actions}>
                <button type="button" onClick={() => { void remotes.openMediaWork({ artifactId }) }}>
                  {t('card.open')}
                </button>
                <button type="button" onClick={() => { void remotes.revealMediaWork({ artifactId }) }}>
                  {t('card.reveal')}
                </button>
                <button type="button" onClick={() => { setWorksOpen(true) }}>
                  {t('card.works')}
                </button>
              </div>
            )}
          {toolName === 'media_synthesize_speech' || toolName === 'media_clone_voice'
            ? (
              <VoicePicker
                remotes={remotes}
                sessionId={sessionId}
                encodeBytes={encodeMediaBytes}
                t={t}
                {...workspaceId === undefined ? {} : { workspaceId }}
                {...onCloneImported === undefined ? {} : { onImported: onCloneImported }}
              />
            )
            : null}
        </div>
      </DisclosureRow>
    </div>
  )
}
