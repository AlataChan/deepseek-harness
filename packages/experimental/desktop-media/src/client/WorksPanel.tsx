/**
 * Dismissible Works overlay list.
 */

import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { IconCloseOutlineRegular, IconCopyOutlineRegular, IconDownloadOutlineRegular, IconFolderOpenOutlineRegular, IconPlayOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { NS } from './locales.ts'
import type { MediaSessionRemotes, MediaWorkRow } from './remotes.ts'
import { setWorksOpen, subscribeWorks, worksOpen } from './works-state.ts'
import css from './WorksPanel.module.css'

/** One row from `sessions.list`. */
export interface ListedSession {
  readonly id: string
  readonly workspaceId?: string
}

/** Actions injected by the browser plugin. */
export interface WorksPanelInjected {
  remotes: MediaSessionRemotes
  current?: ListedSession
  sessionsById: Readonly<Record<string, ListedSession>>
  openSession: (sessionId: string) => void
  pickDirectory?: () => Promise<string | null>
  copyText?: (text: string) => Promise<void>
}

/** Full props of the Works overlay. */
export type WorksPanelProps = WorksPanelInjected & PropsLocale<typeof NS>

type Filter = 'all' | 'conversation'

const KIND_KEY = {
  video: 'card.video',
  speech: 'card.speech',
  composed: 'card.composed',
  import: 'card.import',
} as const

/**
 * Render the Works overlay when open.
 * @param props - remotes, session list, and locale.
 * @returns the overlay, or null while closed.
 */
export function WorksPanel({
  remotes, current, sessionsById, openSession, pickDirectory, copyText, t,
}: WorksPanelProps) {
  const [open, setOpen] = useState(worksOpen)
  const [filter, setFilter] = useState<Filter>('conversation')
  const [works, setWorks] = useState<readonly MediaWorkRow[]>([])
  const [runtime, setRuntime] = useState('')
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState<string | undefined>()

  useEffect(() => subscribeWorks(() => { setOpen(worksOpen()) }), [])

  useEffect(() => {
    if (!open) return
    const ac = new AbortController()
    void remotes.listMediaWorks({
      ...filter === 'conversation' && current !== undefined ? { sessionId: current.id } : {},
      ...filter === 'all' && current?.workspaceId !== undefined ? { workspaceId: current.workspaceId } : {},
    }, ac.signal).then((result) => {
      if (result.ok) setWorks(result.value)
    })
    void remotes.mediaRuntimeStatus(ac.signal).then((result) => {
      if (result.ok && !result.value.ready) setRuntime(result.value.guidance)
      if (result.ok && result.value.ready) setRuntime('')
    })
    return () => { ac.abort() }
  }, [open, filter, current, remotes])

  if (!open) return null

  const close = (): void => { setWorksOpen(false) }
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') close()
  }
  const onBackdrop = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) close()
  }

  return (
    <div className={css.overlay} onClick={onBackdrop} onKeyDown={onKey} role="presentation">
      <section className={css.panel} role="dialog" aria-label={t('works.title')} tabIndex={-1}>
        <header className={css.header}>
          <h2>{t('works.title')}</h2>
          <button type="button" className={css.icon} aria-label={t('works.close')} onClick={close}>
            <IconCloseOutlineRegular />
          </button>
        </header>
        <div className={css.filters}>
          <button type="button" data-active={filter === 'all' || undefined} onClick={() => { setFilter('all') }}>
            {t('works.filter.all')}
          </button>
          <button type="button" data-active={filter === 'conversation' || undefined} onClick={() => { setFilter('conversation') }}>
            {t('works.filter.conversation')}
          </button>
        </div>
        {runtime === '' ? null : <p className={css.banner}>{t('works.runtimeMissing')}</p>}
        {works.length === 0
          ? <p className={css.empty}>{t('works.empty')}</p>
          : (
            <ul className={css.list}>
              {works.map((work) => {
                const sourceGone = sessionsById[work.sessionId] === undefined
                return (
                  <li key={work.artifactId} className={css.row}>
                    <div className={css.meta}>
                      <span className={css.thumb} data-kind={work.kind} aria-hidden />
                      <strong>{work.name}</strong>
                      <span>{t(KIND_KEY[work.kind])}</span>
                      {work.durationSeconds === undefined ? null : <span>{work.durationSeconds}s</span>}
                      <time dateTime={work.createdAt}>{work.createdAt}</time>
                    </div>
                    <div className={css.actions}>
                      <button type="button" onClick={() => { void remotes.openMediaWork({ artifactId: work.artifactId }) }}>
                        <IconPlayOutlineRegular size={14} />
                        {t('works.open')}
                      </button>
                      <button type="button" onClick={() => { void remotes.revealMediaWork({ artifactId: work.artifactId }) }}>
                        <IconFolderOpenOutlineRegular size={14} />
                        {t('works.reveal')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void remotes.copyMediaWorkPath({ artifactId: work.artifactId }).then((result) => {
                            if (result.ok) void copyText?.(result.value.path)
                          })
                        }}
                      >
                        <IconCopyOutlineRegular size={14} />
                        {t('works.copyPath')}
                      </button>
                      {pickDirectory === undefined
                        ? null
                        : (
                          <button
                            type="button"
                            onClick={() => {
                              setSaving(work.artifactId)
                              setSaveName(work.name)
                            }}
                          >
                            <IconDownloadOutlineRegular size={14} />
                            {t('works.saveAs')}
                          </button>
                        )}
                      {sourceGone
                        ? <span>{t('works.sourceGone')}</span>
                        : (
                          <button type="button" onClick={() => { openSession(work.sessionId) }}>
                            {t('works.openSource')}
                          </button>
                        )}
                    </div>
                    {saving !== work.artifactId || pickDirectory === undefined
                      ? null
                      : (
                        <form
                          className={css.save}
                          onSubmit={(event) => {
                            event.preventDefault()
                            void pickDirectory().then((directory) => {
                              if (directory === null) {
                                setSaving(undefined)
                                return
                              }
                              void remotes.saveMediaWorkAs({
                                artifactId: work.artifactId,
                                directory,
                                filename: saveName,
                              }).then(() => { setSaving(undefined) })
                            })
                          }}
                        >
                          <input value={saveName} onChange={(event) => { setSaveName(event.target.value) }} />
                          <button type="submit">{t('works.saveAs')}</button>
                        </form>
                      )}
                  </li>
                )
              })}
            </ul>
          )}
      </section>
    </div>
  )
}

/**
 * Open a Session from a Works row.
 * @param sessionId - source conversation.
 * @param open - sessions.open.
 */
export function openListedSession(
  sessionId: string,
  open: (id: ReturnType<typeof SessionId>) => void,
): void {
  open(SessionId(sessionId))
}
