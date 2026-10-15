/** Workspace confirmation for an assistant selected before a workspace. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { AssistantProfile, AssistantProfileId } from '@deepseek-ai/dsh-experimental-assistant-registry/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssistantConversationLauncher } from './conversation-launch.ts'
import { EntityAvatar } from './EntityAvatar.tsx'
import { NS } from './locales.ts'
import css from './AssistantWorkspaceDialog.module.css'

/** Dependencies of the workspace dialog mounted above directory navigation. */
export interface AssistantWorkspaceDialogInjected {
  launcher: AssistantConversationLauncher
  workspaces: IWorkspaces
  loadProfile: (id: AssistantProfileId) => Promise<AssistantProfile | undefined>
  pickDirectory: () => Promise<string | null>
}

/**
 * Keep the selected assistant visible until a workspace is chosen or cancelled.
 * @param props - workspace registry, profile loader, launcher, and localized copy.
 * @returns the pending workspace dialog.
 */
export function AssistantWorkspaceDialog({ launcher, workspaces, loadProfile, pickDirectory, t }:
  AssistantWorkspaceDialogInjected & PropsLocale<typeof NS>) {
  const request = useSyncExternalStore(launcher.subscribe, launcher.getSnapshot)
  const snapshot = useSyncExternalStore(listener => workspaces.list.subscribe(listener), () => workspaces.list.getSnapshot())
  const [profile, setProfile] = useState<AssistantProfile>()
  const [picking, setPicking] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const lifetime = new AbortController()
    setProfile(undefined)
    setFailed(false)
    if (request) void loadProfile(request.profileId).then((value) => {
      if (!lifetime.signal.aborted) setProfile(value)
    }).catch(() => { if (!lifetime.signal.aborted) setFailed(true) })
    return () => { lifetime.abort() }
  }, [loadProfile, request?.profileId])
  const busy = picking || request?.busy === true
  return (
    <Modal open={request !== null} title={t('chooseAssistantWorkspace')} closeLabel={t('cancel')}
      {...(css.dialog ? { className: css.dialog } : {})}
      {...(css.scrollContent ? { contentClassName: css.scrollContent } : {})}
      onClose={() => { if (!busy) launcher.choose() }}>
      <div className={css.content}>
        {profile && <div className={css.identity}><EntityAvatar name={profile.name} avatar={profile.avatar} small />
          <span>{t('currentAssistant')}: {profile.name}</span></div>}
        <p className={css.hint}>{t('assistantWorkspaceHint')}</p>
        {failed && <p role="alert">{t('operationFailed')}</p>}
        <div className={css.workspaces}>
          {snapshot.items.map(workspace => <button type="button" key={workspace.workspaceId} disabled={busy}
            className={css.workspace} onClick={() => { launcher.choose(workspace) }}>
            <span>{workspace.title}</span><span className={css.path}>{workspace.path}</span>
          </button>)}
        </div>
        <button type="button" disabled={busy} className={css.workspace} onClick={() => {
          setPicking(true)
          setFailed(false)
          void (async () => {
            try {
              const path = await pickDirectory()
              if (path && launcher.getSnapshot() === request) {
                const workspace = await workspaces.create({ path })
                if (launcher.getSnapshot() === request) launcher.choose(workspace)
              }
            } catch { setFailed(true) }
            finally { setPicking(false) }
          })()
        }}>{t('chooseAssistantDirectory')}</button>
      </div>
    </Modal>
  )
}
