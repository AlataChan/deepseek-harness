// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  AssistantProfileId,
  TeamDefinitionId,
  TeamSeatId,
  type AssistantProfile,
  type TeamDefinition,
  type TeamSeat,
} from '@deepseek-ai/dsh-experimental-assistant-registry'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  TeamView,
  TeamCreationModal,
  TeamEditorModal,
  zh,
} from '../src/client/index.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const tZh = makeTranslate(zh)

const coordinatorProfile: AssistantProfile = {
  id: AssistantProfileId('asst-coord'),
  name: '总协调员',
  responsibility: '负责协调团队任务与成员分派',
  instructions: '优先分派并收口终稿',
  revision: 1,
  defaultModel: { provider: 'mock', model: 'coord-model' },
  createdAt: 1000,
  updatedAt: 1000,
}

const workerProfile: AssistantProfile = {
  id: AssistantProfileId('asst-worker'),
  name: '文书起草员',
  responsibility: '负责撰写与修改材料',
  instructions: '按格式要求起草文件',
  revision: 1,
  defaultModel: { provider: 'mock', model: 'drafter-model' },
  createdAt: 1000,
  updatedAt: 1000,
}

const testTeam: TeamDefinition = {
  id: TeamDefinitionId('team-doc-1'),
  name: '文书处理专项团队',
  description: '负责机构重要公文与文书编撰',
  coordinatorProfileId: coordinatorProfile.id,
  leadSessionId: SessionId('session-lead-1'),
  sharedWorkspaceId: 'workspace-doc',
  templateOrigin: 'document',
  seatIds: [TeamSeatId('seat-drafter'), TeamSeatId('seat-reviewer')],
  revision: 1,
  createdAt: 2000,
  updatedAt: 2000,
}

const testSeats: readonly TeamSeat[] = [
  {
    id: TeamSeatId('seat-drafter'),
    teamId: testTeam.id,
    profileId: workerProfile.id,
    role: 'teammate',
    name: 'drafter',
    duty: '撰写起草文稿',
    title: '文书撰写员',
    modelOverride: { provider: 'mock', model: 'override-drafter' },
    runtimeInstances: [SessionId('inst-drafter-1')],
    activeInstanceId: SessionId('inst-drafter-1'),
    createdAt: 2000,
    updatedAt: 2000,
  },
  {
    id: TeamSeatId('seat-reviewer'),
    teamId: testTeam.id,
    profileId: workerProfile.id,
    role: 'teammate',
    name: 'reviewer',
    duty: '审核校验事实与文字',
    title: '文书审核员',
    runtimeInstances: [SessionId('inst-reviewer-1')],
    activeInstanceId: SessionId('inst-reviewer-1'),
    createdAt: 2000,
    updatedAt: 2000,
  },
]

describe('Team UI (S15)', () => {
  it('renders team creation modal with template selection, coordinator, and form submission', async () => {
    const handleCreate = vi.fn()
    const handleClose = vi.fn()

    render(
      <TeamCreationModal
        t={tZh}
        isOpen={true}
        profiles={[coordinatorProfile, workerProfile]}
        onClose={handleClose}
        onCreateTeam={handleCreate}
      />,
    )

    // Check modal title and templates
    expect(screen.getByText('新建团队')).toBeTruthy()
    expect(screen.getByTestId('template-blank')).toBeTruthy()
    expect(screen.getByTestId('template-document')).toBeTruthy()
    expect(screen.getByTestId('template-case')).toBeTruthy()
    expect(screen.getByTestId('template-comms')).toBeTruthy()

    // Select 'document' template
    fireEvent.click(screen.getByTestId('template-document'))

    // Coordinator select
    const coordinatorSelect = screen.getByTestId('coordinator-select')
    fireEvent.change(coordinatorSelect, { target: { value: coordinatorProfile.id } })

    // Name and description
    const nameInput = screen.getByTestId('team-name-input')
    fireEvent.change(nameInput, { target: { value: '我的文书小队' } })

    const descInput = screen.getByTestId('team-desc-input')
    fireEvent.change(descInput, { target: { value: '起草重要文档' } })

    const workspaceInput = screen.getByTestId('team-workspace-input')
    fireEvent.change(workspaceInput, { target: { value: 'ws-main' } })

    // Submit
    fireEvent.click(screen.getByTestId('create-team-submit'))

    expect(handleCreate).toHaveBeenCalledWith({
      name: '我的文书小队',
      templateOrigin: 'document',
      coordinatorProfileId: coordinatorProfile.id,
      description: '起草重要文档',
      sharedWorkspaceId: 'ws-main',
    })
    await vi.waitFor(() => {
      expect(handleClose).toHaveBeenCalled()
    })
  })

  it('renders editable team definition modal applying seat updates through onUpdateSeat', async () => {
    const handleSave = vi.fn()
    const handleUpdateSeat = vi.fn()
    const handleClose = vi.fn()

    render(
      <TeamEditorModal
        t={tZh}
        isOpen={true}
        team={testTeam}
        seats={testSeats}
        profiles={[coordinatorProfile, workerProfile]}
        models={[
          { id: 'coord-model', name: 'Coordinator Model', provider: 'mock' },
          { id: 'drafter-model-v2', name: 'Drafter Model V2', provider: 'mock' },
        ]}
        onClose={handleClose}
        onSave={handleSave}
        onUpdateSeat={handleUpdateSeat}
      />,
    )

    expect(screen.getByText('编辑团队')).toBeTruthy()

    // Edit team name
    const nameInput = screen.getByTestId('edit-team-name-input')
    fireEvent.change(nameInput, { target: { value: '修改后的文书团队' } })

    // Edit seat duty
    const dutyInput = screen.getByTestId('seat-duty-input-drafter')
    fireEvent.change(dutyInput, { target: { value: '负责起草核心材料及润色' } })

    // Edit seat model through the served catalog
    const modelSelect = screen.getByTestId('seat-model-select-drafter')
    fireEvent.change(modelSelect, { target: { value: 'mock:drafter-model-v2' } })

    // Save
    fireEvent.click(screen.getByTestId('edit-team-save'))

    await vi.waitFor(() => {
      expect(handleUpdateSeat).toHaveBeenCalledTimes(1)
    })
    expect(handleUpdateSeat).toHaveBeenCalledWith(TeamSeatId('seat-drafter'), {
      duty: '负责起草核心材料及润色',
      modelOverride: { provider: 'mock', model: 'drafter-model-v2' },
    })
    expect(handleSave).toHaveBeenCalledWith({
      name: '修改后的文书团队',
      description: undefined,
      coordinatorProfileId: undefined,
      sharedWorkspaceId: undefined,
    })
    await vi.waitFor(() => {
      expect(handleClose).toHaveBeenCalled()
    })
  })

  it('saves team details when its unchanged coordinator is absent from the selectable profiles', async () => {
    const handleSave = vi.fn()
    render(
      <TeamEditorModal
        t={tZh}
        isOpen={true}
        team={testTeam}
        seats={testSeats}
        profiles={[workerProfile]}
        models={[]}
        onClose={vi.fn()}
        onSave={handleSave}
      />,
    )
    fireEvent.change(screen.getByTestId('edit-team-name-input'), { target: { value: '更新后的团队' } })
    fireEvent.click(screen.getByTestId('edit-team-save'))
    await vi.waitFor(() => {
      expect(handleSave).toHaveBeenCalledWith(expect.objectContaining({
        name: '更新后的团队',
        coordinatorProfileId: undefined,
      }))
    })
  })

  it('clears one seat model override when its selection is emptied', async () => {
    const handleUpdateSeat = vi.fn()
    render(
      <TeamEditorModal
        t={tZh}
        isOpen={true}
        team={testTeam}
        seats={testSeats}
        profiles={[coordinatorProfile, workerProfile]}
        models={[{ id: 'override-drafter', name: 'Override Drafter', provider: 'mock' }]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onUpdateSeat={handleUpdateSeat}
      />,
    )

    fireEvent.change(screen.getByTestId('seat-model-select-drafter'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('edit-team-save'))

    await vi.waitFor(() => {
      expect(handleUpdateSeat).toHaveBeenCalledWith(TeamSeatId('seat-drafter'), { modelOverride: null })
    })
    expect(handleUpdateSeat).toHaveBeenCalledTimes(1)
  })

  it('shows an unavailable seat model selection explicitly', () => {
    render(
      <TeamEditorModal
        t={tZh}
        isOpen={true}
        team={testTeam}
        seats={testSeats}
        profiles={[coordinatorProfile, workerProfile]}
        models={[{ id: 'coord-model', name: 'Coordinator Model', provider: 'mock' }]}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    const modelSelect = screen.getByTestId('seat-model-select-drafter')
    expect(modelSelect.textContent).toContain('mock / override-drafter')
    expect(modelSelect.textContent).toContain(zh.modelUnavailable)
  })

  it('renders TeamView with coordinator-first badge, tab switching, and dock integration', async () => {
    const handleTabChange = vi.fn()
    const handleOpenDock = vi.fn()

    render(
      <TeamView
        t={tZh}
        team={testTeam}
        seats={testSeats}
        profiles={[coordinatorProfile, workerProfile]}
        onTabChange={handleTabChange}
        onOpenDock={handleOpenDock}
      />,
    )

    // 1. Verify header and coordinator-first badge
    expect(screen.getByTestId('team-name').textContent).toBe('文书处理专项团队')
    const badge = screen.getByTestId('coordinator-first-badge')
    expect(badge.textContent).toBe('主控协调员优先分派')

    // 2. Verify tabs
    const discussionTab = screen.getByTestId('tab-discussion')
    const tasksTab = screen.getByTestId('tab-tasks')
    const deliverablesTab = screen.getByTestId('tab-deliverables')

    expect(discussionTab.textContent).toBe('讨论')
    expect(tasksTab.textContent).toBe('任务')
    expect(deliverablesTab.textContent).toBe('成果')

    // Default tab is discussion
    expect(screen.getByTestId('discussion-pane')).toBeTruthy()

    // Switch to tasks
    fireEvent.click(tasksTab)
    expect(handleTabChange).toHaveBeenCalledWith('tasks')
    expect(screen.getByTestId('tasks-pane')).toBeTruthy()

    // Switch to deliverables
    fireEvent.click(deliverablesTab)
    expect(handleTabChange).toHaveBeenCalledWith('deliverables')
    expect(screen.getByTestId('deliverables-pane')).toBeTruthy()

    // 3. Verify dock integration button
    const dockBtn = screen.getByTestId('open-dock-button')
    expect(dockBtn.textContent).toBe('协作面板')
    fireEvent.click(dockBtn)
    expect(handleOpenDock).toHaveBeenCalled()
  })

  it('renders seat details and executes member detail actions: activity log & private conversation', async () => {
    const handleViewActivityLog = vi.fn()
    const handleOpenPrivateChat = vi.fn()

    render(
      <TeamView
        t={tZh}
        team={testTeam}
        seats={testSeats}
        profiles={[coordinatorProfile, workerProfile]}
        onViewActivityLog={handleViewActivityLog}
        onOpenPrivateChat={handleOpenPrivateChat}
      />,
    )

    // Check seats rendered
    expect(screen.getByTestId('seat-card-drafter')).toBeTruthy()
    expect(screen.getByTestId('seat-card-reviewer')).toBeTruthy()

    // Member actions for drafter seat
    const activityButtons = screen.getAllByTestId('view-activity-log')
    const chatButtons = screen.getAllByTestId('open-private-chat')

    expect(activityButtons.length).toBe(2)
    expect(chatButtons.length).toBe(2)

    // Click '查看团队工作记录' on drafter
    fireEvent.click(activityButtons[0]!)
    expect(handleViewActivityLog).toHaveBeenCalledWith(testSeats[0])

    // Click '打开私人会话' on drafter
    fireEvent.click(chatButtons[0]!)
    expect(handleOpenPrivateChat).toHaveBeenCalledWith(workerProfile.id)
  })
})
