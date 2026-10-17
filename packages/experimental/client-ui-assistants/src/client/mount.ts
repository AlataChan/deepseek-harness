import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ModelCatalog, ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult, TypertRemoteContribution, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AssistantConversation,
  AssistantConversationId,
  AssistantModelSelection,
  AssistantProfile,
  AssistantProfileId,
  CreateAssistantConversationOptions,
  CreateAssistantProfileOptions,
  CreateTeamDefinitionOptions,
  ListMemoryOptions,
  MemoryEntry,
  MemoryEntryId,
  MemoryScope,
  SaveMemoryOptions,
  TeamDefinition,
  TeamDefinitionId,
  TeamSeat,
  TeamSeatId,
  TeamTemplateOrigin,
  UpdateAssistantProfileOptions,
  UpdateTeamDefinitionOptions,
  UpdateTeamSeatOptions,
  ComposerPredictionRequest,
  ComposerPredictionContext,
  ComposerPredictionResult,
} from '@deepseek-ai/dsh-experimental-assistant-registry/types'
import { AssistantsPanelIcon } from './AssistantsPanelIcon.tsx'
import { AssistantConversationLauncher } from './conversation-launch.ts'
import { AssistantWorkspaceDialog } from './AssistantWorkspaceDialog.tsx'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { AssistantActionToast, type AssistantActionNotice } from './AssistantActionToast.tsx'
import { AssistantDirectory, type AssistantDirectoryInjected } from './AssistantDirectory.tsx'
import { AssistantComposerSelector, AssistantHeroSelector, type AssistantComposerSelectorInjected } from './AssistantComposerSelector.tsx'
import { createSelectorPreference, SELECTOR_PREFERENCE_KEY } from './selector-preference.ts'
import { AssistantConversationHeader, type AssistantConversationHeaderInjected } from './AssistantConversationHeader.tsx'
import { AssistantExampleChips, type AssistantExampleChipsInjected } from './AssistantExampleChips.tsx'
import { AssistantPredictionDock, type AssistantPredictionDockInjected } from './ComposerPrediction.tsx'
import type { TeamDiscussionOps } from './TeamDiscussion.tsx'
import type { StandingTeamLiveView } from './StandingTeamDock.tsx'
import type { AssistantModelOption } from './models.ts'
import type { CreateTeamPayload } from './TeamCreationModal.tsx'
import type { SaveTeamUpdatesPayload, TeamSeatUpdatePatch } from './TeamEditorModal.tsx'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-agent-team/client'
import { PredictionSettingPreference, type PredictionSettings } from './prediction-preference.ts'
import { PredictionSettingRow, PredictionSettingToast, type PredictionSettingInjected } from './PredictionSettingRow.tsx'
import { en, NS, zh, type AssistantLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    assistants: AssistantLocaleKey
  }
}

/** Panel identifier brand for the assistants directory. */
export const PANEL_ID = 'assistants' as MainPanelId

/** Services required for assistant UI registration. */
export const inject = ['remote', 'remote.session', 'sessions', 'workspaces', 'slots', 'locale', 'layout', 'uiWorkspace']

/** Saved-team templates, including a blank team with one coordinator seat. */
export type TeamTemplateId = TeamTemplateOrigin

/** Instantiation options for one preset team template. */
export interface CreateTeamFromTemplateOptions {
  readonly coordinatorProfileId: AssistantProfileId
  readonly avatar?: string
  readonly name?: string
  readonly description?: string
  readonly sharedWorkspaceId?: string
}

/** Created team definition and its initialized seats. */
export interface TeamFromTemplateResult {
  readonly team: TeamDefinition
  readonly seats: readonly TeamSeat[]
}

/** Seat patch carried over JSON, where null explicitly clears an override. */
export type AssistantSeatWirePatch = Omit<UpdateTeamSeatOptions, 'modelOverride'> & {
  readonly modelOverride?: AssistantModelSelection | null | undefined
}

/** Discussion capabilities supported by optional Host compositions. */
type OptionalDiscussionOps = {
  readonly [K in keyof TeamDiscussionOps]?: TeamDiscussionOps[K] | undefined
}

/** Operations required by assistant surfaces, with optional capabilities checked before mutation. */
export interface AssistantClientOps extends OptionalDiscussionOps {
  listProfiles?: ((includeArchived?: boolean) => Promise<readonly AssistantProfile[]>) | undefined
  createProfile?: ((options: CreateAssistantProfileOptions) => Promise<AssistantProfile>) | undefined
  updateProfile?: ((id: AssistantProfileId, options: UpdateAssistantProfileOptions) => Promise<AssistantProfile>) | undefined
  deleteProfile?: ((id: AssistantProfileId, revision: number) => Promise<void>) | undefined
  deleteTeam?: ((id: TeamDefinitionId, revision: number) => Promise<void>) | undefined
  clearConversationBinding?: ((sessionId: SessionId) => Promise<void>) | undefined
  archiveProfile?: ((id: AssistantProfileId) => Promise<void>) | undefined
  unarchiveProfile?: ((id: AssistantProfileId) => Promise<void>) | undefined
  listConversations?: ((profileId?: AssistantProfileId) => Promise<readonly AssistantConversation[]>) | undefined
  createConversation?:
    ((profileId: AssistantProfileId, options?: CreateAssistantConversationOptions) => Promise<AssistantConversation>) | undefined
  startNewTopic?:
    ((profileId: AssistantProfileId, options?: CreateAssistantConversationOptions) => Promise<AssistantConversation>) | undefined
  getConversationBySession?: ((sessionId: SessionId) => Promise<AssistantConversation | undefined>) | undefined
  setConversationModelOverride?:
    ((id: AssistantConversationId, model?: AssistantModelSelection) => Promise<AssistantConversation>) | undefined
  clearConversationModelOverride?: ((id: AssistantConversationId) => Promise<AssistantConversation>) | undefined
  getProfile?: ((id: AssistantProfileId) => Promise<AssistantProfile | undefined>) | undefined
  getAvailableModels?: (() => Promise<readonly AssistantModelOption[]>) | undefined
  listTeams?: ((includeArchived?: boolean) => Promise<readonly TeamDefinition[]>) | undefined
  getTeamBySession?: ((sessionId: SessionId) => Promise<TeamDefinition | undefined>) | undefined
  getTeam?: ((id: TeamDefinitionId) => Promise<TeamDefinition | undefined>) | undefined
  createTeam?: ((options: CreateTeamDefinitionOptions) => Promise<TeamDefinition>) | undefined
  createTeamFromTemplate?:
    ((templateId: TeamTemplateId, options: CreateTeamFromTemplateOptions) => Promise<TeamFromTemplateResult>) | undefined
  updateTeam?:
    ((id: TeamDefinitionId, expectedRevision: number, options: UpdateTeamDefinitionOptions) => Promise<TeamDefinition>) | undefined
  archiveTeam?: ((id: TeamDefinitionId) => Promise<TeamDefinition>) | undefined
  getTeamActivity?: ((teamId: TeamDefinitionId) => Promise<StandingTeamLiveView | undefined>) | undefined
  listSeats?: ((teamId: TeamDefinitionId) => Promise<readonly TeamSeat[]>) | undefined
  updateSeat?: ((seatId: TeamSeatId, options: AssistantSeatWirePatch) => Promise<TeamSeat>) | undefined
  listMemory?: ((scope: MemoryScope, options?: ListMemoryOptions) => Promise<readonly MemoryEntry[]>) | undefined
  saveMemory?: ((scope: MemoryScope, text: string, options?: SaveMemoryOptions) => Promise<MemoryEntry>) | undefined
  updateMemory?: ((id: MemoryEntryId, expectedRevision: number, text: string) => Promise<MemoryEntry>) | undefined
  removeMemory?: ((id: MemoryEntryId, expectedRevision?: number) => Promise<MemoryEntry>) | undefined
  archiveMemory?: ((id: MemoryEntryId, expectedRevision?: number) => Promise<MemoryEntry>) | undefined
  unarchiveMemory?: ((id: MemoryEntryId, expectedRevision?: number) => Promise<MemoryEntry>) | undefined
  grantMemory?: ((id: MemoryEntryId, teamId: TeamDefinitionId, expectedRevision?: number) => Promise<MemoryEntry>) | undefined
  revokeMemoryGrant?: ((id: MemoryEntryId, teamId: TeamDefinitionId, expectedRevision?: number) => Promise<MemoryEntry>) | undefined
  promoteTeamMemoryToProfile?:
    ((teamMemoryId: MemoryEntryId, targetProfileId: AssistantProfileId, authorized: boolean) => Promise<MemoryEntry>) | undefined
  promoteMemory?: ((id: MemoryEntryId, targetProfileId: AssistantProfileId) => Promise<void>) | undefined
  predictComposer?: ((request: ComposerPredictionRequest, signal?: AbortSignal) => Promise<ComposerPredictionResult | null>) | undefined
  getComposerContext?: ((sessionId: SessionId) => Promise<ComposerPredictionContext | null>) | undefined
}

type DiscussionRemoteMethods = {
  readonly [K in keyof TeamDiscussionOps]: (
    ...args: Parameters<TeamDiscussionOps[K]>
  ) => Promise<RemoteResult<Awaited<ReturnType<TeamDiscussionOps[K]>>>>
}

interface AssistantRemoteMethods extends DiscussionRemoteMethods {
  listProfiles: (includeArchived?: boolean) => Promise<RemoteResult<readonly AssistantProfile[]>>
  createProfile: (options: CreateAssistantProfileOptions) => Promise<RemoteResult<AssistantProfile>>
  updateProfile: (
    id: AssistantProfileId,
    options: UpdateAssistantProfileOptions,
    expectedRevision?: number,
  ) => Promise<RemoteResult<AssistantProfile>>
  deleteProfile: (id: AssistantProfileId, revision: number) => Promise<RemoteResult<void>>
  deleteTeam: (id: TeamDefinitionId, revision: number) => Promise<RemoteResult<void>>
  clearConversationBinding: (sessionId: SessionId) => Promise<RemoteResult<void>>
  archiveProfile: (id: AssistantProfileId) => Promise<RemoteResult<void>>
  unarchiveProfile: (id: AssistantProfileId) => Promise<RemoteResult<void>>
  listConversations: (profileId?: AssistantProfileId, includeArchived?: boolean) => Promise<RemoteResult<readonly AssistantConversation[]>>
  createConversation: (
    profileId: AssistantProfileId,
    options?: CreateAssistantConversationOptions,
  ) => Promise<RemoteResult<AssistantConversation>>
  startNewTopic: (
    profileId: AssistantProfileId,
    options?: CreateAssistantConversationOptions,
  ) => Promise<RemoteResult<AssistantConversation>>
  getConversationBySession: (sessionId: SessionId) => Promise<RemoteResult<AssistantConversation | undefined>>
  setConversationModelOverride: (
    id: AssistantConversationId,
    model?: AssistantModelSelection,
  ) => Promise<RemoteResult<AssistantConversation>>
  clearConversationModelOverride: (id: AssistantConversationId) => Promise<RemoteResult<AssistantConversation>>
  getProfile: (id: AssistantProfileId) => Promise<RemoteResult<AssistantProfile | undefined>>
  listTeams: (includeArchived: boolean) => Promise<RemoteResult<readonly TeamDefinition[]>>
  getTeamBySession: (sessionId: SessionId) => Promise<RemoteResult<TeamDefinition | undefined>>
  getTeam: (id: TeamDefinitionId) => Promise<RemoteResult<TeamDefinition | undefined>>
  createTeam: (options: CreateTeamDefinitionOptions) => Promise<RemoteResult<TeamDefinition>>
  createTeamFromTemplate: (
    templateId: TeamTemplateId,
    options: CreateTeamFromTemplateOptions,
  ) => Promise<RemoteResult<TeamFromTemplateResult>>
  updateTeam: (
    id: TeamDefinitionId,
    expectedRevision: number,
    options: UpdateTeamDefinitionOptions,
  ) => Promise<RemoteResult<TeamDefinition>>
  archiveTeam: (id: TeamDefinitionId) => Promise<RemoteResult<TeamDefinition>>
  getTeamActivity: (teamId: TeamDefinitionId) => Promise<RemoteResult<StandingTeamLiveView | undefined>>
  listSeats: (teamId: TeamDefinitionId) => Promise<RemoteResult<readonly TeamSeat[]>>
  updateSeat: (seatId: TeamSeatId, options: AssistantSeatWirePatch) => Promise<RemoteResult<TeamSeat>>
  listMemory: (scope: MemoryScope, options?: ListMemoryOptions) => Promise<RemoteResult<readonly MemoryEntry[]>>
  saveMemory: (scope: MemoryScope, text: string, options?: SaveMemoryOptions) => Promise<RemoteResult<MemoryEntry>>
  updateMemory: (id: MemoryEntryId, expectedRevision: number, text: string) => Promise<RemoteResult<MemoryEntry>>
  removeMemory: (id: MemoryEntryId, expectedRevision?: number) => Promise<RemoteResult<MemoryEntry>>
  archiveMemory: (id: MemoryEntryId, expectedRevision?: number) => Promise<RemoteResult<MemoryEntry>>
  unarchiveMemory: (id: MemoryEntryId, expectedRevision?: number) => Promise<RemoteResult<MemoryEntry>>
  grantMemory: (id: MemoryEntryId, teamId: TeamDefinitionId, expectedRevision?: number) => Promise<RemoteResult<MemoryEntry>>
  revokeMemoryGrant: (id: MemoryEntryId, teamId: TeamDefinitionId, expectedRevision?: number) => Promise<RemoteResult<MemoryEntry>>
  promoteTeamMemoryToProfile: (
    teamMemoryId: MemoryEntryId,
    targetProfileId: AssistantProfileId,
    authorized: boolean,
  ) => Promise<RemoteResult<MemoryEntry>>
  predictComposer: (request: ComposerPredictionRequest, signal?: AbortSignal) => Promise<RemoteResult<ComposerPredictionResult | null>>
  streamComposerPrediction: (request: ComposerPredictionRequest, signal?: AbortSignal) => AsyncIterable<ComposerPredictionResult | null>
  getComposerContext: (sessionId: SessionId) => Promise<RemoteResult<ComposerPredictionContext | null>>
}

function unwrapRemote<T>(result: RemoteResult<T>): T {
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.value
}

/**
 * Flatten the served session-controller catalog into picker options.
 * @param catalog - Host model catalog.
 * @returns one option per catalog model, carrying its provider id.
 */
function modelOptions(catalog: ModelCatalog): AssistantModelOption[] {
  return catalog.groups.flatMap(group => group.models.map(model => ({ id: model.id, name: model.name, provider: group.id })))
}

/**
 * Register Persistent Assistants UI slots into the client Context.
 *
 * The registered inject faces carry only stable loaders and action callbacks:
 * the renderer caches injection results per registration (root) and per
 * session binding (session scope), so live data lives in component state fed
 * by the loaders instead of in the inject result.
 *
 * @param ctx - browser client context.
 * @param ops - optional assistant operations override.
 */
export function registerUi(ctx: ClientContext, ops?: AssistantClientOps): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-assistants: dictionaries')
  const t = ctx.locale.bind(NS)

  const remoteClient = (ctx as { remote?: TypertRemoteNamespaceMap }).remote
  const remote = remoteClient?.assistants as AssistantRemoteMethods | undefined
  const sessionRemote = remoteClient?.session
  // `assistants.updateSeat` is the Host seat-update Remote; it is declared on
  // the client side until the generated namespace carries it.
  const updateSeatRemote = remote?.updateSeat
  const activeOps: AssistantClientOps = {
    listDiscussions:
      ops?.listDiscussions ??
      (remote?.listDiscussions
        ? async (...args: Parameters<TeamDiscussionOps['listDiscussions']>) => unwrapRemote(await remote.listDiscussions(...args))
        : undefined),
    createDiscussion:
      ops?.createDiscussion ??
      (remote?.createDiscussion
        ? async (...args: Parameters<TeamDiscussionOps['createDiscussion']>) => unwrapRemote(await remote.createDiscussion(...args))
        : undefined),
    provisionTeam:
      ops?.provisionTeam ??
      (remote?.provisionTeam
        ? async (...args: Parameters<TeamDiscussionOps['provisionTeam']>) => unwrapRemote(await remote.provisionTeam(...args))
        : undefined),
    scheduleRound:
      ops?.scheduleRound ??
      (remote?.scheduleRound
        ? async (...args: Parameters<TeamDiscussionOps['scheduleRound']>) => unwrapRemote(await remote.scheduleRound(...args))
        : undefined),
    startRound:
      ops?.startRound ??
      (remote?.startRound
        ? async (...args: Parameters<TeamDiscussionOps['startRound']>) => unwrapRemote(await remote.startRound(...args))
        : undefined),
    getRound:
      ops?.getRound ??
      (remote?.getRound
        ? async (...args: Parameters<TeamDiscussionOps['getRound']>) => unwrapRemote(await remote.getRound(...args))
        : undefined),
    cancelRound:
      ops?.cancelRound ??
      (remote?.cancelRound ? async (roundId, reason) => unwrapRemote(await remote.cancelRound(roundId, reason)) : undefined),
    queryPublicTranscript:
      ops?.queryPublicTranscript ??
      (remote?.queryPublicTranscript
        ? async (...args: Parameters<TeamDiscussionOps['queryPublicTranscript']>) =>
          unwrapRemote(await remote.queryPublicTranscript(...args))
        : undefined),
    listProfiles: ops?.listProfiles ?? (remote ? async (inc?: boolean) => unwrapRemote(await remote.listProfiles(inc)) : undefined),
    createProfile:
      ops?.createProfile ??
      (remote ? async (data: CreateAssistantProfileOptions) => unwrapRemote(await remote.createProfile(data)) : undefined),
    updateProfile:
      ops?.updateProfile ??
      (remote
        ? async (id: AssistantProfileId, data: UpdateAssistantProfileOptions) =>
          unwrapRemote(await remote.updateProfile(id, data, undefined))
        : undefined),
    deleteProfile: ops?.deleteProfile ?? (remote?.deleteProfile
      ? async (id, revision) => { unwrapRemote(await remote.deleteProfile(id, revision)) } : undefined),
    deleteTeam: ops?.deleteTeam ?? (remote?.deleteTeam
      ? async (id, revision) => { unwrapRemote(await remote.deleteTeam(id, revision)) } : undefined),
    clearConversationBinding: ops?.clearConversationBinding ?? (remote?.clearConversationBinding
      ? async (sessionId) => { unwrapRemote(await remote.clearConversationBinding(sessionId)) } : undefined),
    archiveProfile:
      ops?.archiveProfile ??
      (remote
        ? async (id: AssistantProfileId) => {
          unwrapRemote(await remote.archiveProfile(id))
        }
        : undefined),
    unarchiveProfile:
      ops?.unarchiveProfile ??
      (remote
        ? async (id: AssistantProfileId) => {
          unwrapRemote(await remote.unarchiveProfile(id))
        }
        : undefined),
    listConversations:
      ops?.listConversations ??
      (remote ? async (pid?: AssistantProfileId) => unwrapRemote(await remote.listConversations(pid, false)) : undefined),
    createConversation:
      ops?.createConversation ??
      (remote
        ? async (pid: AssistantProfileId, opt?: CreateAssistantConversationOptions) =>
          unwrapRemote(await remote.createConversation(pid, opt))
        : undefined),
    startNewTopic:
      ops?.startNewTopic ??
      (remote ? async (pid: AssistantProfileId, opt?: CreateAssistantConversationOptions) =>
        unwrapRemote(await remote.startNewTopic(pid, opt)) : undefined),
    getConversationBySession:
      ops?.getConversationBySession ??
      (remote ? async (sid: SessionId) => unwrapRemote(await remote.getConversationBySession(sid)) : undefined),
    setConversationModelOverride:
      ops?.setConversationModelOverride ??
      (remote
        ? async (id: AssistantConversationId, m?: AssistantModelSelection) => unwrapRemote(await remote.setConversationModelOverride(id, m))
        : undefined),
    clearConversationModelOverride:
      ops?.clearConversationModelOverride ??
      (remote ? async (id: AssistantConversationId) => unwrapRemote(await remote.clearConversationModelOverride(id)) : undefined),
    getProfile: ops?.getProfile ?? (remote ? async (id: AssistantProfileId) => unwrapRemote(await remote.getProfile(id)) : undefined),
    getAvailableModels:
      ops?.getAvailableModels ?? (sessionRemote ? async () => modelOptions(unwrapRemote(await sessionRemote.modelCatalog())) : undefined),
    listTeams: ops?.listTeams ?? (remote
      ? async (includeArchived?: boolean) => unwrapRemote(await remote.listTeams(includeArchived ?? false)) : undefined),
    getTeamBySession: ops?.getTeamBySession ?? (remote?.getTeamBySession
      ? async sessionId => unwrapRemote(await remote.getTeamBySession(sessionId)) : undefined),
    getTeam: ops?.getTeam ?? (remote ? async (id: TeamDefinitionId) => unwrapRemote(await remote.getTeam(id)) : undefined),
    createTeam:
      ops?.createTeam ?? (remote ? async (opt: CreateTeamDefinitionOptions) => unwrapRemote(await remote.createTeam(opt)) : undefined),
    createTeamFromTemplate:
      ops?.createTeamFromTemplate ??
      (remote
        ? async (templateId: TeamTemplateId, opt: CreateTeamFromTemplateOptions) =>
          unwrapRemote(await remote.createTeamFromTemplate(templateId, opt))
        : undefined),
    updateTeam:
      ops?.updateTeam ??
      (remote
        ? async (id: TeamDefinitionId, rev: number, opt: UpdateTeamDefinitionOptions) => unwrapRemote(await remote.updateTeam(id, rev, opt))
        : undefined),
    archiveTeam: ops?.archiveTeam ?? (remote ? async (id: TeamDefinitionId) => unwrapRemote(await remote.archiveTeam(id)) : undefined),
    getTeamActivity:
      ops?.getTeamActivity ?? (remote?.getTeamActivity ? async teamId => unwrapRemote(await remote.getTeamActivity(teamId)) : undefined),
    listSeats: ops?.listSeats ?? (remote ? async (tid: TeamDefinitionId) => unwrapRemote(await remote.listSeats(tid)) : undefined),
    updateSeat:
      ops?.updateSeat ??
      (updateSeatRemote
        ? async (seatId: TeamSeatId, opt: AssistantSeatWirePatch) => unwrapRemote(await updateSeatRemote(seatId, opt))
        : undefined),
    listMemory: ops?.listMemory ?? (remote ? async (scope, opt) => unwrapRemote(await remote.listMemory(scope, opt)) : undefined),
    saveMemory:
      ops?.saveMemory ?? (remote ? async (scope, text, opt) => unwrapRemote(await remote.saveMemory(scope, text, opt)) : undefined),
    updateMemory:
      ops?.updateMemory ?? (remote ? async (id, rev, text) => unwrapRemote(await remote.updateMemory(id, rev, text)) : undefined),
    removeMemory: ops?.removeMemory ?? (remote ? async (id, rev) => unwrapRemote(await remote.removeMemory(id, rev)) : undefined),
    archiveMemory: ops?.archiveMemory ?? (remote ? async (id, rev) => unwrapRemote(await remote.archiveMemory(id, rev)) : undefined),
    unarchiveMemory: ops?.unarchiveMemory ?? (remote ? async (id, rev) => unwrapRemote(await remote.unarchiveMemory(id, rev)) : undefined),
    grantMemory: ops?.grantMemory ?? (remote ? async (id, tid, rev) => unwrapRemote(await remote.grantMemory(id, tid, rev)) : undefined),
    revokeMemoryGrant:
      ops?.revokeMemoryGrant ?? (remote ? async (id, tid, rev) => unwrapRemote(await remote.revokeMemoryGrant(id, tid, rev)) : undefined),
    promoteTeamMemoryToProfile:
      ops?.promoteTeamMemoryToProfile ??
      (remote ? async (tmid, tpid, auth) => unwrapRemote(await remote.promoteTeamMemoryToProfile(tmid, tpid, auth)) : undefined),
    promoteMemory: ops?.promoteMemory,
    getComposerContext:
      ops?.getComposerContext ??
      (remote?.getComposerContext ? async sessionId => unwrapRemote(await remote.getComposerContext(sessionId)) : undefined),
    predictComposer:
      ops?.predictComposer ??
      (remote?.streamComposerPrediction ? async (req, signal) => {
        for await (const result of remote.streamComposerPrediction(req, signal)) return result
        return null
      } : undefined),
  }

  const discussionOps: TeamDiscussionOps | undefined =
    activeOps.listDiscussions &&
    activeOps.createDiscussion &&
    activeOps.provisionTeam &&
    activeOps.scheduleRound &&
    activeOps.startRound &&
    activeOps.getRound &&
    activeOps.cancelRound &&
    activeOps.queryPublicTranscript
      ? {
        listDiscussions: activeOps.listDiscussions,
        createDiscussion: activeOps.createDiscussion,
        provisionTeam: activeOps.provisionTeam,
        scheduleRound: activeOps.scheduleRound,
        startRound: activeOps.startRound,
        getRound: activeOps.getRound,
        cancelRound: activeOps.cancelRound,
        queryPublicTranscript: activeOps.queryPublicTranscript,
      }
      : undefined

  const catalogRevision = createSnapshotStore(0)
  const invalidateCatalog = () => { catalogRevision.set(catalogRevision.getSnapshot() + 1) }

  const loadProfiles = async (): Promise<readonly AssistantProfile[]> => (activeOps.listProfiles ? await activeOps.listProfiles(true) : [])

  const loadTeams = async (): Promise<readonly TeamDefinition[]> => (activeOps.listTeams ? await activeOps.listTeams(true) : [])

  const loadSeats = async (teamId: TeamDefinitionId): Promise<readonly TeamSeat[]> =>
    activeOps.listSeats ? await activeOps.listSeats(teamId) : []

  const loadModels = async (): Promise<readonly AssistantModelOption[]> =>
    activeOps.getAvailableModels ? await activeOps.getAvailableModels() : []

  const loadProfile = async (id: AssistantProfileId): Promise<AssistantProfile | undefined> => {
    if (activeOps.getProfile) return await activeOps.getProfile(id)
    const profiles = await loadProfiles()
    return profiles.find(profile => profile.id === id)
  }

  const loadConversation = async (sessionId: SessionId): Promise<AssistantConversation | undefined> =>
    activeOps.getConversationBySession ? await activeOps.getConversationBySession(sessionId) : undefined

  const updateProfile = async (id: AssistantProfileId, options: UpdateAssistantProfileOptions): Promise<AssistantProfile | undefined> => {
    if (!activeOps.updateProfile) throw new Error(t('operationFailed'))
    const updated = await activeOps.updateProfile(id, options)
    invalidateCatalog()
    return updated
  }

  const updateSeat = async (seatId: TeamSeatId, patch: TeamSeatUpdatePatch): Promise<void> => {
    if (!activeOps.updateSeat) throw new Error(t('operationFailed'))
    if (patch.modelOverride === null) {
      // JSON preserves null; undefined would drop the clear instruction on the wire.
      await activeOps.updateSeat(seatId, {
        ...(patch.duty === undefined ? {} : { duty: patch.duty }),
        modelOverride: null,
      })
      return
    }
    await activeOps.updateSeat(seatId, {
      ...(patch.duty === undefined ? {} : { duty: patch.duty }),
      ...(patch.modelOverride === undefined ? {} : { modelOverride: patch.modelOverride }),
    })
  }

  const uiWorkspace = (
    ctx as {
      uiWorkspace?: {
        openSession: (sessionId: SessionId | { parentSessionId?: SessionId; childSessionId?: SessionId; mode?: string }) => void
      }
    }
  ).uiWorkspace

  const clientSessions = ctx.reflect.get('sessions') as ISessions
  const notices = createSnapshotStore<AssistantActionNotice | undefined>(undefined)
  let noticeSeq = 0
  const showNotice = (text: string, success: boolean) => { notices.set({ seq: ++noticeSeq, text, success }) }
  const deleteProfile = activeOps.deleteProfile
  const deleteTeam = activeOps.deleteTeam
  const deleteEntity = async (action: () => Promise<void>) => {
    try {
      await action()
      invalidateCatalog()
      showNotice(t('entityDeleted'), true)
    } catch (error) {
      showNotice(t('operationFailed'), false)
      throw error
    }
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'assistants.action-toast',
    inject: () => ({ notices, dismiss: (seq: number) => { if (notices.getSnapshot()?.seq === seq) notices.set(undefined) } }),
  }, AssistantActionToast))
  const launcher = new AssistantConversationLauncher(ctx, activeOps)
  const bindingChanges = {
    subscribe: (listener: () => void) => {
      const offBinding = launcher.subscribe(listener)
      const offCatalog = catalogRevision.subscribe(listener)
      return () => { offBinding(); offCatalog() }
    },
    getSnapshot: () => launcher.getBindingRevision() + catalogRevision.getSnapshot(),
  }
  const teamRequest = createSnapshotStore<{ teamId: TeamDefinitionId; seq: number } | undefined>(undefined)
  let teamRequestSeq = 0
  let storage: Storage | undefined
  try { storage = window.localStorage }
  catch (error) { void error /* Optional preference storage can be denied by browser settings. */ }
  const preference = createSelectorPreference(storage)
  ctx.effect(() => {
    const sync = (event: StorageEvent) => { if (event.key === SELECTOR_PREFERENCE_KEY || event.key === null) preference.refresh() }
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener('storage', sync) }
  }, 'assistants: composer display preference')
  const selectorProps = (sessionId?: SessionId): AssistantComposerSelectorInjected => ({
    sessionId, preference, changes: bindingChanges, loadProfiles, loadTeams,
    sessionState: {
      subscribe: listener => clientSessions.list.subscribe(listener),
      getSnapshot: () => sessionId ? clientSessions.list.getSnapshot().byId[sessionId] : undefined,
    },
    loadIdentity: async (id) => {
      const team = await activeOps.getTeamBySession?.(id)
      const conversation = await loadConversation(id)
      const profile = conversation ? await loadProfile(conversation.profileId) : undefined
      return { team, profile }
    },
    onStartChat: id => launcher.start(id),
    onUseOrdinary: id => launcher.useOrdinary(id),
    onOpenTeam: (teamId) => {
      teamRequest.set({ teamId, seq: ++teamRequestSeq })
      ctx.layout.selectPanel(PANEL_ID)
    },
    onManage: () => { ctx.layout.selectPanel(PANEL_ID) },
  })
  ctx.effect(() => () => { launcher.dispose() }, 'assistants: pending workspace choice')
  const startChat = (profileId: AssistantProfileId): Promise<void> => launcher.start(profileId)
  const startNewTopic = (profileId: AssistantProfileId): Promise<void> => launcher.start(profileId, true)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'assistants.workspace-choice', locale: NS,
    inject: () => ({ launcher, workspaces: ctx.workspaces, loadProfile, pickDirectory: () => ctx.uiWorkspace.pickDirectory() }),
  }, AssistantWorkspaceDialog))

  const createTeam = async (payload: CreateTeamPayload): Promise<void> => {
    if (!activeOps.createTeamFromTemplate) throw new Error(t('operationFailed'))
    await activeOps.createTeamFromTemplate(payload.templateOrigin, {
      coordinatorProfileId: payload.coordinatorProfileId,
      name: payload.name,
      ...(payload.avatar === undefined ? {} : { avatar: payload.avatar }),
      ...(payload.description === undefined ? {} : { description: payload.description }),
      ...(payload.sharedWorkspaceId === undefined ? {} : { sharedWorkspaceId: payload.sharedWorkspaceId }),
    })
  }

  const saveTeam = async (teamId: TeamDefinitionId, expectedRevision: number, updates: SaveTeamUpdatesPayload): Promise<void> => {
    const teamUpdates: UpdateTeamDefinitionOptions = {
      ...(updates.name === undefined ? {} : { name: updates.name }),
      ...(updates.avatar === undefined ? {} : { avatar: updates.avatar }),
      ...(updates.description === undefined ? {} : { description: updates.description }),
      ...(updates.coordinatorProfileId === undefined ? {} : { coordinatorProfileId: updates.coordinatorProfileId }),
      ...(updates.sharedWorkspaceId === undefined ? {} : { sharedWorkspaceId: updates.sharedWorkspaceId }),
    }
    if (Object.keys(teamUpdates).length > 0) {
      if (!activeOps.updateTeam) throw new Error(t('operationFailed'))
      await activeOps.updateTeam(teamId, expectedRevision, teamUpdates)
    }
  }

  const loadMemories = async (scope: MemoryScope, options?: ListMemoryOptions): Promise<readonly MemoryEntry[]> =>
    activeOps.listMemory ? await activeOps.listMemory(scope, { includeArchived: true, ...options }) : []

  const saveMemory = async (scope: MemoryScope, text: string): Promise<void> => {
    if (!activeOps.saveMemory) throw new Error(t('operationFailed'))
    await activeOps.saveMemory(scope, text)
  }

  const updateMemory = async (id: MemoryEntryId, text: string, expectedRevision: number): Promise<void> => {
    if (!activeOps.updateMemory) throw new Error(t('operationFailed'))
    await activeOps.updateMemory(id, expectedRevision, text)
  }

  const removeMemory = async (id: MemoryEntryId, expectedRevision: number): Promise<void> => {
    if (!activeOps.removeMemory) throw new Error(t('operationFailed'))
    await activeOps.removeMemory(id, expectedRevision)
  }

  const archiveMemory = async (id: MemoryEntryId, expectedRevision: number): Promise<void> => {
    if (!activeOps.archiveMemory) throw new Error(t('operationFailed'))
    await activeOps.archiveMemory(id, expectedRevision)
  }

  const unarchiveMemory = async (id: MemoryEntryId, expectedRevision: number): Promise<void> => {
    if (!activeOps.unarchiveMemory) throw new Error(t('operationFailed'))
    await activeOps.unarchiveMemory(id, expectedRevision)
  }

  const promoteMemory = async (id: MemoryEntryId, targetProfileId: AssistantProfileId): Promise<void> => {
    if (activeOps.promoteMemory) {
      await activeOps.promoteMemory(id, targetProfileId)
      return
    }
    if (!activeOps.promoteTeamMemoryToProfile) throw new Error(t('operationFailed'))
    await activeOps.promoteTeamMemoryToProfile(id, targetProfileId, true)
  }

  // 1. Sidebar Panellist entry
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 15,
        label: () => t('panel'),
        locale: NS,
      },
      AssistantsPanelIcon,
    ),
  )

  // 2. Main panel: Assistant Directory
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: (): AssistantDirectoryInjected => ({
          loadProfiles,
          loadTeams,
          teamRequest: { ...teamRequest, clear: () => { teamRequest.set(undefined) } },
          loadSeats,
          loadModels,
          loadLiveView: activeOps.getTeamActivity,
          discussionOps,
          onCreateProfile: async (data) => {
            if (!activeOps.createProfile) throw new Error(t('operationFailed'))
            await activeOps.createProfile({
              name: data.name,
              responsibility: data.responsibility ?? '',
              instructions: data.instructions,
              ...(data.avatar === undefined ? {} : { avatar: data.avatar }),
            })
            invalidateCatalog()
          },
          onStartChat: startChat,
          onArchiveProfile: async (profileId) => {
            if (!activeOps.archiveProfile) throw new Error(t('operationFailed'))
            await activeOps.archiveProfile(profileId)
            invalidateCatalog()
          },
          onDeleteProfile: deleteProfile
            ? (id, revision) => deleteEntity(() => deleteProfile(id, revision)) : undefined,
          onUnarchiveProfile: activeOps.unarchiveProfile,
          onDeleteTeam: deleteTeam
            ? (id, revision) => deleteEntity(() => deleteTeam(id, revision)) : undefined,
          onArchiveTeam: activeOps.archiveTeam ? async (id) => { await activeOps.archiveTeam?.(id) } : undefined,
          onUpdateProfile: updateProfile,
          onCreateTeam: createTeam,
          onSaveTeam: saveTeam,
          onUpdateSeat: updateSeat,
          onViewActivityLog: (seat, leadSessionId) => {
            const sessionId = seat.activeInstanceId ?? (seat.role === 'coordinator' ? leadSessionId : undefined)
            if (!sessionId) return
            if (sessionId === leadSessionId) uiWorkspace?.openSession(sessionId)
            else if (leadSessionId)
              uiWorkspace?.openSession({ parentSessionId: leadSessionId, childSessionId: sessionId, mode: 'continuable' })
          },
          loadMemories,
          onSaveMemory: saveMemory,
          onUpdateMemory: updateMemory,
          onRemoveMemory: removeMemory,
          onArchiveMemory: archiveMemory,
          onUnarchiveMemory: unarchiveMemory,
          onPromoteMemory: promoteMemory,
        }),
      },
      AssistantDirectory,
    ),
  )

  // The fork selector shadows the legacy expanded institution cards while this plugin is mounted.
  ctx.slots.inject('conversation.hero.agentTeam', () => ctx.slots.register({
    name: 'conversation.hero.agentTeam', priority: -10, locale: NS,
    inject: () => ({ ...selectorProps(), activeSession: {
      subscribe: (listener: () => void) => clientSessions.list.subscribe(listener),
      getSnapshot: () => {
        const list = clientSessions.list.getSnapshot()
        return list.ids.find(id => (list.byId[id]?.retainedBy.mainView ?? 0) > 0)
      },
    } }),
  }, AssistantHeroSelector))

  // 4. Conversation header actions: AssistantConversationHeader
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.actions',
        id: 'assistants.header',
        order: 5,
        locale: NS,
        inject: (sessionId: SessionId): AssistantConversationHeaderInjected => ({
          sessionId,
          loadConversation,
          loadProfile,
          loadModels,
          onStartNewTopic: profileId => startNewTopic(profileId),
          bindingChanges,
          onSetModelOverride: async (conversationId, model) =>
            activeOps.setConversationModelOverride
              ? await activeOps.setConversationModelOverride(conversationId, model)
              : Promise.reject(new Error(t('operationFailed'))),
          onClearModelOverride: async conversationId =>
            activeOps.clearConversationModelOverride
              ? await activeOps.clearConversationModelOverride(conversationId)
              : Promise.reject(new Error(t('operationFailed'))),
          onUpdateProfile: updateProfile,
          loadMemories,
          onSaveMemory: saveMemory,
          onUpdateMemory: updateMemory,
          onRemoveMemory: removeMemory,
          onArchiveMemory: archiveMemory,
          onUnarchiveMemory: unarchiveMemory,
        }),
      },
      AssistantConversationHeader,
    ),
  )

  // 5. Input Dock: AssistantExampleChips
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'assistants.selector', order: 20, locale: NS,
    inject: (sessionId: SessionId) => selectorProps(sessionId),
  }, AssistantComposerSelector))

  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.dock',
        id: 'assistants.example-chips',
        order: 5,
        locale: NS,
        inject: (sessionId: SessionId): AssistantExampleChipsInjected => ({
          loadProfile: async () => {
            const conversation = await loadConversation(sessionId)
            if (!conversation) return undefined
            return await loadProfile(conversation.profileId)
          },
        }),
      },
      AssistantExampleChips,
    ),
  )

  // 6. Input Overlay: AssistantPredictionDock
  ctx.slots.inject('conversation.input.overlay', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.overlay',
        id: 'assistants.composer-prediction',
        order: 10,
        locale: NS,
        inject: (sessionId: SessionId): AssistantPredictionDockInjected => {
          const form = ctx.get('configForms')?.get<PredictionSettings>('assistant-registry')
          const isPredictionEnabled = () => form?.getSnapshot().value?.enableComposerPredictions === true
          const subscribePredictionEnabled = form
            ? (listener: () => void) => form.subscribe(listener)
            : undefined
          const selection = clientSessions?.binding?.(sessionId)?.session.projections.faceOf('modelSelection')
          const getPredictionRouteIdentity = () => {
            const next = (selection?.getSnapshot() as ModelSelectionProjection | undefined)?.next
            return JSON.stringify([next?.provider, next?.model, next?.reasoningEffort])
          }
          return {
            predictComposer: activeOps.predictComposer,
            getComposerContext: activeOps.getComposerContext,
            isPredictionEnabled,
            subscribePredictionEnabled,
            getPredictionRouteIdentity,
            subscribePredictionRoute: selection ? listener => selection.subscribe(listener) : undefined,
          }
        },
      },
      AssistantPredictionDock,
    ),
  )

  // 7. General settings row for composer predictions
  ctx.inject(['configForms', 'slots'], (scope) => {
    const namespace = 'assistant-registry'
    const form = scope.configForms.get<PredictionSettings>(namespace)
    const preference = new PredictionSettingPreference(form)
    const settingFace = (): PredictionSettingInjected => ({
      hooks: { form, mutation: preference.state },
      setEnabled: enabled => preference.setEnabled(enabled),
      dismiss: () => { preference.dismiss() },
    })

    scope.effect(() =>
      scope.configForms.whileServed([namespace], () =>
        scope.slots.inject('settings.general.item', () =>
          scope.slots.register(
            {
              name: 'settings.general.item',
              id: 'assistant-registry-predictions',
              order: 85,
              locale: NS,
              inject: settingFace,
            },
            PredictionSettingRow,
          ),
        ),
      ),
    )

    scope.slots.inject('shell.overlay', () =>
      scope.slots.register(
        {
          name: 'shell.overlay',
          id: 'assistant-registry-predictions-toast',
          locale: NS,
          inject: settingFace,
        },
        PredictionSettingToast,
      ),
    )
  })
}

/**
 * Mount Persistent Assistants UI and return cleanup disposer.
 * @param ctx - browser client context.
 * @param contributionOrOps - optional generated Remote contribution or operations override.
 * @returns cleanup disposer callback.
 */
export async function mountAssistantsUi(
  ctx: ClientContext,
  contributionOrOps?: TypertRemoteContribution | AssistantClientOps,
): Promise<() => Promise<void>> {
  if (contributionOrOps && 'package' in contributionOrOps && 'descriptors' in contributionOrOps) {
    const disposeRemote = await ctx.remote.$mount(contributionOrOps)
    // The generated namespace is a service published by $mount, so consume it in a child fiber.
    const ui = ctx.inject(['remote.assistants', ...inject], (child) => { registerUi(child) })
    try {
      await ui.await()
    } catch (error) {
      await ui.dispose()
      await disposeRemote()
      throw error
    }
    return async () => {
      await ui.dispose()
      await disposeRemote()
    }
  }
  registerUi(ctx, contributionOrOps)
  return async () => {}
}
