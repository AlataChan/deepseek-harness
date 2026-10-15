import { AvatarPicker, DEFAULT_AVATAR } from './EntityAvatar.tsx'
import { useEffect, useRef, useState } from 'react'
import type {
  AssistantModelSelection,
  AssistantProfile,
  AssistantProfileId,
  TeamDefinition,
  TeamSeat,
  TeamSeatId,
} from '@deepseek-ai/dsh-experimental-assistant-registry'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AssistantModelOption } from './models.ts'
import { modelRouteValue, parseModelRoute } from './models.ts'
import { ModelSelect } from './ModelSelect.tsx'
import { NS } from './locales.ts'
import css from './TeamView.module.css'

/** One changed-seat patch; `modelOverride: null` clears the override so the seat inherits. */
export interface TeamSeatUpdatePatch {
  readonly duty?: string | undefined
  readonly modelOverride?: AssistantModelSelection | null | undefined
}

/** One changed seat, dispatched as its own seat update. */
export interface SeatUpdateItem extends TeamSeatUpdatePatch {
  readonly seatId: TeamSeatId
}

/** Team-record payload saved after the editor applied its own seat updates. */
export interface SaveTeamUpdatesPayload {
  name?: string | undefined
  avatar?: string | undefined
  description?: string | undefined
  coordinatorProfileId?: AssistantProfileId | undefined
  sharedWorkspaceId?: string | undefined
}

export interface TeamEditorModalProps extends PropsLocale<typeof NS> {
  isOpen: boolean
  team: TeamDefinition
  seats: readonly TeamSeat[]
  profiles: readonly AssistantProfile[]
  models: readonly AssistantModelOption[]
  onClose: () => void
  onSave: (payload: SaveTeamUpdatesPayload) => Promise<void> | void
  onUpdateSeat?: ((seatId: TeamSeatId, patch: TeamSeatUpdatePatch) => Promise<void> | void) | undefined
}

export function TeamEditorModal(props: TeamEditorModalProps) {
  if (!props.isOpen) return null
  return <TeamEditorModalContent key={props.team.id} {...props} />
}

function TeamEditorModalContent({
  t,
  isOpen,
  team,
  seats,
  profiles,
  models,
  onClose,
  onSave,
  onUpdateSeat,
}: TeamEditorModalProps) {
  const [name, setName] = useState(team.name)
  const [avatar, setAvatar] = useState(team.avatar ?? DEFAULT_AVATAR)
  const [description, setDescription] = useState(team.description ?? '')
  const [coordinatorId, setCoordinatorId] = useState<AssistantProfileId>(
    team.coordinatorProfileId,
  )
  const [workspace, setWorkspace] = useState(team.sharedWorkspaceId ?? '')
  const [seatDuties, setSeatDuties] = useState<Record<string, string>>({})
  const [seatModels, setSeatModels] = useState<Record<string, string>>({})
  const coordinatorLocked = team.leadSessionId !== undefined || seats.some(seat => seat.role === 'coordinator')
  const coordinatorValid = coordinatorId === team.coordinatorProfileId
    || profiles.some(profile => profile.id === coordinatorId)
  const [saving, setSaving] = useState(false)

  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || saving) return
    if (!coordinatorValid) { setFailed(true); return }
    setSaving(true)
    setFailed(false)
    try {
      const seatUpdates: SeatUpdateItem[] = []
      for (const seat of seats) {
        const duty = seatDuties[seat.id]
        const dutyChanged = duty !== undefined && duty !== seat.duty
        const modelKey = seatModels[seat.id] ?? modelRouteValue(seat.modelOverride)
        const modelChanged = modelKey !== modelRouteValue(seat.modelOverride)
        if (!dutyChanged && !modelChanged) continue
        if (!onUpdateSeat || (modelChanged && modelKey !== ''
          && (!parseModelRoute(modelKey) || !models.some(model => `${model.provider}:${model.id}` === modelKey)))) {
          throw new Error('Invalid seat update')
        }
        seatUpdates.push({
          seatId: seat.id,
          ...dutyChanged ? { duty } : {},
          ...modelChanged ? { modelOverride: modelKey === '' ? null : parseModelRoute(modelKey) } : {},
        })
      }
      for (const seatUpdate of seatUpdates) {
        await onUpdateSeat?.(seatUpdate.seatId, {
          ...seatUpdate.duty === undefined ? {} : { duty: seatUpdate.duty },
          ...seatUpdate.modelOverride === undefined ? {} : { modelOverride: seatUpdate.modelOverride },
        })
      }

      await onSave({
        name: name.trim() !== team.name ? name.trim() : undefined,
        ...avatar !== (team.avatar ?? DEFAULT_AVATAR) ? { avatar } : {},
        description: description.trim() !== (team.description ?? '') ? description.trim() : undefined,
        coordinatorProfileId: coordinatorId !== team.coordinatorProfileId ? coordinatorId : undefined,
        sharedWorkspaceId: workspace.trim() !== (team.sharedWorkspaceId ?? '') ? workspace.trim() : undefined,
      })
      if (mounted.current) onClose()
    } catch {
      if (mounted.current) setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={css.modalOverlay} role="dialog" aria-modal="true">
      <div className={css.modalContent} style={{ maxHeight: '85vh', overflowY: 'auto' }}>
        <h3 className={css.modalTitle}>{t('editTeam')}</h3>
        {failed && <div role="alert">{t('operationFailed')}</div>}
        <form onSubmit={(event) => { void handleSubmit(event) }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <fieldset disabled={saving} style={{ display: 'contents' }}>
            <div className={css.formField}>
              <label className={css.fieldLabel}>{t('teamName')}</label>
              <input
                type="text"
                data-testid="edit-team-name-input"
                className={css.input}
                value={name}
                onChange={(e) =>{  setName(e.target.value) }}
                required
              />
            </div>

            <AvatarPicker name={name} value={avatar} onChange={setAvatar} t={t} />
            <div className={css.formField}>
              <label className={css.fieldLabel}>{t('coordinator')}</label>
              <select
                data-testid="edit-coordinator-select"
                disabled={coordinatorLocked}
                className={css.input}
                value={coordinatorId}
                onChange={(e) =>{  setCoordinatorId(e.target.value as AssistantProfileId) }}
                required
              >
                {!profiles.some(profile => profile.id === coordinatorId) && (
                  <option value={coordinatorId} disabled>{t('selectCoordinator')}</option>
                )}
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {coordinatorLocked && <p>{t('coordinatorLocked')}</p>}
            </div>

            <div className={css.formField}>
              <label className={css.fieldLabel}>{t('description')}</label>
              <input
                type="text"
                data-testid="edit-desc-input"
                className={css.input}
                value={description}
                onChange={(e) =>{  setDescription(e.target.value) }}
              />
            </div>

            <div className={css.formField}>
              <label className={css.fieldLabel}>{t('sharedWorkspace')}</label>
              <input
                type="text"
                data-testid="edit-workspace-input"
                className={css.input}
                value={workspace}
                onChange={(e) =>{  setWorkspace(e.target.value) }}
              />
            </div>

            <div className={css.formField}>
              <label className={css.fieldLabel}>{t('seats')}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {seats.map(s => (
                  <div
                    key={s.id}
                    style={{
                      padding: 8,
                      background: 'var(--dsw-alias-bg-base)',
                      borderRadius: 6,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 500 }}>
                      {s.title ?? s.name} ({s.name})
                    </div>
                    <input
                      type="text"
                      data-testid={`seat-duty-input-${s.name}`}
                      className={css.input}
                      value={seatDuties[s.id] ?? s.duty}
                      onChange={(e) =>{  setSeatDuties({ ...seatDuties, [s.id]: e.target.value }) }}
                      placeholder={t('duty')}
                    />
                    <ModelSelect
                      className={css.input}
                      testId={`seat-model-select-${s.name}`}
                      options={models}
                      value={seatModels[s.id] ?? modelRouteValue(s.modelOverride)}
                      onChange={(value) => { setSeatModels({ ...seatModels, [s.id]: value }) }}
                      t={t}
                      unsetLabel={t('inheritProfileModel')}
                      keepUnset
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className={css.modalActions}>
              <button
                type="button"
                data-testid="edit-team-cancel"
                className={css.actionButton}
                onClick={onClose}
                disabled={saving}
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                data-testid="edit-team-save"
                className={`${css.actionButton} ${css.primaryButton}`}
                disabled={saving || !name.trim() || !coordinatorValid}
              >
                {t('save')}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  )
}
