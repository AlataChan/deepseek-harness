/**
 * Hero row of the three institution-standing squads.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {
  EnsureInstitutionSquadRequest,
  EnsureInstitutionSquadResult,
  InstitutionSquadId,
  InstitutionSquadView,
  UpdateInstitutionSeatRequest,
} from '@deepseek-ai/dsh-experimental-agent-team/client'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS, type TeamKey } from './locales.ts'
import css from './InstitutionSquads.module.css'

/** Generated Remote result consumed by the squad row. */
export type InstitutionRemoteResult<T> = RemoteResult<T>

/** Business actions injected by the browser plugin. */
export interface InstitutionSquadsInjected {
  list: () => Promise<InstitutionRemoteResult<InstitutionSquadView[]>>
  updateSeat: (request: UpdateInstitutionSeatRequest) => Promise<InstitutionRemoteResult<InstitutionSquadView[]>>
  models: () => Promise<InstitutionRemoteResult<ModelCatalog>>
  createSession: (workspaceId: WorkspaceId) => Promise<SessionId>
  renameSession: (sessionId: SessionId, title: string) => Promise<InstitutionRemoteResult<{ title: string }>>
  ensure: (
    sessionId: SessionId,
    request: EnsureInstitutionSquadRequest,
  ) => Promise<InstitutionRemoteResult<EnsureInstitutionSquadResult>>
  openSession: (sessionId: SessionId) => void
}

/** Full props of the Hero institution-squad row. */
export type InstitutionSquadsProps =
  PropsRuntime<'conversation.hero.agentTeam'>
  & InstitutionSquadsInjected
  & PropsLocale<typeof NS>

const HUE = [css.hue0, css.hue1, css.hue2] as const

/**
 * First grapheme of a squad name for the letter avatar.
 * @param displayName - localized squad title.
 * @returns one grapheme, or `?` when the name is empty.
 */
export function squadInitial(displayName: string): string {
  const trimmed = displayName.trim()
  if (trimmed === '') return '?'
  /* v8 ignore start -- Node 22 and jsdom ship Intl.Segmenter */
  if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) {
    return trimmed.charAt(0)
  }
  /* v8 ignore stop */
  const first = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)][0]
  /* v8 ignore next -- Segmenter yields a grapheme for every non-empty string */
  return first?.segment ?? '?'
}

function squadTitleKey(id: InstitutionSquadId): TeamKey {
  switch (id) {
    case 'document': return 'squad.document'
    case 'case': return 'squad.case'
    case 'comms': return 'squad.comms'
  }
}

function seatTitleKey(name: string): TeamKey {
  return `seat.${name}` as TeamKey
}

function routeValue(provider: string | undefined, model: string | undefined): string {
  if (provider === undefined || model === undefined) return ''
  return `${provider}:${model}`
}

/**
 * Parse a seat `<select>` value into an optional provider/model route.
 * @param value - `provider:model`, a bare model id, or empty to follow the Lead.
 * @returns fields to send on `updateInstitutionSeat`.
 */
export function parseRoute(value: string): { provider?: string; model?: string } {
  if (value === '') return {}
  const cut = value.indexOf(':')
  if (cut <= 0) return { model: value }
  return { provider: value.slice(0, cut), model: value.slice(cut + 1) }
}

function failureText(error: { readonly message: string; readonly code: string }): string {
  return `${error.message} (${error.code})`
}

/**
 * Render the three standing squads on the blank-session Hero.
 * @param props - locale, remotes, and the Hero workspace id.
 * @returns the squad row.
 */
export function InstitutionSquads({
  t, workspaceId, list, updateSeat, models, createSession, renameSession, ensure, openSession,
}: InstitutionSquadsProps) {
  const [rows, setRows] = useState<InstitutionSquadView[]>([])
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<InstitutionSquadId | null>(null)
  const [openSeats, setOpenSeats] = useState<InstitutionSquadId | null>(null)
  const busyRef = useRef(false)

  const reload = useCallback(async () => {
    const [listed, modelResult] = await Promise.all([list(), models()])
    if (!listed.ok) {
      setError(failureText(listed.error))
      return
    }
    setRows(listed.value)
    setError(null)
    if (modelResult.ok) setCatalog(modelResult.value)
  }, [list, models])

  useEffect(() => {
    void reload()
  }, [reload])

  const dispatch = async (row: InstitutionSquadView): Promise<void> => {
    /* v8 ignore next -- identity and dispatch stay disabled without a workspace */
    if (workspaceId === undefined) return
    if (busyRef.current) return
    busyRef.current = true
    setBusy(row.id)
    setError(null)
    try {
      let sessionId = row.leadSessionId
      if (sessionId === undefined) {
        sessionId = await createSession(workspaceId)
        const renamed = await renameSession(sessionId, t(squadTitleKey(row.id)))
        if (!renamed.ok) {
          setError(failureText(renamed.error))
          return
        }
      }
      const ensured = await ensure(sessionId, { squadId: row.id })
      if (!ensured.ok) {
        setError(failureText(ensured.error))
        return
      }
      openSession(ensured.value.sessionId)
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      busyRef.current = false
      setBusy(null)
      void reload()
    }
  }

  const changeSeat = async (
    squadId: InstitutionSquadId,
    name: string,
    value: string,
  ): Promise<void> => {
    const route = parseRoute(value)
    const result = await updateSeat({
      squadId,
      name,
      ...route.provider === undefined ? {} : { provider: route.provider },
      ...route.model === undefined ? {} : { model: route.model },
    })
    if (!result.ok) {
      setError(failureText(result.error))
      return
    }
    setRows(result.value)
  }

  return (
    <section className={css.row} aria-label={t('squadsTitle')}>
      <div className={css.heading}>
        <h2 className={css.title}>{t('squadsTitle')}</h2>
        <p className={css.hint}>{t('squadsHint')}</p>
      </div>
      {workspaceId === undefined && <p className={css.needWorkspace}>{t('squadsNeedWorkspace')}</p>}
      {error !== null && <p className={css.error} role="alert">{error}</p>}
      <div className={css.cards}>
        {rows.map((row, index) => {
          const title = t(squadTitleKey(row.id))
          const hue = HUE[index % HUE.length]
          const expanded = openSeats === row.id
          const dispatching = busy === row.id
          return (
            <article key={row.id} className={css.card}>
              <button
                type="button"
                className={css.identity}
                aria-label={title}
                disabled={workspaceId === undefined}
                onClick={() => { void dispatch(row) }}
              >
                <span className={`${css.avatar} ${hue}`} aria-hidden>{squadInitial(title)}</span>
                <span className={css.identityText}>
                  <span className={css.name}>{title}</span>
                  <span className={css.meta}>
                    <span className={css.badge}>{row.established ? t('squadEstablished') : t('squadReady')}</span>
                    <span>{t('squadSeatCount').replace('{count}', String(row.seats.length))}</span>
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={css.toggle}
                aria-expanded={expanded}
                onClick={() => {
                  setOpenSeats(current => current === row.id ? null : row.id)
                }}
              >
                {t('squadSeats')}
              </button>
              {expanded && (
                <ul className={css.seats}>
                  {row.seats.map(seat => (
                    <li key={seat.name} className={css.seat}>
                      <span className={css.seatName}>
                        <code>{seat.name}</code>
                        <span>{t(seatTitleKey(seat.name))}</span>
                      </span>
                      <label className={css.seatModel}>
                        {t('model')}
                        <select
                          value={routeValue(seat.provider, seat.model)}
                          onChange={(event) => { void changeSeat(row.id, seat.name, event.target.value) }}
                        >
                          <option value="">{t('squadFollowLead')}</option>
                          {(catalog?.groups ?? []).flatMap(group => group.models.map(model => (
                            <option key={`${group.id}:${model.id}`} value={`${group.id}:${model.id}`}>
                              {group.name} / {model.name}
                            </option>
                          )))}
                        </select>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                className={css.dispatch}
                disabled={workspaceId === undefined}
                onClick={() => { void dispatch(row) }}
              >
                {dispatching ? t('squadDispatching') : t('squadDispatch')}
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}
