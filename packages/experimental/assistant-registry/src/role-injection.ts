/**
 * Role injection seam: registers dynamic system prompt section for assistant-bound agents.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/role-injection
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AssistantProfile } from './types.ts'
import type { AssistantService } from './index.ts'

/** Central ordering for the persistent assistant role prompt section. */
export const ASSISTANT_ROLE_SECTION_ORDER = 100

/**
 * Formats the system prompt text for an assistant profile's responsibility and instructions.
 * @param profile - assistant profile specification.
 * @returns formatted section text.
 */
export function formatAssistantRoleText(profile: AssistantProfile): string {
  const parts: string[] = []
  parts.push(`You are ${profile.name}.`)
  parts.push(`Responsibility:\n${profile.responsibility}`)
  if (profile.instructions !== undefined && profile.instructions.trim().length > 0) {
    parts.push(`Instructions:\n${profile.instructions}`)
  }
  return parts.join('\n\n')
}

/**
 * Installs dynamic role injection for all assistant-bound agents on creation and startup.
 *
 * @param ctx - Cordis context.
 * @param assistants - Assistant service owning catalog.
 * @returns Disposer function for role injection listeners.
 */
export function installRoleInjection(ctx: Context, assistants: AssistantService): {
  dispose: () => void
  maybeInstall: (agent: Agent) => void
} {
  const installed = new Map<Agent['id'], () => void>()

  const maybeInstall = (agent: Agent): void => {
    if (installed.has(agent.id) || !assistants.isAssistantBound(agent.id)) return

    const disposeSection = agent.ctx.systemPrompt.section({
      name: `assistant:role:${agent.id}`,
      order: ASSISTANT_ROLE_SECTION_ORDER,
      text: () => {
        const profile = assistants.getBoundProfileSync(agent.id)
        if (!profile) return ''
        const role = formatAssistantRoleText(profile)
        const seat = assistants.getSeatBySessionSync(agent.id)
        return seat === undefined ? role : `${role}\n\nTeam duty:\n${seat.duty}`
      },
    })

    installed.set(agent.id, disposeSection)
  }

  // Startup enumeration over already-registered agents
  const agents = ctx.get('agents')
  if (agents) {
    for (const agent of agents.list()) {
      maybeInstall(agent)
    }
  }

  const disposeCreated = ctx.on('agent/created', ({ agent }) => {
    maybeInstall(agent)
  })

  const disposeDisposed = ctx.on('agent/disposed', ({ agent }) => {
    installed.get(agent.id)?.()
    installed.delete(agent.id)
  })

  return {
    dispose: () => {
      disposeCreated()
      disposeDisposed()
      for (const dispose of installed.values()) {
        dispose()
      }
      installed.clear()
    },
    maybeInstall,
  }
}
