/** Replay an authenticated human delivery through the real dsh CLI and tenant stdio protocol. */
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { parseSessionLog, prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay'
import { fixtureContext, normalizeSessionSnapshots, normalizedSystemPrompts, normalizedToolSchemas,
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, parseSnapshotManifest, sessionFixtureNames,
  sessionFixtureName, sessionHeaderVersion, tokenizeSessionFixtureCwd, scrubSessionSnapshot,
  redactSessionSnapshotIds, stabilizeFixtureMessageIds, stabilizeRefreshLog, refreshFixtureReplacements,
} from '@deepseek-ai/dsh-session-snapshot'
import { ipcServerMessageSchema, type IpcClientMessage, type IpcServerMessage } from '@deepseek-ai/dsh-experimental-im-feishu'

type WithoutId<T> = T extends { id: string } ? Omit<T, 'id'> : never

const repo = fileURLToPath(new URL('../../', import.meta.url))
const scenario = fileURLToPath(new URL('./human-turn/', import.meta.url))

function fixtureHeader(raw: string): { id: string; createdAt: number } {
  const value: unknown = JSON.parse(raw.split('\n')[0]!)
  if (value === null || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string'
    || !('createdAt' in value) || typeof value.createdAt !== 'number') throw new Error('Invalid IM Session header')
  return { id: value.id, createdAt: value.createdAt }
}

async function sessionFiles(dir: string): Promise<string[]> {
  const nested = await Promise.all((await readdir(dir, { withFileTypes: true })).map(async entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sessionFiles(path)
    return entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return nested.flat()
}

it.skipIf(process.env.DSH_SNAPSHOT === 'record')('IM human turn preserves user source and minted request correlation through real CLI persistence', async () => {
  if (process.env.DSH_SNAPSHOT && !['replay', 'refresh'].includes(process.env.DSH_SNAPSHOT)) {
    throw new Error('Unknown IM snapshot mode')
  }
  const manifest = parseSnapshotManifest(await readFile(join(scenario, 'snapshot.yml'), 'utf8'))
  expect(manifest.profile).toBe('headless')
  const selected = sessionFixtureNames(await readdir(scenario))
  expect(selected).toHaveLength(1)
  const fixtureFile = join(scenario, selected[0]!)
  let fixture = await readFile(fixtureFile, 'utf8')
  const prompt = parseSessionLog(fixture).find(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (prompt?.type !== 'user/message') throw new Error('IM fixture must own one human prompt')
  const text = prompt.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-im-snapshot-')))
  const cwd = join(root, 'workspace')
  for (const part of ['home', 'os-home', 'workspace', 'state']) await mkdir(join(root, part), { mode: 0o700 })
  const patches = [
    { id: 'headless-startup', disabled: true }, { id: 'headless-runner', disabled: true },
    { id: 'llm-deepseek', disabled: true }, { id: 'plugin-package-inventory-deepseek', disabled: true },
    { id: 'session-title-llm', disabled: true },
    { id: 'session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
    { insert: [
      { id: 'im-model-replay', name: join(repo, 'packages/test-support/llm-replay/src/index.ts'),
        config: { file: fixtureFile, providers: [{ id: 'deepseek-official', models: [{ id: 'deepseek-v4-flash' }] }] } },
      { id: 'im-runtime', name: join(repo, 'packages/experimental/im-feishu/src/runtime-plugin.ts'), config: {
        tenantId: 'snapshot-tenant', operatorIds: ['snapshot-operator'], stateDirectory: join(root, 'state'), cwd,
        useSystemdStdio: true, modelSelection: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      } },
    ] },
  ]
  const patch = join(root, 'im.patch.yml')
  await writeFile(patch, JSON.stringify(patches), { mode: 0o600 })
  const child = spawn(process.execPath, [
    '--import', import.meta.resolve('tsx/esm'), join(repo, 'apps/cli/src/bin.ts'),
    '--profile', 'headless', '--patch', patch,
  ], { cwd, env: {
    PATH: process.env.PATH, HOME: join(root, 'os-home'), TMPDIR: process.env.TMPDIR,
    TSX_TSCONFIG_PATH: join(repo, 'tsconfig.base.json'), DSH_HOME: join(root, 'home'),
    DSH_TELEMETRY_DISABLED: '1', NO_PROXY: '*',
  }, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
  const pending = new Map<string, { resolve: (value: IpcServerMessage) => void; reject: (error: Error) => void }>()
  let sequence = 0
  const fail = (error: Error): void => { for (const entry of pending.values()) entry.reject(error); pending.clear() }
  const lines = createInterface({ input: child.stdout })
  lines.on('line', line => {
    try {
      const message = ipcServerMessageSchema.parse(JSON.parse(line))
      const entry = pending.get(message.id)
      if (!entry) throw new Error(`Unsolicited IM protocol response ${message.id}`)
      pending.delete(message.id)
      if (message.type === 'error') entry.reject(new Error(`${message.code}: ${message.message}`))
      else entry.resolve(message)
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
  })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('exit', (code, signal) => {
      fail(new Error(`IM CLI exited ${code}/${signal}: ${stderr}`))
      resolve({ code, signal })
    })
  })
  child.once('error', error => { fail(error) })
  const request = (fields: WithoutId<IpcClientMessage>): Promise<IpcServerMessage> => {
    const id = String(++sequence)
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ id, ...fields })}\n`)
    })
  }
  const deadline = setTimeout(() => { fail(new Error(`IM snapshot deadline: ${stderr}`)); child.kill('SIGTERM') }, 45000)
  try {
    expect((await request({ type: 'init', protocolVersion: 1, ingressId: 'snapshot-ingress', targetTenantId: 'snapshot-tenant' })).type).toBe('init_ack')
    const deliveryKey = JSON.stringify(['feishu', 'snapshot-app', 'snapshot-org', 'snapshot-chat', 'snapshot-sender', 'snapshot-event'])
    const requestId = randomUUID()
    const admission = await request({ type: 'submit_delivery', deliveryKey, requestId,
      operatorId: 'snapshot-operator', prompt: text, sessionId: null })
    expect(admission.type).toBe('submit_delivery_ack')
    await expect.poll(async () => {
      const response = await request({ type: 'get_delivery', deliveryKey })
      if (response.type !== 'get_delivery_ack') throw new Error('Unexpected delivery response')
      if (response.reconciliation.state === 'admitted') return undefined
      expect(response.reconciliation).toMatchObject({ state: 'completed', resultText: 'PONG' })
      return response.reconciliation.state
    }, { timeout: 15000, interval: 30 }).toBe('completed')
    child.stdin.end()
    const outcome = await exited
    expect(outcome).toEqual({ code: 0, signal: null })
    const files = await sessionFiles(join(root, 'sessions'))
    expect(files).toHaveLength(1)
    const actual = await readFile(files[0]!, 'utf8')
    const human = parseSessionLog(actual).flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
      ? [event.data] : [])
    expect(human).toHaveLength(1)
    expect(human[0]?.source).toEqual({ kind: 'user', rpcId: requestId })
    const context = fixtureContext(actual)
    const prompts = normalizedSystemPrompts(actual, context)
    const tools = normalizedToolSchemas(actual, context)
    expect(prompts).toHaveLength(1)
    expect(tools).toHaveLength(1)
    if (process.env.DSH_SNAPSHOT === 'refresh') {
      const header = fixtureHeader(actual)
      const replacements = refreshFixtureReplacements([{ ...header, content: actual }], [fixture])
      const stable = tokenizeSessionFixtureCwd(stabilizeRefreshLog(actual, fixture, replacements, context))
      const fresh = scrubSessionSnapshot(prepareSessionSnapshotFixtureForComparison(stable))
      fixture = redactSessionSnapshotIds(stabilizeFixtureMessageIds([fresh], [fixture]))[0]!
      await writeFile(join(scenario, sessionFixtureName(0, sessionHeaderVersion(actual, 'IM writer'))), fixture)
      await writeFile(join(scenario, 'system-prompt.expected.md'), formatSystemPromptSnapshot(prompts[0]!))
      await writeFile(join(scenario, 'tool-schemas.expected.json'), formatToolSchemasSnapshot(tools[0]!))
    }
    expect(normalizeSessionSnapshots([actual], context, { nativeWriterOutput: true }))
      .toEqual(normalizeSessionSnapshots([fixture], fixtureContext(fixture), { nativeWriterOutput: true }))
    expect(formatSystemPromptSnapshot(prompts[0]!)).toBe(await readFile(join(scenario, 'system-prompt.expected.md'), 'utf8'))
    expect(formatToolSchemasSnapshot(tools[0]!)).toBe(await readFile(join(scenario, 'tool-schemas.expected.json'), 'utf8'))
  } finally {
    child.stdin.end()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    const force = setTimeout(() => { child.kill('SIGKILL') }, 3000)
    await exited
    clearTimeout(force)
    clearTimeout(deadline)
    lines.close()
    await rm(root, { recursive: true, force: true })
  }
}, 60000)
