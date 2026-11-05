/** Structural Agent carriers for Session-observer and tool component tests; no prompt controller. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentStatus, Inbox } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'

export interface StubAgent {
  readonly agent: Agent
  readonly session: Session
  readonly inbox: Inbox
  setStatus(status: AgentStatus): void
}

/** Build one registry-compatible live agent over an existing session. */
export function stubAgentWith(session: Session, ctx: Context): StubAgent {
  const inbox = createInboxStub()
  let status: AgentStatus = 'running'
  const agent: Agent = {
    model: { current: () => undefined, select: () => {}, origin: () => null },
    id: session.id,
    options: {},
    session,
    inbox,
    get status() { return status },
    ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject(input) {
      this.inbox.append('next-step', input)
    },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session, inbox, setStatus(value) { status = value } }
}

/** Build one registry-compatible live agent over the harness context. */
export function stubAgent(rawId: string, ctx: Context): StubAgent {
  return stubAgentWith(ctx.sessions.create(SessionId(rawId)), ctx)
}
