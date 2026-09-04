/** Session Remote owner: cold reads, explicit Agent commands, and live control state. */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { canOpenNativePath, openNativePath } from '@deepseek-ai/dsh-native-command'
import type {} from '@deepseek-ai/dsh-host-workspace-entries'
import {
  WorkspaceEntriesError,
} from '@deepseek-ai/dsh-host-workspace-entries'
import type {} from '@deepseek-ai/dsh-host-ask-data'
import type {} from '@deepseek-ai/dsh-host-ask-knowledge'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  ApiSessionAgentController,
  inspectApiSession,
  type ApiSessionAgentResult,
} from './agent.ts'
import { SessionCommandController } from './commands.ts'
import { SessionControlController } from './control.ts'
import { SessionHistoryController } from './history.ts'
import { SessionFileReferences } from './file-references.ts'
import {
  ApiSessionList,
  DEFAULT_COLD_BLANK_PROBE_MAX_BYTES,
  DEFAULT_COLD_BLANK_PROBE_MAX_EVENTS,
} from './list.ts'
import { buildModelCatalog } from './catalog.ts'
import { installModelSelectionProjection } from './model-selection-projection.ts'
import { SessionSkillCatalog } from './skill-catalog.ts'
import type {
  ModelCatalog,
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionControlFrame,
  SessionCreateRequest,
  SessionCreateValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionForkRequest,
  SessionForkValue,
  SessionListRequest,
  SessionListValue,
  SessionListEntriesRequest,
  SessionListEntriesValue,
  SessionOpenWorkspacePathRequest,
  SessionOpenWorkspacePathValue,
  SessionPage,
  SessionPageRequest,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSearchRequest,
  SessionSearchValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
  SessionAskDataBinding,
  SessionAskDataBindingRequest,
  SessionAskDataImportPreview,
  SessionAskDataSource,
  SessionCommitAskDataRequest,
  SessionCommitAskDataValue,
  SessionImportAskDataSpreadsheetRequest,
  SessionAskKnowledgeBinding,
  SessionAskKnowledgeBindingRequest,
  SessionAskKnowledgeBundle,
  SessionAskKnowledgeExtractResult,
  SessionAskKnowledgeIngestResult,
  SessionAskKnowledgeLibrary,
  SessionAskKnowledgeLookup,
  SessionAskKnowledgeLookupRequest,
  SessionAskKnowledgeRetrieveRequest,
  SessionAppendAskKnowledgeExtractChunkRequest,
  SessionAppendAskKnowledgeIngestChunkRequest,
  SessionAttachAskKnowledgeRequest,
  SessionAttachAskKnowledgeValue,
  SessionBeginAskKnowledgeExtractRequest,
  SessionBeginAskKnowledgeIngestRequest,
  SessionCreateAskKnowledgeLibraryRequest,
  SessionDetachAskKnowledgeRequest,
  SessionFinishAskKnowledgeExtractRequest,
  SessionFinishAskKnowledgeIngestRequest,
  SessionRemoveAskKnowledgeLibraryRequest,
  SessionRenameAskKnowledgeLibraryRequest,
} from './types.ts'
import { SessionAskDataController } from './ask-data.ts'
import { SessionAskKnowledgeController } from './ask-knowledge.ts'

export type * from './types.ts'
export { ApiSessionNotFound } from './agent.ts'
export { SessionFileReferences } from './file-references.ts'
export { SessionSkillCatalog } from './skill-catalog.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Session business API and Remote namespace owner. */
    sessionController: SessionController
  }
}

/** Session Controller deployment policy. */
export interface Config {
  /** Maximum stat-reported event count eligible for one full cold projection observation; `0` disables the event-count gate. */
  readonly coldBlankProbeMaxEvents?: number
  /** Maximum stat-reported artifact byte size eligible for one full cold projection observation; `0` disables the byte-size gate. */
  readonly coldBlankProbeMaxBytes?: number
  /** Override platform desktop-opener detection. */
  readonly nativeOpen?: boolean
}

/** Host integrations replaceable by direct unit tests. */
export interface SessionControllerInternals {
  /** Native default-application handoff. */
  readonly openPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native handoff availability probe. */
  readonly canOpenPath?: () => boolean
}

/** Host service backing the generated `ctx.remote.session` namespace. */
export class SessionController extends TypertRemoteService {
  static inject = [
    'agentDefaultModel',
    'agents',
    'attachments',
    'llm',
    'sessions',
    'sessionProjections',
    'sessionQuery',
    'typert',
    'workspaceRegistry',
  ]

  static Config: z<Config> = z.object({
    coldBlankProbeMaxEvents: z.natural().default(DEFAULT_COLD_BLANK_PROBE_MAX_EVENTS),
    coldBlankProbeMaxBytes: z.natural().default(DEFAULT_COLD_BLANK_PROBE_MAX_BYTES),
    nativeOpen: z.boolean(),
  })

  private readonly agents: ApiSessionAgentController
  private readonly commands: SessionCommandController
  private readonly controlState: SessionControlController
  private readonly history: SessionHistoryController
  private readonly listState: ApiSessionList
  private readonly openPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly canOpenPath: () => boolean
  private readonly promotions = new Set<Promise<void>>()
  private readonly askData: SessionAskDataController
  private readonly askKnowledge: SessionAskKnowledgeController

  /**
   * @param ctx - Host context containing the Session capability assembly.
   * @param config - cold-list observation and native-opener deployment policy.
   * @param internals - host integrations replaceable by direct unit tests.
   */
  constructor(ctx: Context, config: Config, internals: SessionControllerInternals = {}) {
    super(ctx, 'sessionController', { namespace: 'session' })
    installModelSelectionProjection(ctx)
    this.agents = new ApiSessionAgentController(ctx)
    this.askData = new SessionAskDataController(ctx, this.agents, process.cwd())
    this.askKnowledge = new SessionAskKnowledgeController(
      ctx,
      this.agents,
      this.askData.gate,
      process.cwd(),
    )
    this.commands = new SessionCommandController(ctx, this.agents, process.cwd())
    const presets = ctx.get('agentPresets')
    if (presets !== undefined && 'admitSelect' in presets) {
      ctx.effect(
        () => presets.admitSelect((agent, next) => { this.askData.assertSelectAllowed(agent, next) }),
        'session-controller.ask-data.admitSelect',
      )
    }
    this.controlState = new SessionControlController(ctx)
    // Registered before history so reverse-order teardown closes every
    // follower before waiting for already-admitted promotions.
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.promotions])
    }, 'session-controller.promotions')
    this.history = new SessionHistoryController(ctx, (observation) => { this.promote(observation) })
    this.listState = new ApiSessionList(ctx, {
      coldBlankProbeMaxEvents: config.coldBlankProbeMaxEvents ?? DEFAULT_COLD_BLANK_PROBE_MAX_EVENTS,
      coldBlankProbeMaxBytes: config.coldBlankProbeMaxBytes ?? DEFAULT_COLD_BLANK_PROBE_MAX_BYTES,
    })
    this.openPath = internals.openPath ?? openNativePath
    this.canOpenPath = internals.canOpenPath
      ?? (() => config.nativeOpen ?? (internals.openPath !== undefined || canOpenNativePath()))
    ctx.plugin(SessionFileReferences)
    ctx.plugin(SessionSkillCatalog)

    ctx.on('session/created', (session) => {
      ctx.emit('api-session/added', this.listState.summaryFor(session))
    })
    ctx.on('session/disposed', (session) => {
      ctx.emit('api-session/removed', session.id)
    })
    ctx.on('agent/status', ({ agent, status }) => {
      ctx.emit('api-session/status', agent.id, status === 'running')
    })
    ctx.on('agent/error', ({ agent, error }) => {
      ctx.emit('api-session/error', agent.id, errorChain(error))
    })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'request/header') {
        const agent = ctx.agents.get(session.id)
        if (agent?.session === session) this.agents.consumeSelection(
          agent,
          event.data.header.config.provider,
          event.data.header.config.model,
          event.data.header.config.reasoningEffort,
        )
      }
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
      ctx.emit('api-session/activity', session.id, event.time)
    })
  }

  private promote(observation: SessionObservation): void {
    const sessionId = observation.header.id
    const task = (async () => {
      using ownedObservation = observation
      const result = await this.agents.resolveObservedAgent(ownedObservation)
      if ('error' in result) this.ctx.emit('api-session/error', sessionId, result.error.message)
    })().catch((error: unknown) => {
      this.ctx.logger.error(`session-controller: background activation for "${sessionId}" failed: ${errorChain(error)}`)
    })
    this.promotions.add(task)
    void task.finally(() => { this.promotions.delete(task) })
  }

  /**
   * Resolve or resume one ordinary Session for another Host API domain.
   * @param sessionId - Session identity whose Agent owns the operation.
   * @returns the live Agent or the stable Session-domain failure.
   */
  resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult> {
    return this.agents.resolveAgent(sessionId)
  }

  /**
   * Inspect one attached or persisted Session without activating its Agent.
   * @param sessionId - durable Session identity.
   * @param signal - optional caller cancellation for persistence reads.
   * @returns the current attached state or persisted header and event prefix.
   */
  inspect(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionInspection> {
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      return Promise.resolve({
        meta: attached.header,
        inheritedEventCount: attached.inheritedEventCount,
        events: attached.snapshotEvents(),
      })
    }
    return inspectApiSession(this.ctx, sessionId, signal)
  }

  /**
   * Read all visible Session rows without resuming an Agent.
   * @param _request - reserved empty list request.
   * @param signal - cancellation for persistence reads.
   * @returns visible Session summaries ordered by activity.
   */
  @Remote('list')
  async list(_request: SessionListRequest, signal: AbortSignal): Promise<SessionListValue> {
    return { items: await this.listState.list(signal) }
  }

  /**
   * Search visible Session content without resuming an Agent.
   * @param request - literal message-content query.
   * @param signal - cancellation for list and search reads.
   * @returns authorized bounded Session search results.
   */
  @Remote('search')
  search(request: SessionSearchRequest, signal: AbortSignal): Promise<SessionSearchValue> {
    return this.listState.search(request.query, signal)
  }

  /**
   * Create or idempotently adopt one ordinary Session.
   * @param request - requested identity, location, and Agent preset.
   * @returns the Session identity and resolved preset when configured.
   */
  @Remote('create')
  create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    return this.commands.create(request)
  }

  /**
   * Select one Session-local model after explicitly resuming the Session.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection installed for the Session.
   */
  @Remote('selectModel')
  selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    return this.commands.selectModel(request)
  }

  /**
   * Describe every currently routable model for Host-generation selectors.
   * @returns provider-grouped models, the deployment default, and isolated provider failures.
   */
  @Remote('modelCatalog')
  modelCatalog(): Promise<ModelCatalog> {
    return buildModelCatalog(this.ctx)
  }

  /**
   * Report whether this deployment can hand a Session workspace path to a native desktop.
   * @returns true when the matching open operation is available.
   */
  @Remote
  canOpenWorkspacePath(): boolean {
    return this.canOpenPath()
  }

  /**
   * Open one path prepared by a Session-aware caller on the Host desktop.
   * @param request - path after best-effort Session workspace resolution.
   * @param signal - caller lifetime; abort terminates the native command.
   * @returns confirmation after the native opener accepts the path.
   * @throws RemoteError when the request is invalid, cancelled, or the opener fails.
   */
  @Remote('openWorkspacePath')
  async openWorkspacePath(
    request: SessionOpenWorkspacePathRequest,
    signal: AbortSignal,
  ): Promise<SessionOpenWorkspacePathValue> {
    if (request.path.length === 0) {
      throw new RemoteError(
        'gateway/bad-request',
        'session.openWorkspacePath requires a non-empty path',
        {},
      )
    }
    signal.throwIfAborted()
    try {
      await this.openPath(request.path, signal)
      return { opened: true }
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'path open was aborted', {})
      throw new RemoteError(
        'gateway/internal',
        `path open failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
      )
    }
  }

  /**
   * List one directory under a Session's project cwd. The Host derives the
   * fence from the Session header; the Client must not send a root.
   * @param request - Session identity and optional absolute list path.
   * @param signal - caller lifetime; abort stops the filesystem scan.
   * @returns one fenced directory level.
   * @throws RemoteError when the capability is absent, the Session has no cwd,
   * the path leaves the fence, or the scan fails.
   */
  @Remote('listEntries')
  async listEntries(
    request: SessionListEntriesRequest,
    signal: AbortSignal,
  ): Promise<SessionListEntriesValue> {
    signal.throwIfAborted()
    const capability = this.ctx.get('workspaceEntries')
    if (capability === undefined) {
      throw new RemoteError(
        'session/entries-unavailable',
        'session.listEntries needs the workspace-entries capability',
        {},
      )
    }
    const root = await this.sessionEntriesRoot(request.sessionId, signal)
    signal.throwIfAborted()
    try {
      return await capability.list({
        root,
        ...request.path === undefined ? {} : { path: request.path },
      }, signal)
    } catch (error: unknown) {
      if (signal.aborted) {
        throw new RemoteError('gateway/cancelled', 'workspace listing was aborted', {})
      }
      if (error instanceof WorkspaceEntriesError) {
        throw new RemoteError(
          error.code === 'entries-outside-root'
            ? 'session/entries-outside-root'
            : 'session/entries-unreadable',
          error.message,
          error.code === 'entries-outside-root'
            ? { path: error.path, root: error.root ?? '' }
            : { path: error.path },
        )
      }
      throw new RemoteError(
        'gateway/internal',
        error instanceof Error ? error.message : String(error),
        {},
      )
    }
  }

  /**
   * List overlay-managed sources plus unmatched data-agent connections.
   * @param signal - caller lifetime; abort stops the listing.
   * @returns listed sources.
   * @throws RemoteError when the ask-data capability is absent.
   */
  @Remote('listAskDataSources')
  listAskDataSources(signal: AbortSignal): Promise<readonly SessionAskDataSource[]> {
    return this.askData.listSources(signal)
  }

  /**
   * Import one `.xlsx` / `.csv`. `bytes` is canonical base64 of the decoded file.
   * Does not apply a preset or open a session.
   * @param request - filename, encoded bytes, optional replace target.
   * @param signal - caller lifetime; abort stops the import.
   * @returns preview read from the written sqlite.
   */
  @Remote('importAskDataSpreadsheet')
  importAskDataSpreadsheet(
    request: SessionImportAskDataSpreadsheetRequest,
    signal: AbortSignal,
  ): Promise<SessionAskDataImportPreview> {
    return this.askData.importSpreadsheet(request, signal)
  }

  /**
   * Copy the packaged sample sqlite. Does not need host `sqlite3`.
   * @param signal - caller lifetime; abort stops the copy.
   * @returns preview of the copied sqlite.
   */
  @Remote('importAskDataSample')
  importAskDataSample(signal: AbortSignal): Promise<SessionAskDataImportPreview> {
    return this.askData.importSample(signal)
  }

  /**
   * Bind one source to a Session. Host does not guess the current Session.
   * Pass `sessionId` only when the caller already has a blank (or already
   * bound-to-this-source) Session.
   * @param request - source and optional session / workspace.
   * @param signal - caller lifetime; abort stops the commit.
   * @returns the Session identity after bind + `ask-data/bound`.
   */
  @Remote('commitAskData')
  commitAskData(
    request: SessionCommitAskDataRequest,
    signal: AbortSignal,
  ): Promise<SessionCommitAskDataValue> {
    return this.askData.commit(request, signal)
  }

  /**
   * Read the current ask-data bind of a live Session.
   * @param request - Session identity.
   * @returns the bind, or null before one.
   */
  @Remote('askDataBinding')
  askDataBinding(request: SessionAskDataBindingRequest): SessionAskDataBinding | null {
    return this.askData.askDataBinding(request.sessionId)
  }

  /**
   * List overlay-managed knowledge libraries.
   * @param signal - caller lifetime; abort stops the listing.
   * @returns catalog rows.
   */
  @Remote('listAskKnowledgeLibraries')
  listAskKnowledgeLibraries(signal: AbortSignal): Promise<readonly SessionAskKnowledgeLibrary[]> {
    return this.askKnowledge.listLibraries(signal)
  }

  /**
   * Create an empty knowledge library.
   * @param request - display name and optional workspace shortcut.
   * @param signal - caller lifetime; abort stops the create.
   * @returns the new catalog row.
   */
  @Remote('createAskKnowledgeLibrary')
  createAskKnowledgeLibrary(
    request: SessionCreateAskKnowledgeLibraryRequest,
    signal: AbortSignal,
  ): Promise<SessionAskKnowledgeLibrary> {
    return this.askKnowledge.createLibrary(request, signal)
  }

  /**
   * Rename a knowledge library.
   * @param request - library id and new display name.
   * @param signal - caller lifetime; abort stops the rename.
   * @returns the updated row.
   */
  @Remote('renameAskKnowledgeLibrary')
  renameAskKnowledgeLibrary(
    request: SessionRenameAskKnowledgeLibraryRequest,
    signal: AbortSignal,
  ): Promise<SessionAskKnowledgeLibrary> {
    return this.askKnowledge.renameLibrary(request, signal)
  }

  /**
   * Remove a knowledge library and unbind live and cold sessions.
   * @param request - library id.
   * @param signal - caller lifetime; abort stops the remove.
   */
  @Remote('removeAskKnowledgeLibrary')
  removeAskKnowledgeLibrary(
    request: SessionRemoveAskKnowledgeLibraryRequest,
    signal: AbortSignal,
  ): Promise<void> {
    return this.askKnowledge.removeLibrary(request, signal)
  }

  /**
   * Hang a library on a Session. Host does not guess the current Session.
   * Omit `sessionId` to create a standard Session, then attach.
   * A named data-agent Session with an ask-data bind creates a new standard
   * Session instead, because data-agent denies retrieve tools.
   * @param request - library and optional session / workspace.
   * @param signal - caller lifetime; abort stops the attach.
   * @returns the Session identity after bind.
   */
  @Remote('attachAskKnowledge')
  attachAskKnowledge(
    request: SessionAttachAskKnowledgeRequest,
    signal: AbortSignal,
  ): Promise<SessionAttachAskKnowledgeValue> {
    return this.askKnowledge.attach(request, signal)
  }

  /**
   * Clear the library bind on a live Session.
   * @param request - Session identity.
   * @param signal - caller lifetime; abort stops the detach.
   */
  @Remote('detachAskKnowledge')
  detachAskKnowledge(
    request: SessionDetachAskKnowledgeRequest,
    signal: AbortSignal,
  ): Promise<void> {
    return this.askKnowledge.detach(request, signal)
  }

  /**
   * Open an ingest upload. `bytes` chunks follow on append.
   * @param request - library and original filename.
   * @param signal - caller lifetime; abort stops the begin.
   * @returns the ingest handle.
   */
  @Remote('beginAskKnowledgeIngest')
  beginAskKnowledgeIngest(
    request: SessionBeginAskKnowledgeIngestRequest,
    signal: AbortSignal,
  ): Promise<string> {
    return this.askKnowledge.beginIngest(request, signal)
  }

  /**
   * Append one canonical-base64 chunk. Decoded size must be ≤ 160KiB.
   * @param request - handle and encoded bytes.
   * @param signal - caller lifetime; abort stops the append.
   */
  @Remote('appendAskKnowledgeIngestChunk')
  appendAskKnowledgeIngestChunk(
    request: SessionAppendAskKnowledgeIngestChunkRequest,
    signal: AbortSignal,
  ): Promise<void> {
    return this.askKnowledge.appendIngestChunk(request, signal)
  }

  /**
   * Assemble chunks and run ingest → propose → apply.
   * @param request - handle and optional raw reuse path.
   * @param signal - caller lifetime; abort stops the finish.
   * @returns applied, deferred, or failed ingest status.
   */
  @Remote('finishAskKnowledgeIngest')
  finishAskKnowledgeIngest(
    request: SessionFinishAskKnowledgeIngestRequest,
    signal: AbortSignal,
  ): Promise<SessionAskKnowledgeIngestResult> {
    return this.askKnowledge.finishIngest(request, signal)
  }

  /**
   * Open a session-only extract upload. Does not write catalog.
   * @param request - original filename.
   * @param signal - caller lifetime; abort stops the begin.
   * @returns the extract handle.
   */
  @Remote('beginAskKnowledgeExtract')
  beginAskKnowledgeExtract(
    request: SessionBeginAskKnowledgeExtractRequest,
    signal: AbortSignal,
  ): Promise<string> {
    return this.askKnowledge.beginExtract(request, signal)
  }

  /**
   * Append one canonical-base64 chunk to a session-only extract upload.
   * @param request - handle and encoded bytes.
   * @param signal - caller lifetime; abort stops the append.
   */
  @Remote('appendAskKnowledgeExtractChunk')
  appendAskKnowledgeExtractChunk(
    request: SessionAppendAskKnowledgeExtractChunkRequest,
    signal: AbortSignal,
  ): Promise<void> {
    return this.askKnowledge.appendExtractChunk(request, signal)
  }

  /**
   * Convert the assembled file to text. Does not write catalog or vault.
   * @param request - handle.
   * @param signal - caller lifetime; abort stops the finish.
   * @returns extracted text and whether it was truncated.
   */
  @Remote('finishAskKnowledgeExtract')
  finishAskKnowledgeExtract(
    request: SessionFinishAskKnowledgeExtractRequest,
    signal: AbortSignal,
  ): Promise<SessionAskKnowledgeExtractResult> {
    return this.askKnowledge.finishExtract(request, signal)
  }

  /**
   * Retrieve pages for the Session's hung library.
   * @param request - Session identity and terms.
   * @param signal - caller lifetime; abort stops the retrieve.
   * @returns a bounded bundle.
   */
  @Remote('askKnowledgeRetrieve')
  askKnowledgeRetrieve(
    request: SessionAskKnowledgeRetrieveRequest,
    signal: AbortSignal,
  ): Promise<SessionAskKnowledgeBundle> {
    return this.askKnowledge.retrieve(request, signal)
  }

  /**
   * Look up one term on the Session's hung library.
   * @param request - Session identity and term.
   * @param signal - caller lifetime; abort stops the lookup.
   * @returns lookup fields plus optional text.
   */
  @Remote('askKnowledgeLookup')
  askKnowledgeLookup(
    request: SessionAskKnowledgeLookupRequest,
    signal: AbortSignal,
  ): Promise<SessionAskKnowledgeLookup> {
    return this.askKnowledge.lookup(request, signal)
  }

  /**
   * Read the current ask-knowledge bind of a live Session.
   * @param request - Session identity.
   * @returns the bind, or null before one.
   */
  @Remote('askKnowledgeBinding')
  askKnowledgeBinding(request: SessionAskKnowledgeBindingRequest): SessionAskKnowledgeBinding | null {
    return this.askKnowledge.askKnowledgeBinding(request.sessionId)
  }

  /**
   * Rename one Session after explicitly resuming it.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   */
  @Remote('rename')
  rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    return this.commands.rename(request)
  }

  /**
   * Fork one cold-readable completed-turn prefix into a new Session.
   * @param request - source Session and optional event anchor.
   * @returns the new Session identity.
   */
  @Remote('fork')
  fork(request: SessionForkRequest): Promise<SessionForkValue> {
    return this.commands.fork(request)
  }

  /**
   * Admit one prompt after explicitly resuming its Session.
   * @param request - Session identity, prompt content, source metadata, and delivery mode.
   * @param signal - caller cancellation before prompt admission begins.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  @Remote('prompt')
  prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue> {
    signal.throwIfAborted()
    return this.askData.gate.run(request.sessionId, 'wait', async () => {
      const found = await this.agents.resolveAgent(request.sessionId)
      if ('error' in found) throw found.error
      this.askData.assertPromptAllowed(request.sessionId, found.agent)
      return this.askKnowledge.withOverlaySession(request.sessionId, () =>
        this.commands.prompt(request))
    })
  }

  /**
   * Read one image proven reachable from the addressed Session log.
   * @param request - Session and attachment identities used for authorization.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  @Remote('attachment')
  attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    return this.commands.attachment(request)
  }

  /**
   * Mutate one still-pending queue occurrence on a live Agent.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  @Remote('updateQueue')
  updateQueue(request: SessionUpdateQueueRequest): SessionUpdateQueueValue {
    return this.commands.updateQueue(request)
  }

  /**
   * Cancel one active Agent turn without dropping its pending inbox.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  @Remote('cancel')
  cancel(request: SessionCancelRequest): SessionCancelValue {
    return this.commands.cancel(request)
  }

  /**
   * Read one cold-safe, message-aligned Session history page.
   * @param request - durable address, backward cursor, and page budget.
   * @param signal - cancellation for persistence reads.
   * @returns one chronological page.
   */
  @Remote('page')
  page(request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage> {
    return this.history.page(request, signal)
  }

  /**
   * Follow one Session log from its opening or resume cursor.
   * @param request - durable address and last committed sequence already held by the caller.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns a complete opening snapshot followed by gap-free event frames.
   */
  @Remote({ mode: 'stream' })
  follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    return this.history.follow(request, signal)
  }

  /**
   * Stream a complete live-control baseline followed by replacement frames.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns one complete baseline followed by live replacement frames.
   */
  @Remote({ mode: 'stream' })
  control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    return this.controlState.control(signal)
  }

  /**
   * Resolve the project root `session.listEntries` fences to: the named
   * Session's `header.cwd`. Live Sessions win; otherwise a persistence
   * index row. This does not resume an Agent.
   * @param sessionId - Session whose cwd is the listing fence.
   * @param signal - cancellation for persistence reads.
   */
  private async sessionEntriesRoot(sessionId: SessionId, signal: AbortSignal): Promise<string> {
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      if (attached.header.cwd === undefined || attached.header.cwd === '') {
        throw new RemoteError(
          'session/entries-unreadable',
          `session "${sessionId}" has no project directory`,
          { path: '' },
        )
      }
      return attached.header.cwd
    }
    const stored = (await this.ctx.get('sessionPersistence')?.list({ signal }))
      ?.find(snapshot => snapshot.header.id === sessionId)
    if (stored === undefined) {
      throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId })
    }
    if (stored.header.cwd === undefined || stored.header.cwd === '') {
      throw new RemoteError(
        'session/entries-unreadable',
        `session "${sessionId}" has no project directory`,
        { path: '' },
      )
    }
    return stored.header.cwd
  }

}

export { buildModelCatalog }
export default SessionController
