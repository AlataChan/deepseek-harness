import { EntityAvatar } from './EntityAvatar.tsx'
import { useEffect, useState } from 'react'
import type { AssistantProfile, AssistantProfileId } from '@deepseek-ai/dsh-experimental-assistant-registry'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-agent-team/client'
import { NS } from './locales.ts'
import css from './AssistantHeroCard.module.css'

/** Injected operations for Hero assistant cards. */
export interface AssistantHeroCardInjected {
  loadProfiles: () => Promise<readonly AssistantProfile[]>
  onStartChat: (profileId: AssistantProfileId) => void | Promise<void>
}

/** Component props for AssistantHeroCard. */
export type AssistantHeroCardProps =
  PropsRuntime<'conversation.hero.agentTeam.card'>
  & AssistantHeroCardInjected
  & PropsLocale<typeof NS>

/**
 * Hero card section for featured persistent assistants. The card owns its
 * fetched profiles, so a cold-mounted Hero fills in when the loader resolves.
 * @param props - profile loader and chat opener.
 * @returns rendered assistant cards on Hero, or null while none exist.
 */
export function AssistantHeroCard({
  t,
  loadProfiles,
  onStartChat,
}: AssistantHeroCardProps) {
  const [failed, setFailed] = useState(false)
  const [profiles, setProfiles] = useState<readonly AssistantProfile[]>([])

  useEffect(() => {
    let alive = true
    void loadProfiles()
      .then((next) => { if (alive) setProfiles(next) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [loadProfiles])

  const activeProfiles = profiles.filter(p => !p.archivedAt)
  if (activeProfiles.length === 0) return failed ? <p role="alert">{t('profilesLoadFailed')}</p> : null

  return (
    <div className={css.section}>
      {failed && <p role="alert">{t('operationFailed')}</p>}
      <div className={css.sectionHeader}>
        <h3 className={css.title}>{t('heroTitle')}</h3>
        <p className={css.desc}>{t('heroDesc')}</p>
      </div>
      <div className={css.cardsRow}>
        {activeProfiles.map(profile => (
          <button
            key={profile.id}
            type="button"
            className={css.heroCard}
            onClick={() => { void (async () => { try { await onStartChat(profile.id) } catch { setFailed(true) } })() }}
          >
            <div className={css.cardTop}>
              <EntityAvatar name={profile.name} avatar={profile.avatar} />
              <span className={css.name}>{profile.name}</span>
            </div>
            {profile.responsibility && (
              <span className={css.resp}>{profile.responsibility}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
