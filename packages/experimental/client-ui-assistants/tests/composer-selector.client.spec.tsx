// @vitest-environment jsdom
/** Display preferences cannot mutate the conversation's actual assistant binding. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session'
import { AssistantProfileId, TeamDefinitionId, type AssistantProfile, type TeamDefinition } from '@deepseek-ai/dsh-experimental-assistant-registry/types'
import { AssistantComposerSelector } from '../src/client/AssistantComposerSelector.tsx'
import { createSelectorPreference } from '../src/client/selector-preference.ts'
import { zh } from '../src/client/locales.ts'

const profile: AssistantProfile = { id: AssistantProfileId('writer'), name: '文书助理', responsibility: '写作', revision: 1, createdAt: 1, updatedAt: 1 }
const team: TeamDefinition = { id: TeamDefinitionId('writers'), name: '文书组', coordinatorProfileId: profile.id,
  seatIds: [], revision: 1, createdAt: 1, updatedAt: 1 }
const sid = SessionId('current')
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })
function fixture() {
  const state = createSnapshotStore({ blank: true, running: false })
  const preference = createSelectorPreference(localStorage)
  return { t: makeTranslate(zh), sessionId: sid, sessionState: state, preference,
    changes: { subscribe: (_fn: () => void) => () => {}, getSnapshot: () => 0 },
    loadProfiles: vi.fn(async () => [profile]), loadTeams: vi.fn(async () => [team]),
    loadIdentity: vi.fn(async () => ({ profile })),
    onStartChat: vi.fn(async () => {}), onOpenTeam: vi.fn(), onUseOrdinary: vi.fn(async () => {}), onManage: vi.fn() }
}
describe('A3 selector with optional A2 avatar shelf', () => {
  it('defaults to compact identity and remembers expanded avatars without changing the binding', async () => {
    const props = fixture()
    const view = render(<AssistantComposerSelector {...props} />)
    expect((await screen.findByTestId('selector-current-name')).textContent).toContain(profile.name)
    expect(screen.queryByTestId('selector-avatar-shelf')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.expandSelectorAvatars }))
    expect(screen.getByTestId('selector-avatar-shelf')).toBeTruthy()
    expect(props.onStartChat).not.toHaveBeenCalled()
    expect(props.onOpenTeam).not.toHaveBeenCalled()
    expect(props.onUseOrdinary).not.toHaveBeenCalled()
    view.unmount()
    render(<AssistantComposerSelector {...props} preference={createSelectorPreference(localStorage)} />)
    expect(await screen.findByTestId('selector-avatar-shelf')).toBeTruthy()
  })
  it('opens the chosen team and keeps Host-confirmed identity distinct from browsing a menu', async () => {
    const props = fixture()
    render(<AssistantComposerSelector {...props} />)
    await screen.findByTestId('selector-current-name')
    fireEvent.click(screen.getByRole('button', { name: zh.expandSelectorAvatars }))
    fireEvent.click(await screen.findByRole('button', { name: team.name }))
    await waitFor(() => { expect(props.onOpenTeam).toHaveBeenCalledExactlyOnceWith(team.id) })
    expect(screen.getByTestId('selector-current-name').textContent).toContain(profile.name)
    expect(props.onStartChat).not.toHaveBeenCalled()
  })
  it('keeps the selected identity visible when changing assistant fails', async () => {
    const props = fixture()
    props.onStartChat.mockRejectedValueOnce(new Error('Binding failed'))
    render(<AssistantComposerSelector {...props} />)
    await screen.findByTestId('selector-current-name')
    fireEvent.click(screen.getByRole('button', { name: zh.expandSelectorAvatars }))
    fireEvent.click(await screen.findByRole('button', { name: profile.name }))
    await waitFor(() => { expect(screen.getByRole('alert')).toBeTruthy() })
    expect(screen.getByTestId('selector-current-name').textContent).toContain(profile.name)
  })
})


describe('Selector lifecycle guards', () => {
  it('leaves ordinary mode unselected until Host identity resolves and does not wait for a stalled directory', async () => {
    const props = fixture()
    let resolve!: (value: { profile: AssistantProfile }) => void
    props.loadIdentity.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    props.loadTeams.mockImplementationOnce(() => new Promise(() => {}))
    render(<AssistantComposerSelector {...props} />)
    expect(screen.getByRole('button', { name: zh.selectorOrdinary }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: zh.selectorOrdinary }).hasAttribute('disabled')).toBe(true)
    resolve({ profile })
    await waitFor(() => { expect(screen.getByTestId('selector-current-name').textContent).toContain(profile.name) })
  })
  it('does not list archived or deleted assistants and teams', async () => {
    const props = fixture()
    props.loadProfiles.mockResolvedValue([profile, { ...profile, id: AssistantProfileId('archived'), name: 'Archived', archivedAt: 1 }])
    props.loadTeams.mockResolvedValue([team, { ...team, id: TeamDefinitionId('deleted'), name: 'Deleted', deletedAt: 1 }])
    render(<AssistantComposerSelector {...props} />)
    await waitFor(() => { expect(screen.getByTestId('selector-current-name').textContent).toContain(profile.name) })
    fireEvent.click(screen.getByRole('button', { name: zh.expandSelectorAvatars }))
    expect(screen.queryByRole('button', { name: 'Archived' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deleted' })).toBeNull()
  })
  it('lets a running Session change presentation while disabling identity-changing actions', async () => {
    const props = fixture()
    props.sessionState.set({ blank: false, running: true })
    render(<AssistantComposerSelector {...props} />)
    await waitFor(() => { expect(screen.getByTestId('selector-current-name').textContent).toContain(profile.name) })
    fireEvent.click(screen.getByRole('button', { name: zh.expandSelectorAvatars }))
    expect(screen.getByRole('button', { name: profile.name }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: zh.startOrdinaryConversation }).hasAttribute('disabled')).toBe(true)
    expect(props.onStartChat).not.toHaveBeenCalled()
  })
  it('keeps the display switch usable when browser storage is denied', () => {
    const storage = { getItem: () => { throw new Error('Denied') }, setItem: () => { throw new Error('Denied') } }
    const preference = createSelectorPreference(storage)
    expect(preference.getSnapshot()).toBe(false)
    preference.setExpanded(true)
    expect(preference.getSnapshot()).toBe(true)
  })
})
