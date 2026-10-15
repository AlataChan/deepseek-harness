// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { Context } from '@deepseek-ai/cordis'
import {
  AssistantProfileId,
  AssistantConversationId,
  type AssistantProfile,
  type AssistantConversation,
} from '@deepseek-ai/dsh-experimental-assistant-registry'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  AssistantDirectory,
  type AssistantDirectoryProps,
} from '../src/client/AssistantDirectory.tsx'
import {
  AssistantHeroCard,
  type AssistantHeroCardProps,
} from '../src/client/AssistantHeroCard.tsx'
import {
  AssistantConversationHeader,
  type AssistantConversationHeaderProps,
} from '../src/client/AssistantConversationHeader.tsx'
import {
  AssistantExampleChips,
  type AssistantExampleChipsProps,
} from '../src/client/AssistantExampleChips.tsx'
import { AssistantsPanelIcon } from '../src/client/AssistantsPanelIcon.tsx'
import { mountAssistantsUi, PANEL_ID } from '../src/client/mount.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const tZh = makeTranslate(zh)

const testProfile: AssistantProfile = {
  id: AssistantProfileId('asst-writer'),
  name: '文案助手',
  responsibility: '负责撰写宣传文案与总结报告',
  instructions: '请使用专业、简洁的中文回复',
  revision: 1,
  defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
  createdAt: 1000,
  updatedAt: 1000,
}

const testConversation: AssistantConversation = {
  id: AssistantConversationId('asst-conv-1'),
  profileId: testProfile.id,
  rootSessionId: 'session-root-1' as SessionId,
  modelOverride: { provider: 'deepseek', model: 'deepseek-reasoner' },
  modelCheckpoint: 5,
  createdAt: 2000,
  updatedAt: 2000,
}

describe('AssistantDirectory', () => {
  it('shows saved assistants while the model catalog is still pending', async () => {
    let profiles: readonly AssistantProfile[] = []
    render(<AssistantDirectory {...{
      t: tZh,
      loadProfiles: async () => profiles,
      loadTeams: async () => [],
      loadSeats: async () => [],
      loadModels: () => new Promise<never>(() => {}),
      onCreateProfile: async () => { profiles = [testProfile] },
      onStartChat: vi.fn(), onArchiveProfile: vi.fn(), onUpdateProfile: vi.fn(),
    } as AssistantDirectoryProps} />)
    fireEvent.click(screen.getByText(zh.newAssistant))
    fireEvent.change(screen.getByLabelText(zh.name), { target: { value: testProfile.name } })
    fireEvent.click(screen.getByText(zh.save))
    expect(await screen.findByText(testProfile.name)).toBeTruthy()
  })

  it('renders assistants even when the team list fails', async () => {
    render(<AssistantDirectory {...{
      t: tZh, loadProfiles: async () => [testProfile],
      loadTeams: async () => { throw new Error('team lookup failed') },
      loadSeats: async () => [], loadModels: async () => [],
      onCreateProfile: vi.fn(), onStartChat: vi.fn(), onArchiveProfile: vi.fn(), onUpdateProfile: vi.fn(),
    } as AssistantDirectoryProps} />)
    expect(await screen.findByText(testProfile.name)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('team lookup failed')
  })

  it('keeps the entered draft and shows a failed save', async () => {
    render(<AssistantDirectory {...{
      t: tZh, loadProfiles: async () => [], loadTeams: async () => [],
      loadSeats: async () => [], loadModels: async () => [],
      onCreateProfile: async () => { throw new Error('storage write failed') },
      onStartChat: vi.fn(), onArchiveProfile: vi.fn(), onUpdateProfile: vi.fn(),
    } as AssistantDirectoryProps} />)
    fireEvent.click(screen.getByText(zh.newAssistant))
    fireEvent.change(screen.getByLabelText(zh.name), { target: { value: testProfile.name } })
    fireEvent.click(screen.getByText(zh.save))
    expect((await screen.findByRole('alert')).textContent).toContain('storage write failed')
    expect((screen.getByLabelText(zh.name) as HTMLInputElement).value).toBe(testProfile.name)
  })

  it('renders empty state when no profiles exist', async () => {
    const props = {
      t: tZh,
      loadProfiles: async () => [],
      loadTeams: async () => [],
      loadSeats: async () => [],
      loadModels: async () => [],
      onCreateProfile: vi.fn(),
      onStartChat: vi.fn(),
      onArchiveProfile: vi.fn(),
      onUpdateProfile: vi.fn(),
    } as AssistantDirectoryProps
    render(<AssistantDirectory {...props} />)
    expect(await screen.findByText(zh.empty)).toBeTruthy()
    expect(screen.getByText(zh.panel)).toBeTruthy()
  })

  it('renders loaded profile cards and handles start chat, details, and archive', async () => {
    const onStartChat = vi.fn()
    const onArchiveProfile = vi.fn().mockResolvedValue(undefined)

    const props = {
      t: tZh,
      loadProfiles: async () => [testProfile],
      loadTeams: async () => [],
      loadSeats: async () => [],
      loadModels: async () => [],
      onCreateProfile: vi.fn(),
      onStartChat,
      onArchiveProfile,
      onUpdateProfile: vi.fn(),
    } as AssistantDirectoryProps
    render(<AssistantDirectory {...props} />)

    expect(await screen.findByText('文案助手')).toBeTruthy()
    expect(screen.getByText(testProfile.responsibility)).toBeTruthy()
    expect(screen.getByText(testProfile.instructions!)).toBeTruthy()

    // Start chat
    fireEvent.click(screen.getByText(zh.startChat))
    expect(onStartChat).toHaveBeenCalledWith(testProfile.id)

    // Details opens the profile drawer
    fireEvent.click(screen.getByText(zh.details))
    expect(screen.getByText(zh.drawerTitle)).toBeTruthy()

    // Archive
    fireEvent.click(screen.getByText(zh.archiveAssistant))
    await waitFor(() => {
      expect(onArchiveProfile).toHaveBeenCalledWith(testProfile.id)
    })
  })

  it('opens create profile form, inputs fields, and submits', async () => {
    const onCreateProfile = vi.fn().mockResolvedValue(undefined)
    const props = {
      t: tZh,
      loadProfiles: async () => [],
      loadTeams: async () => [],
      loadSeats: async () => [],
      loadModels: async () => [],
      onCreateProfile,
      onStartChat: vi.fn(),
      onArchiveProfile: vi.fn(),
      onUpdateProfile: vi.fn(),
    } as AssistantDirectoryProps
    render(<AssistantDirectory {...props} />)

    // Click new assistant button
    fireEvent.click(screen.getByText(zh.newAssistant))

    const nameInput = screen.getByLabelText(zh.name)
    const respInput = screen.getByLabelText(zh.responsibility)
    const instInput = screen.getByLabelText(zh.instructions)

    fireEvent.change(nameInput, { target: { value: '测试智能体' } })
    fireEvent.change(respInput, { target: { value: '核心职责定位' } })
    fireEvent.change(instInput, { target: { value: '详细系统指令' } })

    fireEvent.click(screen.getByText(zh.save))
    expect(onCreateProfile).toHaveBeenCalledWith({
      name: '测试智能体',
      responsibility: '核心职责定位',
      instructions: '详细系统指令',
    })
  })
})

describe('AssistantHeroCard', () => {
  it('returns null when no active profiles exist', async () => {
    const loadProfiles = vi.fn(async () => [])
    const props = {
      t: tZh,
      loadProfiles,
      onStartChat: vi.fn(),
    } as AssistantHeroCardProps
    const { container } = render(<AssistantHeroCard {...props} />)
    expect(container.firstChild).toBeNull()
    await waitFor(() => {
      expect(loadProfiles).toHaveBeenCalled()
    })
    expect(container.firstChild).toBeNull()
  })

  it('renders hero card and triggers start chat', async () => {
    const onStartChat = vi.fn()
    const props = {
      t: tZh,
      loadProfiles: async () => [testProfile],
      onStartChat,
    } as AssistantHeroCardProps
    render(<AssistantHeroCard {...props} />)

    expect(await screen.findByText(zh.heroTitle)).toBeTruthy()
    expect(screen.getByText(zh.heroDesc)).toBeTruthy()
    expect(screen.getByText('文案助手')).toBeTruthy()

    fireEvent.click(screen.getByRole('button'))
    expect(onStartChat).toHaveBeenCalledWith(testProfile.id)
  })
})

describe('AssistantConversationHeader and AssistantDetailDrawer', () => {
  it('returns null when the session has no assistant profile', async () => {
    const loadConversation = vi.fn(async () => undefined)
    const props = {
      t: tZh,
      sessionId: testConversation.rootSessionId,
      loadConversation,
      loadProfile: async () => testProfile,
      loadModels: async () => [],
    } as AssistantConversationHeaderProps
    const { container } = render(<AssistantConversationHeader {...props} />)
    expect(container.firstChild).toBeNull()
    await waitFor(() => {
      expect(loadConversation).toHaveBeenCalledWith(testConversation.rootSessionId)
    })
    expect(container.firstChild).toBeNull()
  })

  it('renders header badge and triggers new topic', async () => {
    const onStartNewTopic = vi.fn().mockResolvedValue(undefined)
    const props = {
      t: tZh,
      sessionId: testConversation.rootSessionId,
      loadConversation: async () => testConversation,
      loadProfile: async () => testProfile,
      loadModels: async () => [],
      onStartNewTopic,
    } as AssistantConversationHeaderProps
    render(<AssistantConversationHeader {...props} />)

    expect(await screen.findByText('文案助手')).toBeTruthy()
    fireEvent.click(screen.getByText(zh.newTopic))
    expect(onStartNewTopic).toHaveBeenCalledWith(testProfile.id)
  })

  it('opens drawer and handles model override and inherit actions', async () => {
    const onSetModelOverride = vi.fn().mockResolvedValue(undefined)
    const onClearModelOverride = vi.fn().mockResolvedValue(undefined)
    const availableModels = [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek' },
    ]

    const props = {
      t: tZh,
      sessionId: testConversation.rootSessionId,
      loadConversation: async () => testConversation,
      loadProfile: async () => testProfile,
      loadModels: async () => availableModels,
      onSetModelOverride,
      onClearModelOverride,
    } as AssistantConversationHeaderProps
    render(<AssistantConversationHeader {...props} />)

    expect(await screen.findByText('文案助手')).toBeTruthy()

    // Open drawer
    fireEvent.click(screen.getByText(zh.details))
    expect(screen.getByText(zh.drawerTitle)).toBeTruthy()
    expect(screen.getByText(testProfile.responsibility)).toBeTruthy()

    // Test model selection change
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'deepseek:deepseek-chat' } })
    await waitFor(() => expect(onSetModelOverride).toHaveBeenCalledWith(testConversation.id, {
      provider: 'deepseek',
      model: 'deepseek-chat',
    }))
    await act(async () => {})

    // Test inherit profile model by selecting empty value
    fireEvent.change(select, { target: { value: '' } })
    expect(onClearModelOverride).toHaveBeenCalledWith(testConversation.id)

    // Close drawer
    fireEvent.click(screen.getByLabelText(zh.cancel))
    expect(screen.queryByText(zh.drawerTitle)).toBeNull()
  })

  it('shows an unavailable conversation model selection explicitly', async () => {
    const conversation: AssistantConversation = {
      ...testConversation,
      modelOverride: { provider: 'retired', model: 'old-model' },
    }
    const props = {
      t: tZh,
      sessionId: testConversation.rootSessionId,
      loadConversation: async () => conversation,
      loadProfile: async () => testProfile,
      loadModels: async () => [{ id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' }],
      onSetModelOverride: vi.fn(),
    } as AssistantConversationHeaderProps
    render(<AssistantConversationHeader {...props} />)

    expect(await screen.findByText('文案助手')).toBeTruthy()
    fireEvent.click(screen.getByText(zh.details))
    const select = screen.getByRole('combobox')
    expect(select.textContent).toContain('retired / old-model')
    expect(select.textContent).toContain(zh.modelUnavailable)
  })
})

describe('AssistantExampleChips', () => {
  it('returns null when the session has no assistant profile', async () => {
    const loadProfile = vi.fn(async () => undefined)
    const props = {
      t: tZh,
      loadProfile,
      input: {
        draft: '',
      },
    } as AssistantExampleChipsProps
    const { container } = render(<AssistantExampleChips {...props} />)
    expect(container.firstChild).toBeNull()
    await waitFor(() => {
      expect(loadProfile).toHaveBeenCalled()
    })
    expect(container.firstChild).toBeNull()
  })

  it('returns null when draft text is non-empty', async () => {
    const loadProfile = vi.fn(async () => testProfile)
    const props = {
      t: tZh,
      loadProfile,
      input: {
        draft: 'User is already typing something',
      },
    } as AssistantExampleChipsProps
    const { container } = render(<AssistantExampleChips {...props} />)
    await waitFor(() => {
      expect(loadProfile).toHaveBeenCalled()
    })
    expect(container.firstChild).toBeNull()
  })

  it('renders up to 3 role-specific chips when draft is empty and inserts text on click without submitting', async () => {
    const captureInsertion = vi.fn().mockReturnValue({ start: 0, end: 0, draftRev: 1 })
    const insertText = vi.fn().mockReturnValue(true)
    const submit = vi.fn()

    const props = {
      t: tZh,
      loadProfile: async () => testProfile,
      input: {
        draft: '',
        actions: {
          captureInsertion,
          insertText,
          submit,
        },
      },
    } as AssistantExampleChipsProps
    render(<AssistantExampleChips {...props} />)

    const buttons = await screen.findAllByRole('button')
    expect(buttons.length).toBeLessThanOrEqual(3)
    expect(buttons.length).toBeGreaterThan(0)

    // Click first chip
    fireEvent.click(buttons[0]!)
    expect(captureInsertion).toHaveBeenCalled()
    expect(insertText).toHaveBeenCalledWith(
      expect.stringContaining('文案助手'),
      { start: 0, end: 0, draftRev: 1 },
    )
    expect(submit).not.toHaveBeenCalled()
  })

  it('renders provided example chips when specified and caps at 3', async () => {
    const captureInsertion = vi.fn().mockReturnValue({ start: 0, end: 0, draftRev: 1 })
    const insertText = vi.fn().mockReturnValue(true)

    const customExamples = ['提示1', '提示2', '提示3', '提示4（应被截断）']
    const props = {
      t: tZh,
      loadProfile: async () => testProfile,
      examples: customExamples,
      input: {
        draft: '   ', // whitespace only should be treated as empty
        actions: {
          captureInsertion,
          insertText,
        },
      },
    } as AssistantExampleChipsProps
    render(<AssistantExampleChips {...props} />)

    expect(await screen.findByText('提示1')).toBeTruthy()
    expect(screen.getByText('提示2')).toBeTruthy()
    expect(screen.getByText('提示3')).toBeTruthy()
    expect(screen.queryByText('提示4（应被截断）')).toBeNull()

    fireEvent.click(screen.getByText('提示2'))
    expect(insertText).toHaveBeenCalledWith('提示2', { start: 0, end: 0, draftRev: 1 })
  })
})

describe('AssistantsPanelIcon', () => {
  it('renders icon with specified size', () => {
    const { container } = render(<AssistantsPanelIcon {...({ size: 18, active: false } as PropsRuntime<'sidebar.panellist'>)} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })
})

describe('mount and slot registrations', () => {
  it('registers all 5 persistent assistant slots into Context', async () => {
    const ctx = new Context()

    const registeredSlots: string[] = []
    const registeredIds: Record<string, string> = {}

    // Mock slots and locale services on ctx
    ctx.slots = {
      inject: vi.fn((name: string, callback: () => unknown) => {
        registeredSlots.push(name)
        callback()
      }),
      register: vi.fn((opts: { name: string; id?: string; key?: string }) => {
        registeredIds[opts.name] = opts.id ?? opts.key ?? ''
        return () => {}
      }),
    } as never

    ctx.locale = {
      register: vi.fn(),
      bind: vi.fn(() => tZh),
    } as never

    const cleanupFn = await mountAssistantsUi(ctx)
    expect(registeredSlots).toContain('sidebar.panellist')
    expect(registeredSlots).toContain('main')
    expect(registeredSlots).toContain('conversation.hero.agentTeam.card')
    expect(registeredSlots).toContain('conversation.session.header.actions')
    expect(registeredSlots).toContain('conversation.input.dock')

    expect(registeredIds['sidebar.panellist']).toBe(PANEL_ID)
    expect(registeredIds['main']).toBe(PANEL_ID)

    await cleanupFn()
  })
})
