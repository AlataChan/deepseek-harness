import { AvatarPicker, DEFAULT_AVATAR } from './EntityAvatar.tsx'
import { useEffect, useRef, useState } from 'react'
import type {
  AssistantProfile,
  AssistantProfileId,
  TeamTemplateOrigin,
} from '@deepseek-ai/dsh-experimental-assistant-registry'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './TeamView.module.css'

export interface CreateTeamPayload {
  name: string
  templateOrigin: TeamTemplateOrigin
  coordinatorProfileId: AssistantProfileId
  avatar?: string | undefined
  description?: string | undefined
  sharedWorkspaceId?: string | undefined
}

export interface TeamCreationModalProps extends PropsLocale<typeof NS> {
  isOpen: boolean
  profiles: readonly AssistantProfile[]
  onClose: () => void
  onCreateTeam: (payload: CreateTeamPayload) => Promise<void> | void
}

export function TeamCreationModal(props: TeamCreationModalProps) {
  if (!props.isOpen) return null
  return <TeamCreationModalContent {...props} />
}

function TeamCreationModalContent({
  t,
  isOpen,
  profiles,
  onClose,
  onCreateTeam,
}: TeamCreationModalProps) {
  const [template, setTemplate] = useState<TeamTemplateOrigin>('blank')
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(DEFAULT_AVATAR)
  const [coordinatorId, setCoordinatorId] = useState<AssistantProfileId | ''>(
    profiles[0]?.id ?? '',
  )
  const [description, setDescription] = useState('')
  const [sharedWorkspace, setSharedWorkspace] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const effectiveCoordinatorId = profiles.some(profile => profile.id === coordinatorId)
    ? coordinatorId : (profiles[0]?.id ?? '')

  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  if (!isOpen) return null

  const handleTemplateSelect = (tmpl: TeamTemplateOrigin) => {
    setTemplate(tmpl)
    if (!name || name === t('templateBlank') || name === t('templateDocument') || name === t('templateCase') || name === t('templateComms')) {
      if (tmpl === 'blank') setName(t('templateBlank'))
      else if (tmpl === 'document') setName(t('templateDocument'))
      else if (tmpl === 'case') setName(t('templateCase'))
      else if (tmpl === 'comms') setName(t('templateComms'))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !effectiveCoordinatorId || submitting) return
    setSubmitting(true)
    setFailed(false)
    try {
      await onCreateTeam({
        name: name.trim(),
        ...avatar !== DEFAULT_AVATAR ? { avatar } : {},
        templateOrigin: template,
        coordinatorProfileId: effectiveCoordinatorId,
        ...description.trim() ? { description: description.trim() } : {},
        ...sharedWorkspace.trim() ? { sharedWorkspaceId: sharedWorkspace.trim() } : {},
      })
      if (mounted.current) onClose()
    } catch {
      if (mounted.current) setFailed(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={css.modalOverlay} role="dialog" aria-modal="true">
      <div className={css.modalContent}>
        <h3 className={css.modalTitle}>{t('newTeam')}</h3>
        {failed && <div role="alert">{t('operationFailed')}</div>}
        <form onSubmit={(event) => { void handleSubmit(event) }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <fieldset disabled={submitting} style={{ display: 'contents' }}>
            <div className={css.formField}>
              <label className={css.fieldLabel}>{t('teamTemplates')}</label>
              <div className={css.templateGroup}>
                <button
                  type="button"
                  data-testid="template-blank"
                  className={`${css.templateChip} ${template === 'blank' ? css.templateChipActive : ''}`}
                  onClick={() =>{  handleTemplateSelect('blank') }}
                >
                  {t('templateBlank')}
                </button>
                <button
                  type="button"
                  data-testid="template-document"
                  className={`${css.templateChip} ${template === 'document' ? css.templateChipActive : ''}`}
                  onClick={() =>{  handleTemplateSelect('document') }}
                >
                  {t('templateDocument')}
                </button>
                <button
                  type="button"
                  data-testid="template-case"
                  className={`${css.templateChip} ${template === 'case' ? css.templateChipActive : ''}`}
                  onClick={() =>{  handleTemplateSelect('case') }}
                >
                  {t('templateCase')}
                </button>
                <button
                  type="button"
                  data-testid="template-comms"
                  className={`${css.templateChip} ${template === 'comms' ? css.templateChipActive : ''}`}
                  onClick={() =>{  handleTemplateSelect('comms') }}
                >
                  {t('templateComms')}
                </button>
              </div>
            </div>

            <div className={css.formField}>
              <label className={css.fieldLabel}>{t('teamName')}</label>
              <input
                type="text"
                data-testid="team-name-input"
                className={css.input}
                value={name}
                onChange={(e) =>{  setName(e.target.value) }}
                placeholder={t('teamName')}
                required
              />
            </div>

            <AvatarPicker name={name} value={avatar} onChange={setAvatar} t={t} />
            <div className={css.formField}>
              <label className={css.fieldLabel}>{t('coordinator')}</label>
              <select
                data-testid="coordinator-select"
                className={css.input}
                value={effectiveCoordinatorId}
                onChange={(e) =>{  setCoordinatorId(e.target.value as AssistantProfileId) }}
                required
              >
                <option value="" disabled>{t('selectCoordinator')}</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={css.formField}>
              <label className={css.fieldLabel}>{t('description')}</label>
              <input
                type="text"
                data-testid="team-desc-input"
                className={css.input}
                value={description}
                onChange={(e) =>{  setDescription(e.target.value) }}
                placeholder={t('description')}
              />
            </div>

            <div className={css.formField}>
              <label className={css.fieldLabel}>{t('sharedWorkspace')}</label>
              <input
                type="text"
                data-testid="team-workspace-input"
                className={css.input}
                value={sharedWorkspace}
                onChange={(e) =>{  setSharedWorkspace(e.target.value) }}
                placeholder={t('sharedWorkspace')}
              />
            </div>

            <div className={css.modalActions}>
              <button
                type="button"
                data-testid="create-team-cancel"
                className={css.actionButton}
                onClick={onClose}
                disabled={submitting}
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                data-testid="create-team-submit"
                className={`${css.actionButton} ${css.primaryButton}`}
                disabled={submitting || !name.trim() || !effectiveCoordinatorId}
              >
                {t('create')}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  )
}
