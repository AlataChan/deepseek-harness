// @vitest-environment jsdom
/** Failed and stale form requests retain the user's input and selected scope. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { AssistantProfileId, MemoryEntryId, TeamDefinitionId, TeamSeatId, type AssistantProfile, type TeamDefinition, type TeamSeat, type MemoryEntry } from '@deepseek-ai/dsh-experimental-assistant-registry'
import { AssistantDetailDrawer } from '../src/client/AssistantDetailDrawer.tsx'
import { TeamCreationModal } from '../src/client/TeamCreationModal.tsx'
import { TeamEditorModal } from '../src/client/TeamEditorModal.tsx'
import { MemoryPanel } from '../src/client/MemoryPanel.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
const profile: AssistantProfile = { id: AssistantProfileId('p1'), name: 'First', responsibility: 'Assist', revision: 1, createdAt: 1, updatedAt: 1 }
const otherProfile: AssistantProfile = { ...profile, id: AssistantProfileId('p2'), name: 'Second' }
const team: TeamDefinition = { id: TeamDefinitionId('team'), name: 'Existing team', coordinatorProfileId: profile.id, seatIds: [], revision: 1, createdAt: 1, updatedAt: 1 }
afterEach(cleanup)

describe('Assistant and team form request lifecycle', () => {
  it('selects the coordinator after profiles arrive asynchronously', () => {
    const props = { isOpen: true, profiles: [], onClose: vi.fn(), onCreateTeam: vi.fn(), t }
    const view = render(<TeamCreationModal {...props} />)
    fireEvent.change(screen.getByTestId('team-name-input'), { target: { value: 'New team' } })
    view.rerender(<TeamCreationModal {...props} profiles={[profile]} />)
    expect((screen.getByTestId('coordinator-select') as HTMLSelectElement).value).toBe(profile.id)
    expect((screen.getByTestId('create-team-submit') as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows failed team creation without closing or losing entered text', async () => {
    const close = vi.fn()
    render(<TeamCreationModal isOpen profiles={[profile]} onClose={close} onCreateTeam={async () => { throw new Error('offline') }} t={t} />)
    fireEvent.change(screen.getByTestId('team-name-input'), { target: { value: 'Keep my team' } })
    fireEvent.click(screen.getByTestId('create-team-submit'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())
    expect((screen.getByTestId('team-name-input') as HTMLInputElement).value).toBe('Keep my team')
    expect(close).not.toHaveBeenCalled()
  })

  it('shows failed team editing and resets fields when switching team', async () => {
    const props = { isOpen: true, team, seats: [], profiles: [profile], models: [], onClose: vi.fn(), onSave: async () => { throw new Error('offline') }, t }
    const view = render(<TeamEditorModal {...props} />)
    fireEvent.change(screen.getByTestId('edit-team-name-input'), { target: { value: 'My edited name' } })
    fireEvent.click(screen.getByTestId('edit-team-save'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())
    expect((screen.getByTestId('edit-team-name-input') as HTMLInputElement).value).toBe('My edited name')
    view.rerender(<TeamEditorModal {...props} team={{ ...team, id: TeamDefinitionId('other'), name: 'Other team' }} />)
    expect((screen.getByTestId('edit-team-name-input') as HTMLInputElement).value).toBe('Other team')
  })

  it('does not clear an untouched model when team seats arrive after opening', async () => {
    const seat: TeamSeat = { id: TeamSeatId('late-seat'), teamId: team.id, profileId: profile.id, name: 'writer', role: 'teammate', duty: 'Write materials',
      modelOverride: { provider: 'mock', model: 'current' }, runtimeInstances: [], createdAt: 1, updatedAt: 1 }
    const update = vi.fn()
    const save = vi.fn().mockResolvedValue(undefined)
    const props = { isOpen: true, team, profiles: [profile], models: [{ provider: 'mock', id: 'current', name: 'Current' }], onClose: vi.fn(), onSave: save, onUpdateSeat: update, t }
    const view = render(<TeamEditorModal {...props} seats={[]} />)
    view.rerender(<TeamEditorModal {...props} seats={[seat]} />)
    expect((screen.getByTestId('seat-model-select-writer') as HTMLSelectElement).value).toBe('mock:current')
    fireEvent.click(screen.getByTestId('edit-team-save'))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(update).not.toHaveBeenCalled()
  })

  it('retains failed memory input and reports the rejected save', async () => {
    render(<MemoryPanel scope={{ kind: 'profile', profileId: profile.id }} memories={[]} onSaveMemory={async () => { throw new Error('offline') }} t={t} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep this memory' } })
    fireEvent.click(screen.getByText(t('addMemory')))
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Keep this memory')
  })

  it('discards unsaved memory input when changing scope', () => {
    const props = { memories: [], onSaveMemory: vi.fn(), t }
    const view = render(<MemoryPanel {...props} scope={{ kind: 'profile', profileId: profile.id }} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Private first scope' } })
    view.rerender(<MemoryPanel {...props} scope={{ kind: 'profile', profileId: otherProfile.id }} />)
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('')
  })

  it('does not render a prior profile memory load error after switching scope', async () => {
    let rejectFirst: (error: Error) => void = () => {}
    const first = new Promise<readonly MemoryEntry[]>((_resolve, reject) => { rejectFirst = reject })
    const load = vi.fn().mockReturnValueOnce(first).mockResolvedValue([])
    const props = { isOpen: true, onClose: vi.fn(), loadMemories: load, t }
    const view = render(<AssistantDetailDrawer {...props} profile={profile} />)
    view.rerender(<AssistantDetailDrawer {...props} profile={otherProfile} />)
    await act(async () => { rejectFirst(new Error('old scope failure')) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the revision captured when memory editing began', async () => {
    const entry: MemoryEntry = { id: MemoryEntryId('memory'), scope: { kind: 'profile', profileId: profile.id },
      text: 'Original fact', revision: 1, createdAt: 1, updatedAt: 1 }
    const update = vi.fn().mockResolvedValue(undefined)
    const props = { scope: entry.scope, onUpdateMemory: update, t }
    const view = render(<MemoryPanel {...props} memories={[entry]} />)
    fireEvent.click(screen.getByText(t('editMemory')))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My pending edit' } })
    view.rerender(<MemoryPanel {...props} memories={[{ ...entry, text: 'Concurrent edit', revision: 2 }]} />)
    fireEvent.click(screen.getByText(t('save')))
    await waitFor(() => expect(update).toHaveBeenCalledWith(entry.id, 'My pending edit', 1))
  })

  it('contains rejected memory promotion with visible feedback', async () => {
    const entry: MemoryEntry = { id: MemoryEntryId('team-memory'), scope: { kind: 'team', teamId: team.id },
      text: 'Shared fact', revision: 1, createdAt: 1, updatedAt: 1 }
    render(<MemoryPanel scope={entry.scope} memories={[entry]} onPromoteMemory={async () => { throw new Error('offline') }} t={t} />)
    fireEvent.click(screen.getByText(t('promoteMemory')))
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())
    expect(screen.getByText('Shared fact')).toBeDefined()
  })

  it('ignores a successful old profile memory response after switching scope', async () => {
    let resolveFirst: (memories: readonly MemoryEntry[]) => void = () => {}
    const first = new Promise<readonly MemoryEntry[]>((resolve) => { resolveFirst = resolve })
    const load = vi.fn().mockReturnValueOnce(first).mockResolvedValue([])
    const props = { isOpen: true, onClose: vi.fn(), loadMemories: load, t }
    const view = render(<AssistantDetailDrawer {...props} profile={profile} />)
    view.rerender(<AssistantDetailDrawer {...props} profile={otherProfile} />)
    await act(async () => { resolveFirst([{ id: MemoryEntryId('old-private-memory'), scope: { kind: 'profile', profileId: profile.id },
      text: 'Old private memory', revision: 1, createdAt: 1, updatedAt: 1 }]) })
    expect(screen.queryByText('Old private memory')).toBeNull()
  })

  it('reports rejected profile model updates and keeps the previous route', async () => {
    render(<AssistantDetailDrawer isOpen onClose={vi.fn()} profile={{ ...profile, defaultModel: { provider: 'mock', model: 'old' } }} availableModels={[{ provider: 'mock', id: 'old', name: 'Old' }, { provider: 'mock', id: 'new', name: 'New' }]} onUpdateProfile={async () => { throw new Error('offline') }} t={t} />)
    fireEvent.change(screen.getByTestId('profile-model-select'), { target: { value: 'mock:new' } })
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())
    expect((screen.getByTestId('profile-model-select') as HTMLSelectElement).value).toBe('mock:old')
  })
})
