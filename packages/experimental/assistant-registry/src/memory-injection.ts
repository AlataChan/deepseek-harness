/**
 * Memory injection seam: registers dynamic system prompt section for assistant-bound agents.
 * @module @deepseek-ai/dsh-experimental-assistant-registry/memory-injection
 */

import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MEMORY_SNAPSHOT_MAX_BYTES, MEMORY_SNAPSHOT_MAX_ENTRIES, type MemoryEntry } from './types.ts'
import type { AssistantService } from './index.ts'

/** Central ordering for the persistent assistant memory prompt section. */
export const ASSISTANT_MEMORY_SECTION_ORDER = 110

/** Options for memory prompt formatting. */
export interface MemoryFormatOptions {
  /** Maximum number of memory entries to format into the snapshot. */
  readonly maxEntries?: number | undefined
  /** Maximum byte length of the formatted section. */
  readonly maxBytes?: number | undefined
}

/**
 * Reconstructed entry metadata from a logged memory prompt snapshot.
 */
export interface ReconstructedMemorySnapshotEntry {
  readonly id: string
  readonly revision: number
  readonly text: string
}

/**
 * Reconstructs entry identities and revisions from a logged memory prompt snapshot string.
 * Supports data-encoded markers for lossless multiline and marker-like content reconstruction,
 * with fallback to bullet text for unencoded legacy markers.
 * @param text - formatted section text from the prompt snapshot.
 * @returns array of reconstructed memory snapshot items.
 */
export function parseAssistantMemorySnapshot(text: string): readonly ReconstructedMemorySnapshotEntry[] {
  if (!text) return []
  const pattern = /<!--\s*\[entry:([^\s]+)\s+rev:(\d+)(?:\s+data:([A-Za-z0-9+/=]+))?\]\s*-->/g
  const results: ReconstructedMemorySnapshotEntry[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const id = match[1]
    if (id === undefined) continue
    const revision = Number(match[2])
    const b64 = match[3]
    if (b64) {
      try {
        const decoded = Buffer.from(b64, 'base64').toString('utf8')
        results.push({ id, revision, text: decoded })
      } catch {
        // ignore corrupted data
      }
    } else {
      const afterMatch = text.slice(pattern.lastIndex)
      const bulletMatch = /^\s*\n-\s*([^\n]+)/.exec(afterMatch)
      if (bulletMatch) {
        results.push({ id, revision, text: bulletMatch[1] ?? '' })
      }
    }
  }
  return results
}

/**
 * Formats active memory entries into a bounded system prompt section string.
 * Each entry carries entry identity and revision metadata for stable transcript reconstruction.
 * @param memories - active memory entries.
 * @param options - optional formatting and bounds configuration.
 * @returns formatted section text or empty string if no memories.
 */
export function formatAssistantMemoryText(memories: readonly MemoryEntry[], options?: MemoryFormatOptions): string {
  if (memories.length === 0) return ''
  const maxEntries = options?.maxEntries ?? MEMORY_SNAPSHOT_MAX_ENTRIES
  const maxBytes = options?.maxBytes ?? MEMORY_SNAPSHOT_MAX_BYTES

  const entriesToFormat = memories.slice(0, maxEntries)
  const heading = '### Persistent Memory'
  const lines: string[] = [heading]
  let currentBytes = Buffer.byteLength(heading, 'utf8')

  for (const m of entriesToFormat) {
    const b64 = Buffer.from(m.text, 'utf8').toString('base64')
    const meta = `<!-- [entry:${m.id} rev:${m.revision} data:${b64}] -->`
    const escapedText = m.text.replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;')
    const line = `${meta}\n- ${escapedText}`
    const lineBytes = Buffer.byteLength(`\n${line}`, 'utf8')
    if (currentBytes + lineBytes > maxBytes) {
      break
    }
    lines.push(line)
    currentBytes += lineBytes
  }

  if (lines.length <= 1) return ''
  return lines.join('\n')
}

/**
 * Installs dynamic memory injection for all assistant-bound and seat-bound agents.
 *
 * @param ctx - Cordis context.
 * @param assistants - Assistant service owning catalog and memory state.
 * @returns Disposer function and maybeInstall hook.
 */
export function installMemoryInjection(
  ctx: Context,
  assistants: AssistantService,
): {
  dispose: () => void
  maybeInstall: (agent: Agent) => void
} {
  const installed = new Map<Agent['id'], () => void>()

  const maybeInstall = (agent: Agent): void => {
    if (installed.has(agent.id) || !assistants.isAssistantBound(agent.id)) return

    const disposeSection = agent.ctx.systemPrompt.section({
      name: `assistant:memory:${agent.id}`,
      order: ASSISTANT_MEMORY_SECTION_ORDER,
      text: () => {
        // 1. Check live seat / team binding FIRST (team member or coordinator)
        const seat = assistants.getSeatBySessionSync(agent.id)
        const teamId = seat?.teamId ?? assistants.getTeamIdBySessionSync(agent.id)
        if (teamId) {
          const teamMems = assistants.listMemorySync({
            kind: 'team',
            teamId,
          })
          const grantedProfileMems = assistants.listGrantedProfileMemoriesSync(teamId, seat?.profileId)
          return formatAssistantMemoryText([...teamMems, ...grantedProfileMems])
        }

        // 2. Check conversation binding (private assistant)
        const currentConv = assistants.getConversationBySessionSync(agent.id)
        if (currentConv) {
          const memories = assistants.listMemorySync({
            kind: 'profile',
            profileId: currentConv.profileId,
          })
          return formatAssistantMemoryText(memories)
        }

        return ''
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
