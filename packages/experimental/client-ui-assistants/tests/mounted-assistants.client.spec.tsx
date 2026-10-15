// @vitest-environment jsdom
/**
 * Mounted-UI integration: the registered renderer over the real SlotCore.
 * These properties assert the reactivity contract the cached inject faces
 * must satisfy — component-owned fetch state, real template/seat/profile
 * operations, and the served model catalog.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import type { SessionBinding, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSlotRenderer } from '@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx'
import type { PropsRenderSlots, SlotScopeAdapter, ScopedStandardSourceBinding } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  AssistantConversationId,
  AssistantProfileId,
  MemoryEntryId,
  TeamDefinitionId,
  TeamSeatId,
  type AssistantConversation,
  type AssistantProfile,
  type MemoryEntry,
  type TeamDefinition,
  type TeamSeat,
  type UpdateAssistantProfileOptions,
} from '@deepseek-ai/dsh-experimental-assistant-registry'
import { mountAssistantsUi, PANEL_ID, type AssistantClientOps } from '../src/client/mount.ts'
import { zh } from '../src/client/locales.ts'

const SESSION = 'session-assistants-1' as SessionId

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
  rootSessionId: SESSION,
  createdAt: 2000,
  updatedAt: 2000,
}

const testTeam: TeamDefinition = {
  id: TeamDefinitionId('team-doc-1'),
  name: '文书处理专项团队',
  description: '负责机构重要公文与文书编撰',
  coordinatorProfileId: testProfile.id,
  templateOrigin: 'document',
  seatIds: [TeamSeatId('seat-drafter'), TeamSeatId('seat-reviewer')],
  revision: 3,
  createdAt: 2000,
  updatedAt: 2000,
}

const testSeats: readonly TeamSeat[] = [
  {
    id: TeamSeatId('seat-drafter'),
    teamId: testTeam.id,
    profileId: testProfile.id,
    role: 'teammate',
    name: 'drafter',
    duty: '撰写起草文稿',
    title: '文书撰写员',
    runtimeInstances: [],
    createdAt: 2000,
    updatedAt: 2000,
  },
  {
    id: TeamSeatId('seat-reviewer'),
    teamId: testTeam.id,
    profileId: testProfile.id,
    role: 'teammate',
    name: 'reviewer',
    duty: '审核校验事实与文字',
    title: '文书审核员',
    runtimeInstances: [],
    createdAt: 2000,
    updatedAt: 2000,
  },
]

const testModels = [
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek' },
]

const catalog: ModelCatalog = {
  default: { provider: 'deepseek', model: 'deepseek-chat' },
  routableProviders: ['deepseek'],
  groups: [{
    id: 'deepseek',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
    ],
  }],
  failures: [],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

const contexts: Context[] = []

afterEach(async () => {
  cleanup()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

type FrameSlots = PropsRenderSlots<
  | 'main'
  | 'sidebar.panellist'
  | 'conversation.hero.agentTeam.card'
  | 'conversation.session.header.actions'
  | 'conversation.input.dock'
>

/**
 * Mount the assistants UI into a real slot registry and render the root frame
 * with the directory and the bound session header.
 * @param ops - assistant operation doubles.
 * @param remote - optional Client remote namespaces (the model catalog path).
 * @returns the rendered view and its slot registry.
 */
async function mountBench(
  ops: AssistantClientOps,
  remote?: {
    session?: { modelCatalog: () => Promise<{ ok: true; value: ModelCatalog }> }
    assistants?: { listTeams: (includeArchived: boolean) => Promise<{ ok: true; value: readonly TeamDefinition[] }> }
  },
) {
  const ctx = new Context()
  contexts.push(ctx)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  if (remote !== undefined) ctx.provide('remote', {
    ...remote,
    assistants: remote.assistants ? {
      getConversationBySession: async () => ({ ok: true, value: undefined }),
      getTeamActivity: async () => ({ ok: true, value: undefined }),
      ...remote.assistants,
    } : undefined,
  })

  const slots = new SlotRegistry(ctx)
  slots.installLocale(locale)
  slots.install(createSlotRenderer())

  const binding: ScopedStandardSourceBinding = {
    key: SESSION,
    ctx,
    hooks: {},
    keyedHooks: {},
    props: {},
  }
  const source = {
    getSnapshot: () => binding,
    subscribe: () => () => {},
  }
  const adapter: SlotScopeAdapter = {
    current: source,
    bindingSource: () => source,
    renderArea: (current, props) => current.key === undefined ? (props.empty?.() ?? null) : props.children,
  }
  slots.installScope('session', adapter)

  const reference: SessionReference = {
    sessionId: SESSION,
    binding: { sessionId: SESSION, ctx } as SessionBinding,
    ready: Promise.resolve({ sessionId: SESSION, ctx } as SessionBinding),
    release: () => {},
    [Symbol.dispose]: () => {},
  }

  slots.register({
    name: 'root',
    children: {
      'main': { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'conversation.hero.agentTeam.card': { kind: 'list', scope: 'root' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
    },
  }, ({ renderSlot, SessionProvider }: FrameSlots) => (
    <>
      <div data-testid="directory">{renderSlot('main', {}, { entryKey: PANEL_ID })}</div>
      <SessionProvider session={reference}>
        {renderSlot('conversation.session.header.actions', {})}
      </SessionProvider>
    </>
  ))

  await mountAssistantsUi(ctx, ops)
  const view = render(<>{slots.renderSlot('root', {})}</>)
  return { ctx, slots, view }
}

describe('mounted assistants UI reactivity', () => {
  it('loads archived teams explicitly so management can delete them', async () => {
    const listTeams = vi.fn(async (includeArchived: boolean) => {
      if (includeArchived === undefined) throw new Error('assistants/listTeams expected 1 argument(s), got 0')
      return { ok: true as const, value: [] }
    })
    await mountBench({ listProfiles: async () => [testProfile], getAvailableModels: async () => [] },
      { assistants: { listTeams } })
    expect(await screen.findByText(testProfile.name)).toBeTruthy()
    expect(listTeams).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the create draft and reports unavailable mutation capability', async () => {
    await mountBench({ listProfiles: async () => [], listTeams: async () => [], getAvailableModels: async () => [] })
    fireEvent.click(screen.getByText(zh.newAssistant))
    fireEvent.change(screen.getByLabelText(zh.name), { target: { value: 'Keep unavailable draft' } })
    fireEvent.click(screen.getByText(zh.save))
    expect((await screen.findByRole('alert')).textContent).toContain(zh.operationFailed)
    expect((screen.getByLabelText(zh.name) as HTMLInputElement).value).toBe('Keep unavailable draft')
  })

  it('fills a cold-mounted directory after the profile loader resolves', async () => {
    const profiles = deferred<readonly AssistantProfile[]>()
    await mountBench({
      listProfiles: () => profiles.promise,
      listTeams: async () => [],
      listSeats: async () => [],
      getAvailableModels: async () => [],
    })

    expect(screen.getByText(zh.loadingProfiles)).toBeTruthy()
    expect(screen.queryByText(testProfile.name)).toBeNull()

    await act(async () => { profiles.resolve([testProfile]) })

    expect(screen.getByText(testProfile.name)).toBeTruthy()
    expect(screen.queryByText(zh.empty)).toBeNull()
  })

  it('fills a bound session header after the conversation loader resolves', async () => {
    const conversations = deferred<AssistantConversation | undefined>()
    const getProfile = vi.fn(async () => testProfile)
    const getConversationBySession = vi.fn(() => conversations.promise)
    await mountBench({
      listProfiles: async () => [],
      listTeams: async () => [],
      listSeats: async () => [],
      getConversationBySession,
      getProfile,
    })

    expect(screen.queryByText(testProfile.name)).toBeNull()

    await act(async () => { conversations.resolve(testConversation) })

    expect(screen.getByText(testProfile.name)).toBeTruthy()
    expect(getConversationBySession).toHaveBeenCalledWith(SESSION)
    expect(getProfile).toHaveBeenCalledWith(testProfile.id)
  })

  it('shows a profile created from the form without remounting', async () => {
    const created: AssistantProfile[] = []
    const createProfile = vi.fn(async (options: { name: string; responsibility: string }) => {
      const profile: AssistantProfile = {
        ...testProfile,
        id: AssistantProfileId('asst-created'),
        name: options.name,
        responsibility: options.responsibility,
      }
      created.push(profile)
      return profile
    })
    await mountBench({
      listProfiles: async () => [...created],
      createProfile,
      listTeams: async () => [],
      listSeats: async () => [],
      getAvailableModels: async () => [],
    })

    expect(await screen.findByText(zh.empty)).toBeTruthy()
    fireEvent.click(screen.getByText(zh.newAssistant))
    fireEvent.change(screen.getByLabelText(zh.name), { target: { value: '新助手' } })
    fireEvent.change(screen.getByLabelText(zh.responsibility), { target: { value: '新职责' } })
    fireEvent.click(screen.getByText(zh.save))

    expect(await screen.findByText('新助手')).toBeTruthy()
    expect(screen.queryByText(zh.empty)).toBeNull()
    expect(createProfile).toHaveBeenCalledWith({
      name: '新助手',
      responsibility: '新职责',
      instructions: undefined,
    })
  })
})

describe('mounted assistants operations', () => {
  it('creates all teams through templates including a coordinator for blank teams', async () => {
    const createTeamFromTemplate = vi.fn(async () => ({ team: testTeam, seats: testSeats }))
    const createTeam = vi.fn(async () => testTeam)
    await mountBench({
      listProfiles: async () => [testProfile],
      listTeams: async () => [],
      listSeats: async () => [],
      getAvailableModels: async () => testModels,
      createTeamFromTemplate,
      createTeam,
    })

    await screen.findByText(testProfile.name)
    fireEvent.click(screen.getByText(zh.newTeam))
    fireEvent.click(screen.getByTestId('template-document'))
    fireEvent.change(screen.getByTestId('team-name-input'), { target: { value: '文书小队' } })
    fireEvent.click(screen.getByTestId('create-team-submit'))

    await vi.waitFor(() => {
      expect(createTeamFromTemplate).toHaveBeenCalledWith('document', {
        coordinatorProfileId: testProfile.id,
        name: '文书小队',
      })
    })
    expect(createTeam).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(screen.queryByTestId('team-name-input')).toBeNull()
    })

    fireEvent.click(screen.getByText(zh.newTeam))
    fireEvent.click(screen.getByTestId('template-blank'))
    fireEvent.change(screen.getByTestId('team-name-input'), { target: { value: '空白小队' } })
    fireEvent.click(screen.getByTestId('create-team-submit'))

    await vi.waitFor(() => {
      expect(createTeamFromTemplate).toHaveBeenCalledWith('blank', {
        name: '空白小队',
        coordinatorProfileId: testProfile.id,
      })
    })
    expect(createTeamFromTemplate).toHaveBeenCalledTimes(2)
    expect(createTeam).not.toHaveBeenCalled()
  })

  it('applies seat duty and model edits through updateSeat with the served provider', async () => {
    const updateSeat = vi.fn(async () => testSeats[0]!)
    const updateTeam = vi.fn(async () => testTeam)
    await mountBench({
      listProfiles: async () => [testProfile],
      listTeams: async () => [testTeam],
      listSeats: async () => testSeats,
      getAvailableModels: async () => testModels,
      updateSeat,
      updateTeam,
    })

    await screen.findByText(testProfile.name)
    // The profile card renders first; the team card owns the second details action.
    fireEvent.click(screen.getAllByText(zh.details)[1]!)
    fireEvent.click(screen.getByTestId('edit-team-button'))
    fireEvent.change(screen.getByTestId('edit-team-name-input'), { target: { value: '改名团队' } })
    fireEvent.change(screen.getByTestId('seat-duty-input-drafter'), { target: { value: '起草与润色' } })
    fireEvent.change(screen.getByTestId('seat-model-select-drafter'), { target: { value: 'deepseek:deepseek-reasoner' } })
    fireEvent.click(screen.getByTestId('edit-team-save'))

    await vi.waitFor(() => {
      expect(updateSeat).toHaveBeenCalledWith(TeamSeatId('seat-drafter'), {
        duty: '起草与润色',
        modelOverride: { provider: 'deepseek', model: 'deepseek-reasoner' },
      })
    })
    expect(updateSeat).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => {
      expect(updateTeam).toHaveBeenCalledWith(testTeam.id, testTeam.revision, { name: '改名团队' })
    })
  })

  it('serves the model picker from the session-controller catalog when no override is provided', async () => {
    await mountBench(
      {
        listProfiles: async () => [testProfile],
        listTeams: async () => [testTeam],
        listSeats: async () => testSeats,
      },
      { session: { modelCatalog: async () => ({ ok: true, value: catalog }) } },
    )

    await screen.findByText(testProfile.name)
    fireEvent.click(screen.getAllByText(zh.details)[1]!)
    fireEvent.click(screen.getByTestId('edit-team-button'))

    const select = screen.getByTestId('seat-model-select-drafter')
    expect(select.textContent).toContain('deepseek / DeepSeek Chat')
    expect(select.textContent).toContain('deepseek / DeepSeek Reasoner')
  })

  it('opens the profile drawer from details and saves the profile default model', async () => {
    const updateProfile = vi.fn(async (
      _id: AssistantProfileId,
      options: UpdateAssistantProfileOptions,
    ): Promise<AssistantProfile> => ({
      ...testProfile,
      ...options.defaultModel === undefined ? {} : { defaultModel: options.defaultModel },
    }))
    await mountBench({
      listProfiles: async () => [testProfile],
      listTeams: async () => [],
      listSeats: async () => [],
      getAvailableModels: async () => testModels,
      updateProfile,
    })

    fireEvent.click(await screen.findByText(zh.details))
    expect(screen.getByText(zh.drawerTitle)).toBeTruthy()
    expect(screen.getAllByText(testProfile.responsibility).length).toBeGreaterThan(0)

    fireEvent.change(screen.getByTestId('profile-model-select'), { target: { value: 'deepseek:deepseek-reasoner' } })

    await vi.waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith(testProfile.id, {
        defaultModel: { provider: 'deepseek', model: 'deepseek-reasoner' },
      })
    })
  })

  it('mounts MemoryPanel in profile detail drawer and team view memory tab through real slot renderer', async () => {
    const memoryEntry: MemoryEntry = {
      id: MemoryEntryId('mem-1'),
      scope: { kind: 'profile', profileId: testProfile.id },
      text: '助手专属记忆片段',
      revision: 1,
      createdAt: 1000,
      updatedAt: 1000,
    }
    const teamMemoryEntry: MemoryEntry = {
      id: MemoryEntryId('mem-team-1'),
      scope: { kind: 'team', teamId: testTeam.id },
      text: '团队共享记忆片段',
      revision: 1,
      createdAt: 1000,
      updatedAt: 1000,
    }
    const saveMemory = vi.fn(async (scope, text) => ({
      id: MemoryEntryId('mem-new'),
      scope,
      text,
      revision: 1,
      createdAt: 2000,
      updatedAt: 2000,
    }))

    await mountBench({
      listProfiles: async () => [testProfile],
      listTeams: async () => [testTeam],
      listSeats: async () => testSeats,
      getAvailableModels: async () => testModels,
      listMemory: async (scope) => {
        if (scope.kind === 'profile') return [memoryEntry]
        if (scope.kind === 'team') return [teamMemoryEntry]
        return []
      },
      saveMemory,
    })

    // 1. Profile drawer test
    fireEvent.click((await screen.findAllByText(zh.details))[0]!)
    expect(await screen.findByText('助手专属记忆片段')).toBeTruthy()
    expect(screen.getByTestId('memory-panel')).toBeTruthy()

    // Add new memory in profile drawer
    const input = screen.getByPlaceholderText(zh.memoryPlaceholder)
    fireEvent.change(input, { target: { value: '新加的个人记忆' } })
    fireEvent.click(screen.getByText(zh.addMemory))
    await vi.waitFor(() => {
      expect(saveMemory).toHaveBeenCalledWith({ kind: 'profile', profileId: testProfile.id }, '新加的个人记忆')
    })

    // Close drawer
    fireEvent.click(screen.getByText('✕'))

    // 2. Team view test
    fireEvent.click((await screen.findAllByText(zh.details))[1]!)
    expect(screen.getByTestId('tab-memory')).toBeTruthy()
    fireEvent.click(screen.getByTestId('tab-memory'))
    expect(await screen.findByText('团队共享记忆片段')).toBeTruthy()
  })
})


describe('Mounted management deletion', () => {
  it('confirms a team deletion through mounted operations and refreshes the team list', async () => {
    let teams: readonly TeamDefinition[] = [testTeam]
    const remove = vi.fn(async () => { teams = [] })
    await mountBench({ listProfiles: async () => [testProfile], listTeams: async () => teams,
      listSeats: async () => testSeats, getAvailableModels: async () => [], deleteTeam: remove })
    fireEvent.click(await screen.findByTestId(`delete-team-${testTeam.id}`))
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('confirm-entity-delete'))
    await vi.waitFor(() => { expect(remove).toHaveBeenCalledExactlyOnceWith(testTeam.id, testTeam.revision) })
    await vi.waitFor(() => { expect(screen.queryByTestId(`delete-team-${testTeam.id}`)).toBeNull() })
  })
})
