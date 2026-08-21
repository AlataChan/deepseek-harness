/** Single-Agent terminal lifecycle ownership. @module @deepseek-ai/dsh-tui/driver/session */

import type { Context } from '@deepseek-ai/cordis'
import {
  installModelSelection,
  type Agent,
  type AgentHandle,
  type ModelSelection,
  type ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  createTranscriptProjection,
  foldSessionEvent,
  projectSessionEvents,
  type TranscriptProjection,
} from '../transcript/project.ts'
import type { DisplayTextBudget } from '../transcript/display-text.ts'

/** Model reference installed during unpublished Agent setup. */
export interface TuiModelSelectionRef extends ModelSelectionRef {
  current: ModelSelection
}

/**
 * Install the session-local model selection before Agent publication.
 * @param agentCtx - unpublished Agent scope.
 * @param fallback - live default used until the session has a request header.
 * @returns mutable selection reference owned by the terminal controller.
 */
export function installTuiModelSelection(
  agentCtx: Context,
  fallback: ModelSelection,
): TuiModelSelectionRef {
  const agent = agentCtx.agent
  if (agent === undefined) throw new Error('tui: Agent setup has no scoped Agent')
  let picked: ModelSelection | undefined
  const selection: TuiModelSelectionRef = {
    get current(): ModelSelection {
      if (picked !== undefined) return picked
      const logged = agent.session.requestHeader()?.config
      if (logged === undefined) return fallback
      return {
        provider: logged.provider,
        model: logged.model,
        ...logged.reasoningEffort === undefined ? {} : { reasoningEffort: logged.reasoningEffort },
      }
    },
    set current(next: ModelSelection) { picked = next },
    assembled: undefined,
  }
  installModelSelection(agentCtx, selection)
  return selection
}

/** Owned live Agent plus its replay-equivalent terminal projection. */
export interface OwnedTuiSession {
  readonly agent: Agent
  readonly modelSelection: TuiModelSelectionRef
  readonly transcript: TranscriptProjection
  /** Dispose the event listener and exact Agent handle once. */
  dispose(): Promise<void>
}

/**
 * Adopt one published Agent handle and observe only its exact Session.
 * @param handle - capability returned by AgentRegistry create or resume.
 * @param modelSelection - reference installed during unpublished setup.
 * @param budget - visible transcript limits.
 * @returns owned lifecycle with an initially replayed transcript.
 */
export function ownTuiSession(
  handle: AgentHandle,
  modelSelection: TuiModelSelectionRef,
  budget: DisplayTextBudget,
  onProjection: (projection: TranscriptProjection) => void = () => {},
  onStatus: (status: Agent['status']) => void = () => {},
): OwnedTuiSession {
  let transcript = projectSessionEvents(handle.agent.session.events, budget)
  let disposed = false
  onProjection(transcript)
  onStatus(handle.agent.status)
  const stopEvents = handle.agent.ctx.on('session/event', (session: Session, event) => {
    if (session !== handle.agent.session) return
    transcript = foldSessionEvent(transcript, event, budget)
    onProjection(transcript)
  })
  const stopStatus = handle.agent.ctx.on('agent/status', ({ agent, status }) => {
    if (agent === handle.agent) onStatus(status)
  })
  return {
    agent: handle.agent,
    modelSelection,
    get transcript() { return transcript },
    async dispose() {
      if (disposed) return
      disposed = true
      stopEvents()
      stopStatus()
      await handle.dispose()
      transcript = createTranscriptProjection()
    },
  }
}
