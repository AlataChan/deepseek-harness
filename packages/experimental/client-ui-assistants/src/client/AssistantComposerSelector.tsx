/** Compact identity selection with an optional grouped avatar shelf. */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { IconLoadingOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AssistantProfile, AssistantProfileId, TeamDefinition, TeamDefinitionId } from '@deepseek-ai/dsh-experimental-assistant-registry/types'
import { EntityAvatar } from './EntityAvatar.tsx'
import type { SelectorPreference } from './selector-preference.ts'
import { NS } from './locales.ts'
import css from './AssistantComposerSelector.module.css'

/** Identity loaded from the current Host Session, independently of the open selection menu. */
export interface ComposerIdentity {
  readonly profile?: AssistantProfile | undefined
  readonly team?: TeamDefinition | undefined
}

/** Operations shared by the no-Session Hero and the Session composer. */
export interface AssistantComposerSelectorInjected {
  readonly sessionId?: SessionId | undefined
  readonly sessionState: {
    subscribe: (listener: () => void) => () => void
    getSnapshot: () => { blank: boolean; running: boolean } | undefined
  }
  readonly changes: { subscribe: (listener: () => void) => () => void; getSnapshot: () => number }
  readonly preference: SelectorPreference
  readonly loadProfiles: () => Promise<readonly AssistantProfile[]>
  readonly loadTeams: () => Promise<readonly TeamDefinition[]>
  readonly loadIdentity: (sessionId: SessionId) => Promise<ComposerIdentity>
  readonly onStartChat: (profileId: AssistantProfileId) => Promise<void>
  readonly onOpenTeam: (teamId: TeamDefinitionId) => void
  readonly onUseOrdinary: (sessionId: SessionId) => Promise<void>
  readonly onManage: () => void
}

/**
 * Show actual conversation identity and select assistants through the existing workspace launcher.
 * Team choices open their saved collaboration view; expanding avatars changes presentation only.
 * @param props - Host readers, selection operations, preference, Session state and localized copy.
 * @returns the compact selector and, when enabled, its grouped avatar shelf.
 */
export function AssistantComposerSelector({ sessionId, sessionState, changes, preference, loadProfiles, loadTeams,
  loadIdentity, onStartChat, onOpenTeam, onUseOrdinary, onManage, t }:
  AssistantComposerSelectorInjected & PropsLocale<typeof NS>) {
  const state = useSyncExternalStore(sessionState.subscribe, sessionState.getSnapshot)
  const revision = useSyncExternalStore(changes.subscribe, changes.getSnapshot)
  const expanded = useSyncExternalStore(preference.subscribe, preference.getSnapshot)
  const shelfId = useId()
  const pending = useRef(false)
  const [loaded, setLoaded] = useState({ assistant: false, team: false })
  const [profiles, setProfiles] = useState<readonly AssistantProfile[]>([])
  const [teams, setTeams] = useState<readonly TeamDefinition[]>([])
  const [identity, setIdentity] = useState<{ sessionId: SessionId; value: ComposerIdentity }>()
  const [menu, setMenu] = useState<'assistant' | 'team'>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [readFailed, setReadFailed] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const lifetime = new AbortController()
    setReadFailed(false)
    setLoaded({ assistant: false, team: false })
    setIdentity(undefined)
    setMenu(undefined)
    const fail = () => { if (!lifetime.signal.aborted) setReadFailed(true) }
    void loadProfiles().then((items) => {
      if (!lifetime.signal.aborted) setProfiles(items.filter(item => item.archivedAt === undefined && item.deletedAt === undefined))
    }).catch(fail).finally(() => { if (!lifetime.signal.aborted) setLoaded(value => ({ ...value, assistant: true })) })
    void loadTeams().then((items) => {
      if (!lifetime.signal.aborted) setTeams(items.filter(item => item.archivedAt === undefined && item.deletedAt === undefined))
    }).catch(fail).finally(() => { if (!lifetime.signal.aborted) setLoaded(value => ({ ...value, team: true })) })
    if (sessionId) void loadIdentity(sessionId).then((value) => {
      if (!lifetime.signal.aborted) setIdentity({ sessionId, value })
    }).catch(fail)
    return () => { lifetime.abort() }
  }, [loadProfiles, loadTeams, loadIdentity, sessionId, revision, reload])
  const current = identity?.sessionId === sessionId ? identity?.value : undefined
  const entity = current?.team ?? current?.profile
  const kind = current?.team ? 'team' : current?.profile ? 'assistant' : 'ordinary'
  const identityReady = !sessionId || identity?.sessionId === sessionId
  const locked = busy || state?.running === true || !identityReady
  const run = (action: () => Promise<void> | void) => {
    if (locked || pending.current) return
    pending.current = true
    setBusy(true)
    setFailed(false)
    setMenu(undefined)
    void Promise.resolve().then(action).catch(() => { setFailed(true) }).finally(() => { pending.current = false; setBusy(false) })
  }
  const choose = (category: 'assistant' | 'team', id: string) => {
    if (id === 'manage') { setMenu(undefined); onManage(); return }
    if (category === 'assistant') {
      const profile = profiles.find(item => item.id === id)
      if (profile) run(() => onStartChat(profile.id))
    } else {
      const team = teams.find(item => item.id === id)
      if (team) run(() => { onOpenTeam(team.id) })
    }
  }
  return <section className={css.selector} data-assistant-selector="" aria-label={t('selectorLabel')}>
    <div className={css.displayControls}>
      <button type="button" className={css.textButton} aria-expanded={expanded} aria-controls={shelfId}
        onClick={() => { preference.setExpanded(!expanded) }}>{t(expanded ? 'collapseSelectorAvatars' : 'expandSelectorAvatars')}</button>
    </div>
    {expanded && <div className={css.shelf} id={shelfId} data-testid="selector-avatar-shelf">
      {(['assistant', 'team'] as const).map(category => <div className={css.group} key={category}>
        <div className={css.groupHeader}><span>{t(category === 'assistant' ? 'selectorAssistants' : 'selectorTeams')}</span>
          <button type="button" className={css.textButton} onClick={onManage}>{t('selectorViewAll')}</button></div>
        <div className={css.avatars}>
          {(category === 'assistant' ? profiles : teams).map(item => <button type="button" key={item.id}
            className={css.avatarChoice} aria-label={item.name} aria-pressed={kind === category && entity?.id === item.id} disabled={locked}
            onClick={() => { choose(category, item.id) }}>
            <EntityAvatar name={item.name} avatar={item.avatar} /><span>{item.name}</span>
          </button>)}
          {!loaded[category] && <span role="status" aria-label={t('selectorLoading')}><IconLoadingOutlineRegular className={css.loading} /></span>}
          {loaded[category] && !readFailed && (category === 'assistant' ? profiles : teams).length === 0 && <span className={css.secondary}>
            {t(category === 'assistant' ? 'empty' : 'selectorNoTeams')}</span>}
        </div>
      </div>)}
    </div>}
    <div className={css.bar}>
      <div className={css.modes} role="group" aria-label={t('selectorLabel')}>
        <button type="button" className={css.mode} aria-pressed={identityReady && kind === 'ordinary'} disabled={locked}
          onClick={() => { if (sessionId && entity) run(() => onUseOrdinary(sessionId)); else setMenu(undefined) }}>
          {t('selectorOrdinary')}
        </button>
        {(['assistant', 'team'] as const).map(category => <Menu key={category} open={menu === category} portal side="top"
          autoFocus dense selectedId={kind === category ? entity?.id : undefined}
          onClose={() => { setMenu(undefined) }} onSelect={(id) => { choose(category, id) }}
          items={(category === 'assistant' ? profiles : teams).map(item => ({ id: item.id, label: item.name,
            disabled: locked, icon: <EntityAvatar name={item.name} avatar={item.avatar} small /> }))}
          footer={[{ id: 'manage', label: t('selectorManage') }]}
          anchor={<button type="button" className={css.mode} aria-pressed={kind === category} disabled={locked}
            aria-haspopup="menu" aria-expanded={menu === category}
            onClick={() => { setMenu(menu === category ? undefined : category) }}>
            {t(category === 'assistant' ? 'selectorAssistants' : 'selectorTeams')}
          </button>} />)}
      </div>
      <div className={css.identity}>
        {entity && <EntityAvatar name={entity.name} avatar={entity.avatar} />}
        <span className={css.identityText}><span className={css.name} data-testid="selector-current-name">
          {entity?.name ?? t(identityReady ? 'selectorOrdinary' : 'selectorCheckingIdentity')}
        </span><span className={css.secondary}>
          {entity?.deletedAt !== undefined ? t('entityDeleted') : entity ? t('selectorCurrentResponder') : t('selectorChooseHint')}
        </span></span>
        {entity && sessionId && <button type="button" className={css.textButton} disabled={locked}
          onClick={() => { run(() => onUseOrdinary(sessionId)) }}>
          {t(state?.blank && !current?.team ? 'clearAssistantSelection' : 'startOrdinaryConversation')}
        </button>}
      </div>
    </div>
    {(failed || readFailed) && <div className={css.error} role="alert">{t('operationFailed')}
      {readFailed && <button type="button" className={css.textButton} onClick={() => { setReload(value => value + 1) }}>
        {t('selectorRetry')}
      </button>}
    </div>}
  </section>
}


/** Hero inputs plus the currently retained main Session identity. */
export interface AssistantHeroSelectorProps extends AssistantComposerSelectorInjected, PropsLocale<typeof NS> {
  readonly activeSession: {
    subscribe: (listener: () => void) => () => void
    getSnapshot: () => SessionId | undefined
  }
}

/**
 * Offer the selector before any Session exists; Session composers own it after workspace selection.
 * @param props - shared selector operations and the active main Session source.
 * @returns one selector on the no-Session Hero, otherwise no duplicate.
 */
export function AssistantHeroSelector({ activeSession, ...props }: AssistantHeroSelectorProps) {
  const sessionId = useSyncExternalStore(activeSession.subscribe, activeSession.getSnapshot)
  return sessionId ? null : <AssistantComposerSelector {...props} />
}
