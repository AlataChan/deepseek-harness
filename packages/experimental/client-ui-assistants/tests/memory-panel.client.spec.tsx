// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  MemoryEntryId,
  AssistantProfileId,
  TeamDefinitionId,
  type MemoryEntry,
} from '@deepseek-ai/dsh-experimental-assistant-registry'
import { MemoryPanel } from '../src/client/MemoryPanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const tZh = makeTranslate(zh)

const testProfileMemories: readonly MemoryEntry[] = [
  {
    id: MemoryEntryId('mem-1'),
    scope: { kind: 'profile', profileId: AssistantProfileId('prof-1') },
    text: 'Always respond in Markdown format',
    revision: 1,
    author: 'user',
    createdAt: 1000,
    updatedAt: 1000,
  },
  {
    id: MemoryEntryId('mem-2'),
    scope: { kind: 'profile', profileId: AssistantProfileId('prof-1') },
    text: 'Prefer metric units in calculation',
    revision: 2,
    author: 'user',
    createdAt: 2000,
    updatedAt: 2500,
  },
]

describe('MemoryPanel (S18 Client UI)', () => {
  it('renders empty state when no memories are present', () => {
    render(
      <MemoryPanel
        scope={{ kind: 'profile', profileId: AssistantProfileId('prof-1') }}
        memories={[]}
        t={tZh}
      />,
    )

    expect(screen.getByText('常驻记忆')).toBeDefined()
    expect(screen.getByText('智能体记忆')).toBeDefined()
    expect(screen.getByText('暂无常驻记忆')).toBeDefined()
  })

  it('renders list of active memories with text and revision metadata', () => {
    render(
      <MemoryPanel
        scope={{ kind: 'profile', profileId: AssistantProfileId('prof-1') }}
        memories={testProfileMemories}
        t={tZh}
      />,
    )

    expect(screen.getByText('Always respond in Markdown format')).toBeDefined()
    expect(screen.getByText('Prefer metric units in calculation')).toBeDefined()
    expect(screen.getByText('版本: 1')).toBeDefined()
    expect(screen.getByText('版本: 2')).toBeDefined()
  })

  it('adds a new memory on form submission', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <MemoryPanel
        scope={{ kind: 'profile', profileId: AssistantProfileId('prof-1') }}
        memories={testProfileMemories}
        onSaveMemory={onSave}
        t={tZh}
      />,
    )

    const input = screen.getByLabelText('输入需要记住的内容...')
    fireEvent.change(input, { target: { value: 'Never use emojis' } })

    const addBtn = screen.getByText('记住这条')
    fireEvent.click(addBtn)

    expect(onSave).toHaveBeenCalledWith('Never use emojis')
  })

  it('edits an existing memory with CAS revision validation', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)

    render(
      <MemoryPanel
        scope={{ kind: 'profile', profileId: AssistantProfileId('prof-1') }}
        memories={testProfileMemories}
        onUpdateMemory={onUpdate}
        t={tZh}
      />,
    )

    const editBtns = screen.getAllByText('编辑')
    fireEvent.click(editBtns[0]!)

    const textarea = screen.getByLabelText('编辑')
    fireEvent.change(textarea, { target: { value: 'Updated markdown instruction' } })

    const saveBtn = screen.getByText('保存')
    fireEvent.click(saveBtn)

    expect(onUpdate).toHaveBeenCalledWith(
      MemoryEntryId('mem-1'),
      'Updated markdown instruction',
      1,
    )
  })

  it('displays conflict message when update fails due to revision conflict', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('RevisionConflictError'))

    render(
      <MemoryPanel
        scope={{ kind: 'profile', profileId: AssistantProfileId('prof-1') }}
        memories={testProfileMemories}
        onUpdateMemory={onUpdate}
        t={tZh}
      />,
    )

    const editBtns = screen.getAllByText('编辑')
    fireEvent.click(editBtns[0]!)

    const textarea = screen.getByLabelText('编辑')
    fireEvent.change(textarea, { target: { value: 'Conflicting update' } })

    const saveBtn = screen.getByText('保存')
    fireEvent.click(saveBtn)

    await vi.waitFor(() => {
      expect(screen.getByText('冲突：该记忆已被其他进程更新，请刷新重试。')).toBeDefined()
    })
  })

  it('removes memory with expected revision on delete button click', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined)

    render(
      <MemoryPanel
        scope={{ kind: 'profile', profileId: AssistantProfileId('prof-1') }}
        memories={testProfileMemories}
        onRemoveMemory={onRemove}
        t={tZh}
      />,
    )

    const deleteBtns = screen.getAllByText('删除')
    fireEvent.click(deleteBtns[0]!)

    expect(onRemove).toHaveBeenCalledWith(MemoryEntryId('mem-1'), 1)
  })

  it('supports promoting team-scoped memory to profile', async () => {
    const onPromote = vi.fn().mockResolvedValue(undefined)

    const teamMemories: readonly MemoryEntry[] = [
      {
        id: MemoryEntryId('team-mem-1'),
        scope: { kind: 'team', teamId: TeamDefinitionId('team-alpha') },
        text: 'Team rule: submit PRs before 5pm',
        revision: 1,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]

    render(
      <MemoryPanel
        scope={{ kind: 'team', teamId: TeamDefinitionId('team-alpha') }}
        memories={teamMemories}
        onPromoteMemory={onPromote}
        t={tZh}
      />,
    )

    expect(screen.getByText('团队记忆')).toBeDefined()
    const promoteBtn = screen.getByText('提升为个人记忆')
    fireEvent.click(promoteBtn)

    expect(onPromote).toHaveBeenCalledWith(MemoryEntryId('team-mem-1'))
  })
})
