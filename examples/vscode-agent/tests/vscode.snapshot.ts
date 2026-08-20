/** Real vscode-profile snapshot over the bounded Node IPC carrier. */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeSessionLog, scrubRequestHeaders } from '@deepseek-ai/dsh-acp-snapshot'
import { MAX_WIRE_RECORD_BYTES } from '@deepseek-ai/dsh-client-connection-vscode/protocol'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { launchVsCodeIpc, VsCodeIpcStartupError } from './fixtures/ipc-driver.ts'

const testsDir = new URL('.', import.meta.url)
const patchFile = new URL('../cordis.snapshot.yml', testsDir)
const fixtureFile = new URL('./snapshots/vscode/session.jsonl', testsDir)
const imageFile = new URL('../../acp-agent/tests/snapshots/read-image/workspace/red.png', testsDir)
const expectedBridgeFile = new URL('./snapshots/vscode/bridge.expected.json', testsDir)
const expectedSessionFile = new URL('./snapshots/vscode/session.expected.jsonl', testsDir)

const EDITOR_PROMPT = 'Review this captured selection and reply with the requested confirmation.\n\n'
  + '<ide_context kind="selection" uri="file:///workspace/src/main.ts" path="src/main.ts" '
  + 'language="typescript" version="7" range="2:1-2:18">\n'
  + 'const answer = 42\n'
  + '</ide_context>'

async function sessionLog(root: string): Promise<string> {
  const entries = await readdir(root, { recursive: true })
  const logs = entries.filter(entry => entry.endsWith('.jsonl'))
  if (logs.length !== 1 || logs[0] === undefined) {
    throw new Error(`expected one persisted VS Code session, found ${String(logs.length)}`)
  }
  return readFile(join(root, logs[0]), 'utf8')
}

async function compareOrRefresh(path: URL, content: string): Promise<void> {
  if (process.env.DSH_SNAPSHOT === 'refresh') {
    await writeFile(path, content)
    return
  }
  if (!existsSync(path)) throw new Error(`missing expected snapshot ${path.pathname}`)
  expect(content).toBe(await readFile(path, 'utf8'))
}

describe('vscode assembled snapshot', () => {
  it('boots, fragments an image prompt with editor context, streams, and persists exact text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-vscode-snapshot-'))
    const workspaceRoot = join(root, 'workspace')
    const dshHome = join(root, '.dsh')
    await mkdir(join(workspaceRoot, 'src'), { recursive: true })
    await writeFile(join(workspaceRoot, 'src', 'main.ts'), 'export const answer = 42\n')
    const launched = await launchVsCodeIpc({ workspaceRoot, dshHome, patchFile, fixtureFile })
    try {
      const created = await launched.api.sessions.create({
        cwd: workspaceRoot,
        sessionId: SessionId('vscode-snapshot'),
      })
      if (!created.result.ok) throw new Error(created.result.error.message)
      const streamAbort = new AbortController()
      const opened = Promise.withResolvers<undefined>()
      const frames: { type: string; eventType?: string; chunkType?: string }[] = []
      const consuming = (async () => {
        for await (const envelope of launched.api.events.mux({}, streamAbort.signal, () => { opened.resolve(undefined) })) {
          const frame = envelope.payload
          frames.push({
            type: frame.type,
            ...(frame.type === 'session/event' ? { eventType: frame.event.type } : {}),
            ...(frame.type === 'session/event'
              && frame.event.type === 'assistant/chunk'
              ? { chunkType: frame.event.data.chunk.type }
              : {}),
          })
          if (frame.type === 'session/event'
            && frame.sessionId === 'vscode-snapshot'
            && frame.event.type === 'turn/end') break
        }
      })()
      await opened.promise

      const png = await readFile(imageFile)
      const oversizedPng = Buffer.concat([png, Buffer.alloc(300 * 1024)])
      const prompted = await launched.api.sessions.prompt({
        sessionId: created.result.value.sessionId,
        mode: 'queue',
        content: [
          { type: 'text', text: EDITOR_PROMPT },
          { type: 'image', mediaType: 'image/png', data: oversizedPng.toString('base64'), name: 'selection.png' },
        ],
      })
      if (!prompted.result.ok) throw new Error(prompted.result.error.message)
      await consuming
      streamAbort.abort()

      const rawSession = await sessionLog(join(dshHome, 'sessions'))
      const lines = rawSession.trimEnd().split('\n').map(line => JSON.parse(line) as {
        type: string
        data?: { content?: Array<{ type?: string; text?: string }> }
      })
      const userText = lines
        .filter(line => line.type === 'user/message')
        .flatMap(line => line.data?.content ?? [])
        .find(block => block.type === 'text')?.text
      expect(userText).toBe(EDITOR_PROMPT)
      expect(launched.outboundRecords.some(record => record.type === 'wire/chunk-start')).toBe(true)
      expect(Math.max(...launched.outboundRecords.map(record => Buffer.byteLength(JSON.stringify(record)))))
        .toBeLessThanOrEqual(MAX_WIRE_RECORD_BYTES)

      const bridge = `${JSON.stringify({
        ready: {
          protocolVersion: launched.ready.protocolVersion,
          runtimeVersion: launched.ready.runtimeVersion,
          maxLogicalRpcBytes: launched.ready.maxLogicalRpcBytes,
          graph: launched.ready.graph.entries.map(entry => ({
            id: entry.id,
            ...(entry.inject === undefined ? {} : { inject: entry.inject }),
            ...(entry.immediately === true ? { immediately: true } : {}),
          })),
          bundleIds: launched.ready.bundles.map(bundle => bundle.id),
        },
        carrier: {
          outboundFragmentStarts: launched.outboundRecords.filter(record => record.type === 'wire/chunk-start').length,
          outboundChunks: launched.outboundRecords.filter(record => record.type === 'wire/chunk').length,
        },
        rpc: { sessionId: created.result.value.sessionId, promptAccepted: prompted.result.value.accepted },
        stream: frames,
        persistedUserText: userText,
      }, null, 2)}\n`
      const normalizedSession = `${scrubRequestHeaders(normalizeSessionLog(rawSession, {
        sessionIds: ['vscode-snapshot'],
        cwd: workspaceRoot,
      })).trimEnd()}\n`
      await compareOrRefresh(expectedBridgeFile, bridge)
      await compareOrRefresh(expectedSessionFile, normalizedSession)
    } finally {
      await launched.close()
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)

  it('rejects a second companion on the same Harness home before profile boot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-vscode-concurrency-'))
    const workspaceRoot = join(root, 'workspace')
    const dshHome = join(root, '.dsh')
    await mkdir(workspaceRoot, { recursive: true })
    const first = await launchVsCodeIpc({ workspaceRoot, dshHome, patchFile, fixtureFile })
    try {
      const second = launchVsCodeIpc({ workspaceRoot, dshHome, patchFile, fixtureFile })
      await expect(second).rejects.toMatchObject({ code: 'home-busy' } satisfies Partial<VsCodeIpcStartupError>)
    } finally {
      await first.close()
      expect(existsSync(join(dshHome, '.locks', 'vscode-companion.lock'))).toBe(false)
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})
