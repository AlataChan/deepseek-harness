/** Workspace selection and assistant binding for one new conversation. */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { AssistantProfileId } from '@deepseek-ai/dsh-experimental-assistant-registry/types'
import type { AssistantClientOps } from './mount.ts'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

/** Workspace choice awaiting confirmation before any Session is created. */
export interface AssistantWorkspaceRequest {
  readonly profileId: AssistantProfileId
  readonly busy: boolean
}

/** Creates workspace-owned Sessions and binds their assistant before navigation. */
export class AssistantConversationLauncher {
  private request: AssistantWorkspaceRequest | null = null
  private resolveChoice: ((workspace: WorkspaceView | undefined) => void) | undefined
  private readonly listeners = new Set<() => void>()
  private active: Promise<void> | undefined
  private activeProfile: AssistantProfileId | undefined
  private activeNewTopic = false
  private disposed = false
  private revision = 0

  /**
   * @param ctx - Client services.
   * @param ops - assistant operations.
   */
  constructor(private readonly ctx: Context, private readonly ops: AssistantClientOps) {}

  /**
   * Read the workspace confirmation state.
   * @returns the pending workspace choice, if any.
   */
  readonly getSnapshot = (): AssistantWorkspaceRequest | null => this.request
  /**
   * Read the binding invalidation counter.
   * @returns the number of completed assistant bindings in this Client.
   */
  readonly getBindingRevision = (): number => this.revision
  /**
   * Observe workspace choices and completed bindings.
   * @param listener - change callback.
   * @returns callback disposer.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Confirm or cancel the pending workspace choice.
   * @param workspace - selected Workspace; absent cancels without creating a Session.
   */
  choose(workspace?: WorkspaceView): void {
    if (!this.resolveChoice) return
    const resolve = this.resolveChoice
    this.resolveChoice = undefined
    this.request = this.request && workspace ? { ...this.request, busy: true } : null
    this.notify()
    resolve(workspace)
  }

  /**
   * Bind a pristine selected Session, or create a fresh Session in the chosen Workspace.
   * Repeated clicks share this operation; another assistant cannot replace a pending selection.
   * @param profileId - selected assistant.
   * @param newTopic - force a fresh Session even when the current Session is blank.
   * @returns completion after binding and navigation, or workspace-choice cancellation.
   */
  start(profileId: AssistantProfileId, newTopic = false): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Assistant navigation disposed'))
    if (this.active) return this.activeProfile === profileId && this.activeNewTopic === newTopic
      ? this.active : Promise.reject(new Error('Another assistant selection is pending'))
    this.activeProfile = profileId
    this.activeNewTopic = newTopic
    const navigation = this.ctx.layout.beginNavigation()
    const cancel = () => { this.choose() }
    navigation.addEventListener('abort', cancel, { once: true })
    this.active = this.launch(profileId, newTopic, navigation).finally(() => {
      navigation.removeEventListener('abort', cancel)
      this.active = undefined
      this.activeProfile = undefined
      this.request = null
      this.notify()
    })
    return this.active
  }

  /** Cancel a pending choice and suppress navigation after plugin disposal. */
  dispose(): void {
    this.disposed = true
    this.choose()
    this.listeners.clear()
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try { listener() }
      catch (error) { console.error('Assistant navigation subscriber failed:', error) }
    }
  }

  private isCurrent(navigation: AbortSignal): boolean {
    return !this.disposed && !navigation.aborted
  }

  private async launch(profileId: AssistantProfileId, newTopic: boolean, navigation: AbortSignal): Promise<void> {
    const createConversation = newTopic ? this.ops.startNewTopic : this.ops.createConversation
    if (!createConversation || !this.ops.getConversationBySession) throw new Error('Assistant binding unavailable')
    // This browser service differs from the Host Session registry sharing its name.
    const sessions = this.ctx.reflect.get('sessions') as ISessions
    const workspaces = this.ctx.workspaces
    const snapshot = sessions.list.getSnapshot()
    const selected = snapshot.ids.map(id => snapshot.byId[id]).find(row => (row?.retainedBy.mainView ?? 0) > 0)
    const registry = workspaces.list.getSnapshot()
    if (registry.phase !== 'ready' || snapshot.phase !== 'ready') throw new Error('Workspace list not ready')
    let workspace = selected && registry.items.find(item => item.sessionIds.includes(selected.id))
    if (!workspace) {
      workspace = await new Promise<WorkspaceView | undefined>((resolve) => {
        this.resolveChoice = resolve
        this.request = { profileId, busy: false }
        this.notify()
      })
    }
    if (!workspace || !this.isCurrent(navigation)) return

    let sessionId = selected?.blank && !selected.running && !selected.parentId
      && workspace.sessionIds.includes(selected.id) ? selected.id : undefined
    if (sessionId !== undefined) {
      const existing = await this.ops.getConversationBySession(sessionId)
      const latest = sessions.list.getSnapshot().byId[sessionId]
      if (!latest?.blank || latest.running || latest.parentId || (existing && existing.profileId !== profileId)) sessionId = undefined
      else if (existing && !newTopic) {
        if (this.isCurrent(navigation)) this.ctx.uiWorkspace.openSession(sessionId)
        return
      }
    }
    if (newTopic) sessionId = undefined
    if (!this.isCurrent(navigation)) return
    sessionId ??= await sessions.create({ workspaceId: workspace.workspaceId })
    if (!this.isCurrent(navigation)) return
    const conversation = await createConversation(profileId, { rootSessionId: sessionId })
    if (conversation.rootSessionId !== sessionId || conversation.profileId !== profileId) {
      throw new Error('Assistant binding does not match the selected Session')
    }
    this.revision++
    this.notify()
    if (this.isCurrent(navigation)) this.ctx.uiWorkspace.openSession(sessionId)
  }
}
