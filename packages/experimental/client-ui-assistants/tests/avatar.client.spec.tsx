// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { EntityAvatar, AvatarPicker } from '../src/client/EntityAvatar.tsx'
import { zh } from '../src/client/locales.ts'
import { waitFor } from '@testing-library/react'
import {
  AssistantProfileId,
  TeamDefinitionId,
  type AssistantProfile,
  type TeamDefinition,
} from '@deepseek-ai/dsh-experimental-assistant-registry'
import { TeamCreationModal } from '../src/client/TeamCreationModal.tsx'
import { TeamEditorModal } from '../src/client/TeamEditorModal.tsx'
import { AssistantDetailDrawer } from '../src/client/AssistantDetailDrawer.tsx'
import { AssistantDirectory, type AssistantDirectoryProps } from '../src/client/AssistantDirectory.tsx'
/** Avatar selection stays local and round-trips through forms. */
afterEach(cleanup)
it('renders grapheme-safe initials and falls back for legacy values without fetching images', () => {
  const view = render(<EntityAvatar name="社区助理" avatar="https://example.invalid/private.png" />)
  expect(view.container.textContent).toBe('社区')
  expect(view.container.querySelector('img')).toBeNull()
  view.rerender(<EntityAvatar name="Jane Smith" avatar="icon:document" />)
  expect(view.container.querySelector('[data-avatar="icon:document"] svg')).not.toBeNull()
  view.rerender(<EntityAvatar name="👩‍💻" />)
  expect(view.container.textContent).toBe('👩‍💻')
})
it('selects an icon and automatic initials without submitting', () => {
  const change = vi.fn()
  const submit = vi.fn()
  render(
    <form onSubmit={submit}>
      <AvatarPicker name="Example" value="" onChange={change} t={makeTranslate(zh)} />
    </form>,
  )
  fireEvent.click(screen.getByRole('radio', { name: zh.avatarDocument }))
  expect(change).toHaveBeenCalledWith('icon:document')
  expect(submit).not.toHaveBeenCalled()
})

const t = makeTranslate(zh)
const profile: AssistantProfile = {
  id: AssistantProfileId('avatar-profile'),
  name: 'Jane Smith',
  responsibility: 'Help',
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
}
const team: TeamDefinition = {
  id: TeamDefinitionId('avatar-team'),
  name: 'Team',
  coordinatorProfileId: profile.id,
  avatar: 'icon:team',
  seatIds: [],
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
}
it('saves a new assistant avatar and renders the saved selection after refresh', async () => {
  let saved: AssistantProfile[] = []
  const create = vi.fn(async (data) => {
    saved = [{ ...profile, ...data }]
  })
  render(
    <AssistantDirectory
      {...({
        t,
        loadProfiles: async () => saved,
        loadTeams: async () => [],
        loadSeats: async () => [],
        loadModels: async () => [],
        onCreateProfile: create,
        onStartChat: vi.fn(),
        onArchiveProfile: vi.fn(),
        onUpdateProfile: vi.fn(),
      } as AssistantDirectoryProps)}
    />,
  )
  fireEvent.click(screen.getByText(zh.newAssistant))
  fireEvent.change(screen.getByLabelText(zh.name), { target: { value: profile.name } })
  fireEvent.click(screen.getByRole('radio', { name: zh.avatarIdea }))
  fireEvent.click(screen.getByText(zh.save))
  await waitFor(() => expect(create).toHaveBeenCalledWith({ name: profile.name, avatar: 'icon:idea' }))
  await screen.findByText(profile.name)
  expect(document.querySelector('[data-avatar="icon:idea"]')).not.toBeNull()
})
it('passes a selected avatar through team creation', async () => {
  const create = vi.fn()
  render(<TeamCreationModal isOpen profiles={[profile]} onCreateTeam={create} onClose={vi.fn()} t={t} />)
  fireEvent.change(screen.getByTestId('team-name-input'), { target: { value: 'Saved team' } })
  fireEvent.click(screen.getByRole('radio', { name: zh.avatarGlobe }))
  fireEvent.click(screen.getByTestId('create-team-submit'))
  await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ avatar: 'icon:globe' })))
})
it('explicitly clears a stored team preset when initials are selected', async () => {
  const save = vi.fn()
  render(<TeamEditorModal isOpen team={team} profiles={[profile]} seats={[]} models={[]} onSave={save} onClose={vi.fn()} t={t} />)
  fireEvent.click(screen.getByRole('radio', { name: zh.avatarInitials }))
  fireEvent.click(screen.getByTestId('edit-team-save'))
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ avatar: '' })))
})
it('reports failed avatar persistence and keeps the saved selection', async () => {
  render(
    <AssistantDetailDrawer
      isOpen
      profile={{ ...profile, avatar: 'icon:person' }}
      onClose={vi.fn()}
      onUpdateProfile={async () => {
        throw new Error('offline')
      }}
      t={t}
    />,
  )
  fireEvent.click(screen.getByRole('radio', { name: zh.avatarDocument }))
  await screen.findByRole('alert')
  expect((screen.getByRole('radio', { name: zh.avatarPerson }) as HTMLInputElement).checked).toBe(true)
  expect((screen.getByRole('radio', { name: zh.avatarDocument }) as HTMLInputElement).checked).toBe(false)
})
