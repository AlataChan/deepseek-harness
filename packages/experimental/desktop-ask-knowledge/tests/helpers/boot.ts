/** Shared overlay test boot: fake sidecar, in-memory sessions, stub prompt. */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import DesktopAskKnowledge from '../../src/index.ts'
import { installFakeSidecar } from './install-sidecar.ts'

/** Recorded system-prompt section. */
export interface RecordedSection {
  readonly name: string
  readonly text: string | ((context: { agent?: { session: object } }) => string)
}

/** Overlay test root. */
export interface OverlayBoot {
  readonly ctx: Context
  readonly root: string
  readonly sidecarHome: string
  readonly fiber: { dispose(): Promise<void> }
  readonly sections: Map<string, RecordedSection>
}

interface ProjectionDef {
  readonly key: string
  init: (header: unknown) => unknown
  apply: (state: unknown, event: SessionEvent) => unknown
}

/**
 * Start the overlay with a fake sidecar. Sessions and projections are
 * in-memory so tests do not wait on SessionStore / SessionProjectionRegistry.
 * @param options - tools / credentials.
 * @returns the live context.
 */
export async function bootOverlay(options: {
  sessions?: boolean
  tools?: boolean
  credentials?: { resolve(): Promise<{ value: string } | undefined> }
} = {}): Promise<OverlayBoot> {
  const root = await mkdtemp(join(tmpdir(), 'ask-knowledge-boot-'))
  const sidecarHome = join(root, 'sidecar')
  await installFakeSidecar(sidecarHome)
  const ctx = new Context()
  const sections = new Map<string, RecordedSection>()
  ctx.provide('systemPrompt', {
    section: (spec: RecordedSection) => {
      sections.set(spec.name, spec)
      return () => {
        sections.delete(spec.name)
      }
    },
    tools: () => () => {},
    assemble: async (context: { agent?: { session: object } }) => ({
      sections: [...sections.values()].map(spec => ({
        name: spec.name,
        text: typeof spec.text === 'function' ? spec.text(context) : spec.text,
      })),
    }),
  })
  if (options.sessions !== false) {
    const byId = new Map<string, Session>()
    const defs: ProjectionDef[] = []
    ctx.provide('sessions', {
      prepare: (id?: SessionId) => Session.create(id ?? SessionId(`s-${byId.size}`)),
      enter: (session: Session) => {
        byId.set(session.id, session)
        return () => {
          byId.delete(session.id)
        }
      },
      announce: () => {},
      get: (id: SessionId) => byId.get(id),
      list: () => [...byId.values()],
    })
    ctx.provide('sessionProjections', {
      register: (definition: ProjectionDef) => {
        defs.push(definition)
        return () => {
          const index = defs.indexOf(definition)
          if (index >= 0) defs.splice(index, 1)
        }
      },
      stateOf: (session: Session, key: string) => {
        const definition = defs.find(item => item.key === key)
        if (definition === undefined) return undefined
        let state = definition.init(session.header)
        for (const event of session.snapshotEvents()) state = definition.apply(state, event)
        return state
      },
    })
  } else {
    ctx.provide('sessionProjections', {
      register: () => () => {},
      stateOf: () => null,
    })
  }
  if (options.tools === true) {
    const toolsFiber = ctx.plugin(ToolRuntime)
    await toolsFiber
  }
  if (options.credentials !== undefined) ctx.provide('credentials', options.credentials)
  const fiber = ctx.plugin(DesktopAskKnowledge, {
    knowledgeHome: root,
    sidecarRuntimePath: sidecarHome,
  })
  await fiber.await()
  return { ctx, root, sidecarHome, fiber, sections }
}
