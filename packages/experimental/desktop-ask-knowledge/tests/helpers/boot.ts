/** Shared overlay test boot: fake sidecar, in-memory sessions, stub prompt. */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import DesktopAskKnowledge from '../../src/index.ts'
import { installFakeSidecar, installPythonSidecar } from './install-sidecar.ts'

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

/**
 * Start the overlay with a fake or Python sidecar. Sessions and projections are
 * real in-memory providers, without a persistence backend.
 * @param options - tools / credentials / python sidecar.
 * @returns the live context.
 */
export async function bootOverlay(options: {
  sessions?: boolean
  tools?: boolean
  pythonSidecar?: boolean
  credentials?: { resolve(): Promise<{ value: string } | undefined> }
} = {}): Promise<OverlayBoot> {
  const root = await mkdtemp(join(tmpdir(), 'ask-knowledge-boot-'))
  const sidecarHome = join(root, 'sidecar')
  if (options.pythonSidecar) {
    await installPythonSidecar(sidecarHome)
  } else {
    await installFakeSidecar(sidecarHome)
  }
  const ctx = new Context()
  const sections = new Map<string, RecordedSection>()
  ctx.provide('systemPrompt', {
    getSectionOrder: () => 0,
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
  if (options.sessions !== false) await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
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
