/** With-key first-ask. Self-skips without a key or a usable Python sidecar. */

import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { sidecarScriptPath } from '../src/sidecar.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'
import { resolveProposeEnv } from '../src/credentials-bridge.ts'
import { bootOverlay } from './helpers/boot.ts'

const python = process.env.ASK_KNOWLEDGE_PYTHON ?? 'python3'
const yamlReady = spawnSync(python, ['-c', 'import yaml'], { encoding: 'utf8' }).status === 0
const sidecarProbe = spawnSync(python, [sidecarScriptPath], {
  encoding: 'utf8',
  input: `${JSON.stringify({ command: 'self-test' })}\n`,
  env: { ...process.env, DEEPSEEK_API_KEY: undefined },
})
const pythonReady = yamlReady
  && sidecarProbe.status === 0
  && sidecarProbe.stdout.includes('"ok": true')

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

describe('ask-knowledge first-ask with LLM', () => {
  it.skipIf((process.env.DEEPSEEK_API_KEY?.trim() ?? '') === '' || !pythonReady)(
    'runs a real propose when the credentials store has a key',
    async () => {
      const fromEnv = process.env.DEEPSEEK_API_KEY!.trim()
      const previous = process.env.DEEPSEEK_API_KEY
      delete process.env.DEEPSEEK_API_KEY
      cleanups.push(() => {
        if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
        else process.env.DEEPSEEK_API_KEY = previous
      })
      const started = await bootOverlay({
        sessions: true,
        credentials: { resolve: async () => ({ value: fromEnv }) },
      })
      cleanups.push(() => started.fiber.dispose())
      await installPythonSidecar(started.sidecarHome)
      const env = await resolveProposeEnv(started.ctx)
      expect(env.DEEPSEEK_API_KEY).toBe(fromEnv)
      const library = await started.ctx.askKnowledge.createLibrary({ displayName: 'LLM 烟测' })
      const handle = await started.ctx.askKnowledge.beginIngest({
        libraryId: library.id,
        filename: '报销.md',
      })
      await started.ctx.askKnowledge.appendIngestChunk({
        handle,
        bytes: Buffer.from('# 报销\n\n出差报销需要发票。\n', 'utf8').toString('base64'),
      })
      const ingested = await started.ctx.askKnowledge.finishIngest({ handle })
      expect(['applied', 'deferred', 'failed']).toContain(ingested.status)
      const session = started.ctx.sessions.prepare(SessionId('llm-ask'))
      started.ctx.sessions.enter(session)
      started.ctx.sessions.announce(session)
      await started.ctx.askKnowledge.attach({ libraryId: library.id, sessionId: session.id })
      if (ingested.status === 'applied') {
        const bundle = await started.ctx.askKnowledge.retrieveBundle({
          libraryId: library.id,
          terms: ['报销'],
        })
        expect(bundle.items.length).toBeGreaterThan(0)
      }
    },
    120_000,
  )
})
