#!/usr/bin/env node
/**
 * S20 Installed-Profile Acceptance Verification Suite.
 *
 * Drives the packaged application extracted/mounted from dist/octopus_DSH.dmg
 * through the real Node companion, real carrier wire protocol, and real Typert RPC.
 *
 * Flow 1: Fresh profile lifecycle
 *   - Clean boot with uninitialized profile & workspace
 *   - Assistant profile creation & conversation binding
 *   - Model route selection and conversation override
 *   - Explicit memory save, CAS revision update, and bounded snapshot formatting
 *   - Memory recall verification via assistants/recallMemory
 *   - Controlled request submission via session/prompt through packaged runtime
 *   - Resolved model inspection via session/projections
 *   - Logged user prompt and role/memory snapshot inspection via session/page
 *   - Cold restart of companion and verification of state recovery
 *   - Historical user prompt preservation in session history after restart
 *   - Memory archive -> active recall exclusion -> unarchive restoration
 *   - Memory removal -> active recall exclusion -> fresh-topic prompt injection exclusion
 *   - Retained historical conversation transcript preservation
 *
 * Flow 2: Copied existing profile lifecycle
 *   - Sanitized pre-existing profile fixture with prior persisted catalog and state
 *   - Profile upgrade/seeding with bundled desktop plugins
 *   - Packaged cold boot recovering pre-existing profile, conversation, and memory
 *   - Blank team & template team creation parity (coordinator seat)
 *   - Team shared memory and scoped grant verification
 *   - Cold restart and verification of persistence across reboots
 */

import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { strict as assert } from 'node:assert'
import { constants, zstdCompressSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DMG_PATH = resolve(process.argv[2] ?? join(REPO_ROOT, 'dist', 'octopus_DSH.dmg'))

let passCount = 0
let failCount = 0

function ok(msg) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
  passCount++
}

function fail(msg, err) {
  console.error(`  \x1b[31m✗\x1b[0m ${msg}`, err ?? '')
  failCount++
  throw new Error(msg)
}

/** Assert remote rejection separately from assertions so successful calls cannot self-reject. */
export async function assertRejected(operation, pattern) {
  let error
  try { await operation() } catch (caught) { error = caught }
  assert(error instanceof Error, 'Operation unexpectedly succeeded')
  assert.match(error.message, pattern)
}

/** Hang only the current owned cancellation input, excluding history and auxiliary context. */
export function isOwnedHangRequest(payload) {
  const latestUser = payload.messages?.findLast(message => message.role === 'user')
  const latestUserTexts = typeof latestUser?.content === 'string' ? [latestUser.content]
    : latestUser?.content?.filter(block => block.type === 'text').map(block => block.text) ?? []
  return latestUserTexts.some(text => /(?:^|\n)STAGE_C_HANG_OWNED_REQUEST$/.test(text))
}

/** Bounded positive polling; absent evidence fails rather than passing an empty result. */
async function waitForEvidence(read, test, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  do {
    const value = await read()
    if (test(value)) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  } while (Date.now() < deadline)
  throw new Error(`Timed out awaiting ${label}`)
}

/** Local Messages-protocol provider; only synthetic isolated-profile credentials are used. */
async function startSyntheticProvider() {
  const observations = []
  const openResponses = new Set()
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    let payload
    try { payload = JSON.parse(body) } catch { response.writeHead(400).end(); return }
    const observation = { payload, text: `STAGE_C_REPLY_${observations.length + 1}`, closed: false }
    observations.push(observation)
    openResponses.add(response)
    response.on('close', () => { observation.closed = true; openResponses.delete(response) })
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const event = value => response.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`)
    event({ type: 'message_start', message: { id: `synthetic-${observations.length}`, type: 'message', role: 'assistant', model: payload.model, content: [], usage: { input_tokens: 14, output_tokens: 0 } } })
    observation.hanging = isOwnedHangRequest(payload)
    if (observation.hanging) return
    event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: observation.text } })
    event({ type: 'content_block_stop', index: 0 })
    event({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } })
    event({ type: 'message_stop' })
    response.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    baseURL: `http://127.0.0.1:${server.address().port}`,
    observations,
    async close() {
      for (const response of openResponses) response.destroy()
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

let syntheticProvider
const activeClients = new Set()
const temporaryPaths = new Set()

function section(title) {
  console.log(`\n\x1b[1;34m=== ${title} ===\x1b[0m`)
}

function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out
}

function assertPositivePromptAndSnapshot(records, expectedRole, expectedMemText, expectedEntryId, expectedRevision, expectedModel) {
  if (!Array.isArray(records)) {
    throw new Error('History page records array is absent or invalid')
  }
  const userMsgRecord = records.find(r => r.event?.type === 'user/message')
  if (!userMsgRecord) {
    throw new Error('Required user/message event is absent from session history')
  }

  const sysMsgRecord = records.find(r => r.event?.type === 'system/message')
  if (!sysMsgRecord) {
    throw new Error('Required system/message event is absent from session history')
  }
  const sysDataStr = JSON.stringify(sysMsgRecord.event.data)
  if (!sysDataStr.includes(expectedRole)) {
    throw new Error(`System message does not contain expected assistant role '${expectedRole}'`)
  }
  if (!sysDataStr.includes(expectedMemText)) {
    throw new Error(`System message does not contain expected memory text '${expectedMemText}'`)
  }
  const expectedMarkerTag = `entry:${expectedEntryId} rev:${expectedRevision}`
  if (!sysDataStr.includes(expectedMarkerTag)) {
    throw new Error(`System message does not contain expected memory marker metadata '${expectedMarkerTag}'`)
  }

  const headerRecord = records.find(r => r.event?.type === 'request/header')
  if (!headerRecord) {
    throw new Error('Required request/header event is absent from session history')
  }
  const headerStr = JSON.stringify(headerRecord.event.data)
  if (!headerStr.includes(expectedModel)) {
    throw new Error(`Actual request/header does not contain overridden model '${expectedModel}'`)
  }
}

function assertNewTopicMemoryExclusion(records, expectedRole, excludedMemText, excludedEntryId) {
  if (!Array.isArray(records)) {
    throw new Error('New topic history records array is absent or invalid')
  }
  const userMsgRecord = records.find(r => r.event?.type === 'user/message')
  if (!userMsgRecord) {
    throw new Error('New topic prompt has not assembled user/message record')
  }
  const sysMsgRecord = records.find(r => r.event?.type === 'system/message')
  if (!sysMsgRecord) {
    throw new Error('Required system/message event was not assembled on new topic prompt')
  }
  const headerRecord = records.find(r => r.event?.type === 'request/header')
  if (!headerRecord) {
    throw new Error('New topic prompt has not assembled request/header record')
  }
  const sysDataStr = JSON.stringify(sysMsgRecord.event.data)
  if (!sysDataStr.includes(expectedRole)) {
    throw new Error(`New topic system message does not contain expected role '${expectedRole}'`)
  }
  if (sysDataStr.includes(excludedMemText)) {
    throw new Error(`Removed memory text '${excludedMemText}' was unexpectedly injected into new topic prompt`)
  }
  if (sysDataStr.includes(excludedEntryId)) {
    throw new Error(`Removed memory entry ID '${excludedEntryId}' was unexpectedly injected into new topic prompt`)
  }
}

class CompanionClient {
  constructor(appPath, homeDir, workspaceDir) {
    this.appPath = appPath
    this.homeDir = homeDir
    this.workspaceDir = workspaceDir
    this.resDir = join(appPath, 'Contents', 'Resources', 'resources')
    this.nodeBin = join(this.resDir, 'node')
    this.companionJs = join(this.resDir, 'harness', 'lib', 'desktop-companion.js')
    this.dshHome = join(homeDir, '.dsh')
    this.profileDir = join(this.dshHome, 'profiles', 'desktop')
    this.child = null
    this.pendingRpcs = new Map()
    this.nextRpcId = 1
    this.readyResolve = null
    this.readyPromise = null
  }

  seedProfilePlugins() {
    const pluginRes = join(this.resDir, 'profile-plugins')
    const seedScript = join(REPO_ROOT, 'scripts', 'seed-desktop-profile-plugin.mjs')
    const pin = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts', 'desktop-profile-plugins.json'), 'utf8'))
    for (const p of pin.plugins) {
      const pDir = join(pluginRes, p.name)
      if (existsSync(pDir)) {
        console.log(`    seeding desktop plugin: ${p.name}`)
        execFileSync(this.nodeBin, [seedScript, 'install', '--from', pDir, '--profile-dir', this.profileDir], {
          stdio: 'ignore',
        })
      }
    }
  }

  start() {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve
    })

    const env = {
      ...process.env,
      HOME: this.homeDir,
      DSH_HOME: this.dshHome,
      OCTOPUS_APP_DATA: join(this.workspaceDir, '.app-data'),
      OCTOPUS_SIDECAR_HOME: join(this.resDir, 'kb-runtime'),
    }
    env.DEEPSEEK_API_KEY = 'installed-acceptance-synthetic-local-key'
    // The profile is isolated under a temporary HOME; override only test deployment config.
    mkdirSync(this.profileDir, { recursive: true })
    writeFileSync(join(this.profileDir, 'cordis.patch.yml'), `- id: llm-deepseek\n  config:\n    baseURL: '${syntheticProvider.baseURL}'\n    thinking: disabled\n    retryPolicy:\n      mode: normal\n      maxRetries: 0\n- id: assistant-registry\n  config:\n    enableComposerPredictions: true\n    enableMemoryReview: false\n`)
    activeClients.add(this)

    this.child = spawn(this.nodeBin, [this.companionJs, '--workspace-root', this.workspaceDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })

    let stdoutBuf = ''
    this.child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf8')
      let idx
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx)
        stdoutBuf = stdoutBuf.slice(idx + 1)
        if (!line.trim()) continue
        this.handleLine(line)
      }
    })

    this.child.stderr.on('data', (d) => {
      process.stderr.write(d)
    })

    this.child.on('exit', (code) => {
      if (this.readyResolve) {
        this.readyResolve(Promise.reject(new Error(`Companion exited before ready (code: ${code})`)))
        this.readyResolve = null
      }
    })

    // Send control/hello
    this.sendFrame({
      type: 'control/hello',
      protocolVersion: 2,
      extensionVersion: '0.1.2',
      workspaceRoot: this.workspaceDir,
      locale: 'zh',
    })

    return this.readyPromise
  }

  handleLine(line) {
    try {
      const rec = JSON.parse(line)
      if (rec.type !== 'wire/message' || typeof rec.encoded !== 'string') return
      const frame = JSON.parse(rec.encoded)
      if (frame.type === 'control/ready') {
        if (this.readyResolve) {
          this.readyResolve(frame)
          this.readyResolve = null
        }
      } else if (frame.type === 'rpc/message') {
        const msg = frame.message
        if (msg && msg.type === 'server-response') {
          const waiter = this.pendingRpcs.get(msg.rpcId)
          if (waiter) {
            this.pendingRpcs.delete(msg.rpcId)
            waiter.resolve(msg.result)
          }
        }
      }
    } catch {}
  }

  sendFrame(frame) {
    const wire = JSON.stringify({ type: 'wire/message', encoded: JSON.stringify(frame) })
    this.child.stdin.write(`${wire}\n`)
  }

  async call(method, argsObj = {}) {
    const rpcId = `rpc-${this.nextRpcId++}`
    const rpc = {
      type: 'rpc/message',
      message: {
        type: 'client-request',
        rpcId,
        method,
        payload: { args: argsObj },
      },
    }
    const promise = new Promise((resolve, reject) => {
      this.pendingRpcs.set(rpcId, { resolve, reject })
      setTimeout(() => {
        if (this.pendingRpcs.has(rpcId)) {
          this.pendingRpcs.delete(rpcId)
          reject(new Error(`RPC timeout for ${method} (${rpcId})`))
        }
      }, 15000)
    })
    this.sendFrame(rpc)
    const result = await promise
    if (!result.ok) {
      throw new Error(`RPC ${method} failed: ${result.error?.message ?? JSON.stringify(result.error)}`)
    }
    return result.value
  }

  async stop() {
    const child = this.child
    if (!child) return
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve, reject) => {
        const timers = [
          setTimeout(() => child.kill('SIGTERM'), 4000),
          setTimeout(() => child.kill('SIGKILL'), 6000),
          setTimeout(() => finish(new Error('Companion did not exit during bounded shutdown')), 9000),
        ]
        const finish = error => {
          for (const timer of timers) clearTimeout(timer)
          if (error) reject(error)
          else resolve()
        }
        child.once('exit', () => finish())
        child.once('error', finish)
        try { this.sendFrame({ type: 'control/shutdown' }) } catch (error) { finish(error) }
      })
    }
    this.child = null
    activeClients.delete(this)
  }

}

async function runVerification() {
  syntheticProvider = await startSyntheticProvider()
  console.log(`Mounting DMG: ${DMG_PATH}`)
  try {
    execFileSync('hdiutil', ['detach', DMG_PATH, '-force'], { stdio: 'ignore' })
  } catch {}
  const mountPoint = mkdtempSync(join(tmpdir(), 's20-dmg-mount-'))
  execFileSync('hdiutil', ['attach', '-readonly', '-noverify', '-nobrowse', '-mountpoint', mountPoint, DMG_PATH], {
    stdio: 'ignore',
  })
  ok(`DMG attached read-only at ${mountPoint}`)

  const appPath = join(mountPoint, 'octopus_DSH.app')

  let primaryError
  try {
    const avatarClient = readFileSync(join(appPath, 'Contents', 'Resources', 'resources', 'profile-plugins',
      '@deepseek-ai', 'dsh-experimental-client-ui-assistants', 'lib', 'client.js'), 'utf8')
    for (const marker of ['sea-whale', 'sea-seal', 'sea-seal-apricot', 'bot-sprout', 'bot-coral',
      'data-character', 'avatarSeaside', 'avatarRobots', 'assistants.workspace-choice',
      'assistant-conversation-identity', 'Assistant binding does not match the selected Session']) {
      assert.ok(avatarClient.includes(marker), `Mounted Client lacks character avatar marker: ${marker}`)
    }
    ok('Mounted DMG contains character avatars, workspace binding, and confirmed assistant identity controls')
    execFileSync(process.execPath, [resolve('.','scripts/verify-assistant-brand-assets.mjs'), appPath], { stdio: 'pipe' })
    ok('Mounted DMG contains the approved application icon and all five embedded portraits in the packaged Client plugins')
    if (!existsSync(appPath)) {
      fail(`octopus_DSH.app not found at ${appPath}`)
    }
    ok('Packaged octopus_DSH.app identified in mounted DMG')

    // ==========================================
    // FLOW 1: Fresh Profile Verification
    // ==========================================
    section('Flow 1: Fresh Profile Lifecycle')
    const freshHome = mkdtempSync(join(tmpdir(), 's20-fresh-home-'))
    temporaryPaths.add(freshHome)
    const freshWorkspace = mkdtempSync(join(tmpdir(), 's20-fresh-ws-'))
    temporaryPaths.add(freshWorkspace)

    const freshClient = new CompanionClient(appPath, freshHome, freshWorkspace)
    freshClient.seedProfilePlugins()
    ok('Fresh profile initialized and desktop plugins seeded')

    const readyFrame = await freshClient.start()
    ok(`Fresh companion cold boot succeeded (runtimeVersion: ${readyFrame.runtimeVersion})`)

    // 1. Initial listProfiles is empty
    const initialProfiles = await freshClient.call('assistants/listProfiles', { includeArchived: true })
    if (!Array.isArray(initialProfiles) || initialProfiles.length !== 0) {
      fail('Expected initial profiles list to be empty')
    }
    ok('Initial profiles list is clean')

    const workspaceSelection = await freshClient.call('workspace/create', { request: { path: freshWorkspace } })
    const selectedWorkspaceSession = await freshClient.call('session/create', {
      request: { workspaceId: workspaceSelection.workspace.workspaceId },
    })
    assert(selectedWorkspaceSession.sessionId, 'Workspace-first selection must resolve a real Session')
    ok('Workspace-first selection creates a workspace-owned blank Session before assistant selection')

    // 2. Create assistant profile
    const profile = await freshClient.call('assistants/createProfile', {
      options: {
        name: '社区宣教助理',
        avatar: 'character:sea-whale',
        responsibility: '负责社区低碳环保宣传与文案编撰',
        instructions: '请使用专业、简洁、亲切的中文回复居民咨询',
      },
    })
    if (!profile.id || profile.name !== '社区宣教助理') {
      fail('Profile creation returned invalid object', profile)
    }
    ok(`Created assistant profile '${profile.name}' (id: ${profile.id})`)
    assert.equal(profile.avatar, 'character:sea-whale')
    for (const avatar of ['character:sea-whale', 'character:sea-seal', 'character:sea-seal-apricot', 'character:bot-sprout', 'character:bot-coral']) {
      await freshClient.call('assistants/updateProfile', { id: profile.id, options: { avatar } })
      const saved = await freshClient.call('assistants/listProfiles', { includeArchived: true })
      assert.equal(saved.find(item => item.id === profile.id)?.avatar, avatar)
    }
    ok('All five approved portraits round-trip through the packaged assistant catalog')
    await freshClient.call('assistants/updateProfile', { id: profile.id, options: { avatar: 'character:bot-coral' } })
    ok('Packaged assistant avatar creation and update preserve the selected preset')

    // 3. Create conversation
    const conversation = await freshClient.call('assistants/createConversation', {
      profileId: profile.id,
      options: {
        title: '垃圾分类宣传专项讨论',
        rootSessionId: selectedWorkspaceSession.sessionId,
      },
    })
    if (!conversation.id || conversation.profileId !== profile.id) {
      fail('Conversation creation returned invalid object', conversation)
    }
    ok(`Created conversation '${conversation.title ?? conversation.id}' bound to profile`)
    assert.equal(conversation.rootSessionId, selectedWorkspaceSession.sessionId)
    const confirmedBinding = await freshClient.call('assistants/getConversationBySession', { sessionId: selectedWorkspaceSession.sessionId })
    assert.equal(confirmedBinding?.profileId, profile.id)
    ok('Workspace-first assistant binding preserves the exact Session identity before sending')

    // 4. Model route change / override
    const overrideModel = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }
    const updatedConv = await freshClient.call('assistants/setConversationModelOverride', {
      id: conversation.id,
      model: overrideModel,
    })
    if (updatedConv.modelOverride?.model !== 'deepseek-v4-pro') {
      fail('Conversation model override did not apply', updatedConv)
    }
    ok('Applied conversation model override to deepseek-v4-pro')

    // 5. Memory save (profile scope)
    const memoryScope = { kind: 'profile', profileId: profile.id }
    const memText1 = '社区老年居民偏好大号字体图文纸质手册'
    const memEntry = await freshClient.call('assistants/saveMemory', {
      scope: memoryScope,
      text: memText1,
    })
    if (!memEntry.id || memEntry.revision !== 1 || memEntry.text !== memText1) {
      fail('Memory save returned unexpected result', memEntry)
    }
    ok(`Saved memory entry '${memEntry.id}' with revision 1`)

    // 6. Memory update (CAS check)
    const memText2 = '社区居民偏好图文大字宣传手册并附带实用分类提示'
    const updatedMem = await freshClient.call('assistants/updateMemory', {
      id: memEntry.id,
      expectedRevision: 1,
      text: memText2,
    })
    if (updatedMem.revision !== 2 || updatedMem.text !== memText2) {
      fail('Memory update failed revision bump', updatedMem)
    }
    ok(`Updated memory entry '${memEntry.id}' via CAS to revision 2`)

    // 6.1 Real memory recall verification
    const recallResults = await freshClient.call('assistants/recallMemory', {
      scope: memoryScope,
      query: '宣传',
    })
    if (!Array.isArray(recallResults) || recallResults.length !== 1 || recallResults[0].id !== memEntry.id) {
      fail('Expected memory recall to return active matching memory', recallResults)
    }
    ok(`Recalled active memory via assistants/recallMemory (found: '${recallResults[0].text}')`)

    // 6.2 Controlled request: session/prompt through packaged runtime
    const promptReceipt = await freshClient.call('session/prompt', {
      request: {
        requestId: 'req-s20-fresh-1',
        sessionId: conversation.rootSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: '请介绍社区垃圾分类要点' }],
      },
    })
    if (!promptReceipt?.accepted) {
      fail('session/prompt was not accepted by packaged runtime', promptReceipt)
    }
    ok('Submitted controlled prompt to conversation root session via session/prompt')

    // 6.3 Bounded wait for prompt admission, role/memory injection, and request header
    let historyPage = null
    const waitDeadline = Date.now() + 8000
    while (Date.now() < waitDeadline) {
      const proj = await freshClient.call('session/projections', {
        request: { sessionId: conversation.rootSessionId },
      })
      if (proj && proj.asOfSeq >= 1) {
        const page = await freshClient.call('session/page', {
          request: {
            address: { kind: 'session', sessionId: conversation.rootSessionId },
            throughSeq: proj.asOfSeq,
          },
        })
        const hasUser = page?.records?.some(r => r.event?.type === 'user/message')
        const hasSys = page?.records?.some(r => r.event?.type === 'system/message')
        const hasHeader = page?.records?.some(r => r.event?.type === 'request/header')
        if (hasUser && hasSys && hasHeader) {
          historyPage = page
          break
        }
      }
      await new Promise(r => setTimeout(r, 100))
    }
    if (!historyPage) {
      fail('Timed out waiting for prompt turn events to assemble in session history')
    }

    // Inspect resolved model via session/projections
    const projections = await freshClient.call('session/projections', {
      request: { sessionId: conversation.rootSessionId },
    })
    const activeModel = projections?.values?.modelSelection?.next ?? projections?.values?.modelSelection?.lastUsed
    if (!activeModel || activeModel.model !== 'deepseek-v4-pro') {
      fail('Model selection projection did not resolve to overridden model', projections)
    }
    ok(`Verified resolved model '${activeModel.model}' via session/projections`)

    const sysMsgRecord = historyPage.records.find(r => r.event?.type === 'system/message')
    if (!sysMsgRecord) {
      const errFn = typeof fail === 'function' ? fail : (msg) => { throw new Error(msg) }
      errFn('Required system/message event is absent from session history')
    }
    const sysDataStr = JSON.stringify(sysMsgRecord.event?.data ?? {})
    if (
      !sysDataStr.includes('社区宣教助理') ||
      !sysDataStr.includes(typeof memText2 === 'string' ? memText2 : '居民通报') ||
      (typeof memEntry !== 'undefined' && memEntry?.id ? !sysDataStr.includes(`entry:${memEntry.id}`) : !sysDataStr.includes('entry:')) ||
      !sysDataStr.includes('rev:2')
    ) {
      const errFn = typeof fail === 'function' ? fail : (msg) => { throw new Error(msg) }
      errFn('Required logged role, memory identity/revision or text is absent', sysMsgRecord)
    }
    const headerRecord = historyPage.records.find(r => r.event?.type === 'request/header')
    if (!headerRecord || !JSON.stringify(headerRecord.event?.data ?? {}).includes('deepseek-v4-pro')) {
      const errFn = typeof fail === 'function' ? fail : (msg) => { throw new Error(msg) }
      errFn('Overridden model deepseek-v4-pro absent from actual request/header', headerRecord)
    }
    ok('Verified user prompt event logged in session history')
    ok('Verified system message logged assistant role, memory text, and entry ID/revision 2 metadata')
    ok("Verified overridden model 'deepseek-v4-pro' logged on actual request/header")

    const assistantFirstProfile = await freshClient.call('assistants/createProfile', {
      options: { name: '工作区路径核验助理', responsibility: '核验当前工作区与智能体身份', instructions: '使用简洁中文' },
    })
    const assistantFirstPath = mkdtempSync(join(tmpdir(), 's20-assistant-first-'))
    temporaryPaths.add(assistantFirstPath)
    const assistantFirstWorkspace = await freshClient.call('workspace/create', { request: { path: assistantFirstPath } })
    const assistantFirstSession = await freshClient.call('session/create', {
      request: { workspaceId: assistantFirstWorkspace.workspace.workspaceId },
    })
    const assistantFirstConversation = await freshClient.call('assistants/createConversation', {
      profileId: assistantFirstProfile.id, options: { rootSessionId: assistantFirstSession.sessionId },
    })
    assert.equal(assistantFirstConversation.rootSessionId, assistantFirstSession.sessionId)
    assert.equal((await freshClient.call('assistants/getConversationBySession', {
      sessionId: assistantFirstSession.sessionId,
    }))?.profileId, assistantFirstProfile.id)
    ok('Assistant-first selection binds the chosen workspace Session without replacing its identity')
    const assistantFirstReceipt = await freshClient.call('session/prompt', { request: {
      requestId: 'req-s20-assistant-first', sessionId: assistantFirstSession.sessionId, mode: 'queue',
      content: [{ type: 'text', text: '请确认当前任务身份' }],
    } })
    assert.equal(assistantFirstReceipt.accepted, true)
    let assistantFirstPage
    for (const deadline = Date.now() + 8000; Date.now() < deadline;) {
      const projection = await freshClient.call('session/projections', { request: { sessionId: assistantFirstSession.sessionId } })
      const page = await freshClient.call('session/page', { request: {
        address: { kind: 'session', sessionId: assistantFirstSession.sessionId }, throughSeq: projection.asOfSeq,
      } })
      if (page.records?.some(record => record.event?.type === 'turn/end')) { assistantFirstPage = page; break }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert(assistantFirstPage, 'Assistant-first request must complete a real turn')
    const assistantFirstSystems = assistantFirstPage.records.filter(record => record.event?.type === 'system/message')
    assert(assistantFirstSystems.some(record => JSON.stringify(record.event.data).includes(`You are ${assistantFirstProfile.name}.`)))
    assert(!assistantFirstSystems.some(record => JSON.stringify(record.event.data).includes('You are 社区宣教助理.')))
    assert(assistantFirstPage.records.some(record => record.event?.type === 'request/header'))
    ok('Assistant-first actual request logs the selected role and excludes the other assistant identity')


    // 7. Cold restart of companion
    section('Flow 1: Cold Restart Verification')
    await freshClient.stop()
    ok('First companion instance stopped gracefully')

    const restartClient = new CompanionClient(appPath, freshHome, freshWorkspace)
    const restartReady = await restartClient.start()
    ok(`Companion restarted from disk state (runtimeVersion: ${restartReady.runtimeVersion})`)

    // Verify profile persisted
    const restoredProfiles = await restartClient.call('assistants/listProfiles', { includeArchived: true })
    if (restoredProfiles.length !== 2 || !restoredProfiles.some(item => item.id === profile.id)
      || !restoredProfiles.some(item => item.id === assistantFirstProfile.id)) {
      fail('Profiles did not restore correctly after restart', restoredProfiles)
    }
    ok(`Verified restored profile '${profile.name}' from disk`)
    assert.equal(restoredProfiles.find(item => item.id === profile.id)?.avatar, 'character:bot-coral')
    ok('Assistant avatar survives packaged companion cold restart')

    // Verify conversation and model override persisted
    const restoredConvs = await restartClient.call('assistants/listConversations', { profileId: profile.id })
    if (restoredConvs.length !== 1 || restoredConvs[0].modelOverride?.model !== 'deepseek-v4-pro') {
      fail('Conversations or model override did not restore correctly', restoredConvs)
    }
    ok('Verified restored conversation and model override intact')

    // Verify memory persisted at revision 2
    const restoredMems = await restartClient.call('assistants/listMemory', { scope: memoryScope })
    if (restoredMems.length !== 1 || restoredMems[0].revision !== 2 || restoredMems[0].text !== memText2) {
      fail('Memories did not restore correctly', restoredMems)
    }
    ok(`Verified restored memory '${restoredMems[0].id}' at revision 2`)

    // Verify memory recall works across cold restart
    const restartedRecall = await restartClient.call('assistants/recallMemory', {
      scope: memoryScope,
      query: '宣传',
    })
    if (!Array.isArray(restartedRecall) || restartedRecall.length !== 1 || restartedRecall[0].id !== memEntry.id) {
      fail('Memory recall after restart did not return active memory', restartedRecall)
    }
    ok('Verified memory recall operational after cold restart')

    // Verify historical prompt preserved in session page after restart
    const restoredProj = await restartClient.call('session/projections', {
      request: { sessionId: conversation.rootSessionId },
    })
    const restoredPage = await restartClient.call('session/page', {
      request: {
        address: { kind: 'session', sessionId: conversation.rootSessionId },
        throughSeq: restoredProj.asOfSeq,
      },
    })
    const restoredUserMsg = restoredPage?.records?.find(r => r.event?.type === 'user/message')
    if (!restoredUserMsg) {
      fail('Historical user prompt missing from restored session page', restoredPage)
    }
    ok('Verified historical user prompt preserved in session history after cold restart')

    // 8. Memory archive -> includeArchived -> unarchive
    section('Flow 1: Memory Archive & Restoration Verification')
    const archivedEntry = await restartClient.call('assistants/archiveMemory', {
      id: memEntry.id,
      expectedRevision: 2,
    })
    if (!archivedEntry.archivedAt) {
      fail('Memory entry archive did not record archivedAt', archivedEntry)
    }
    ok(`Archived memory entry '${memEntry.id}' (archivedAt: ${archivedEntry.archivedAt})`)

    // Standard list without includeArchived excludes archived
    const activeOnlyMems = await restartClient.call('assistants/listMemory', {
      scope: memoryScope,
      options: { includeArchived: false },
    })
    if (activeOnlyMems.length !== 0) {
      fail('Active list must exclude archived memories', activeOnlyMems)
    }
    ok('Active memory list excludes archived memories')

    // Recall strictly excludes archived memory
    const recallArchived = await restartClient.call('assistants/recallMemory', {
      scope: memoryScope,
      query: '宣传',
    })
    if (!Array.isArray(recallArchived) || recallArchived.length !== 0) {
      fail('Active memory recall must strictly exclude archived memories', recallArchived)
    }
    ok('Verified active recall strictly excludes archived memories')

    // List with includeArchived: true includes archived
    const allMems = await restartClient.call('assistants/listMemory', {
      scope: memoryScope,
      options: { includeArchived: true },
    })
    if (allMems.length !== 1 || !allMems[0].archivedAt) {
      fail('List with includeArchived must return archived entry', allMems)
    }
    ok('List with includeArchived: true delivers archived entry for UI inspection & restoration')

    // Unarchive restoration
    const restoredEntry = await restartClient.call('assistants/unarchiveMemory', {
      id: memEntry.id,
      expectedRevision: archivedEntry.revision,
    })
    if (restoredEntry.archivedAt !== undefined) {
      fail('Unarchived memory must clear archivedAt', restoredEntry)
    }
    ok(`Restored archived memory entry '${memEntry.id}' (revision: ${restoredEntry.revision})`)

    // Recall includes unarchived restored memory
    const recallRestored = await restartClient.call('assistants/recallMemory', {
      scope: memoryScope,
      query: '宣传',
    })
    if (!Array.isArray(recallRestored) || recallRestored.length !== 1 || recallRestored[0].id !== memEntry.id) {
      fail('Active memory recall must return unarchived restored memory', recallRestored)
    }
    ok('Verified unarchived memory restored to active recall')

    // 9. Memory remove & fresh-topic behavior
    section('Flow 1: Memory Removal & Fresh-Topic Verification')
    const removedEntry = await restartClient.call('assistants/removeMemory', {
      id: memEntry.id,
      expectedRevision: restoredEntry.revision,
    })
    if (!removedEntry.removedAt) {
      fail('Removed memory must record removedAt', removedEntry)
    }
    ok(`Removed memory entry '${memEntry.id}' via tombstone CAS`)

    // Active recall strictly excludes removed memory
    const recallRemoved = await restartClient.call('assistants/recallMemory', {
      scope: memoryScope,
      query: '宣传',
    })
    if (!Array.isArray(recallRemoved) || recallRemoved.length !== 0) {
      fail('Active memory recall must strictly exclude removed memories', recallRemoved)
    }
    ok('Verified active recall strictly excludes removed memories')

    // Start a new topic
    const newTopic = await restartClient.call('assistants/startNewTopic', {
      profileId: profile.id,
    })
    if (!newTopic.id || newTopic.id === conversation.id) {
      fail('startNewTopic must return a distinct conversation', newTopic)
    }
    ok(`Started new conversation topic '${newTopic.id}'`)

    // Submit prompt to new topic session
    const newTopicPromptReceipt = await restartClient.call('session/prompt', {
      request: {
        requestId: 'req-s20-fresh-2',
        sessionId: newTopic.rootSessionId,
        mode: 'queue',
        content: [{ type: 'text', text: '开启新一轮社区宣教活动策划' }],
      },
    })
    if (!newTopicPromptReceipt?.accepted) {
      fail('session/prompt on new topic was not accepted', newTopicPromptReceipt)
    }
    ok('Submitted controlled prompt to new topic session')
    // Bounded wait for new topic prompt turn events to assemble
    let newTopicPage = null
    const newTopicDeadline = Date.now() + 8000
    while (Date.now() < newTopicDeadline) {
      const newTopicProj = await restartClient.call('session/projections', {
        request: { sessionId: newTopic.rootSessionId },
      })
      if (newTopicProj && newTopicProj.asOfSeq >= 1) {
        const page = await restartClient.call('session/page', {
          request: {
            address: { kind: 'session', sessionId: newTopic.rootSessionId },
            throughSeq: newTopicProj.asOfSeq,
          },
        })
        const hasUser = page?.records?.some(r => r.event?.type === 'user/message')
        const hasSys = page?.records?.some(r => r.event?.type === 'system/message')
        const hasHeader = page?.records?.some(r => r.event?.type === 'request/header')
        if (hasUser && hasSys && hasHeader) {
          newTopicPage = page
          break
        }
      }
      await new Promise(r => setTimeout(r, 100))
    }
    if (!newTopicPage) {
      fail('Timed out waiting for new topic turn events to assemble')
    }

    assertNewTopicMemoryExclusion(newTopicPage.records, '社区宣教助理', memText2, memEntry.id)
    ok('Verified new topic turn assembled and strictly excluded removed memory text and entry ID')

    // Active memory list is now empty for recall & injection
    const activeAfterRemove = await restartClient.call('assistants/listMemory', { scope: memoryScope })
    if (activeAfterRemove.length !== 0) {
      fail('Removed memory must be absent from active recall', activeAfterRemove)
    }
    ok('Removed memory is completely absent from active recall and injection')

    // Verify historical conversation retains original prompt, role/memory snapshot, and request/header
    const origProj = await restartClient.call('session/projections', {
      request: { sessionId: conversation.rootSessionId },
    })
    const origHistory = await restartClient.call('session/page', {
      request: {
        address: { kind: 'session', sessionId: conversation.rootSessionId },
        throughSeq: origProj.asOfSeq,
      },
    })
    assertPositivePromptAndSnapshot(
      origHistory.records,
      '社区宣教助理',
      memText2,
      memEntry.id,
      2,
      'deepseek-v4-pro',
    )
    ok('Verified historical conversation log retains original user prompts, role/memory snapshot, and audit trail')

    await restartClient.stop()
    rmSync(freshHome, { recursive: true, force: true })
    rmSync(freshWorkspace, { recursive: true, force: true })
    ok('Fresh profile test cleanup complete')

    // ==========================================
    // NEGATIVE CONTROLS: Assertions Reject Invalid Cases
    // ==========================================
    section('Negative Controls: Assertions Reject Invalid / Mismatched Records')

    // 1. Missing system/message
    let rejectedMissingSys = false
    try {
      assertPositivePromptAndSnapshot(
        [{ event: { type: 'user/message', data: { text: 'prompt' } } }],
        '社区宣教助理',
        memText2,
        memEntry.id,
        2,
        'deepseek-v4-pro',
      )
    } catch {
      rejectedMissingSys = true
    }
    if (!rejectedMissingSys) fail('Negative control failed: assertion accepted missing system/message')
    ok('Negative control: rejected missing system/message')

    // 2. Missing role or memory text
    let rejectedMissingRoleOrMem = false
    try {
      assertPositivePromptAndSnapshot(
        [
          { event: { type: 'user/message', data: { text: 'prompt' } } },
          { event: { type: 'system/message', data: { text: 'unrelated prompt without role or memory' } } },
          { event: { type: 'request/header', data: { model: 'deepseek-v4-pro' } } },
        ],
        '社区宣教助理',
        memText2,
        memEntry.id,
        2,
        'deepseek-v4-pro',
      )
    } catch {
      rejectedMissingRoleOrMem = true
    }
    if (!rejectedMissingRoleOrMem) fail('Negative control failed: assertion accepted missing role/memory text')
    ok('Negative control: rejected missing role or memory text')

    // 3. Missing memory metadata (entry ID or rev)
    let rejectedMissingMeta = false
    try {
      assertPositivePromptAndSnapshot(
        [
          { event: { type: 'user/message', data: { text: 'prompt' } } },
          { event: { type: 'system/message', data: { text: `社区宣教助理: ${memText2}` } } },
          { event: { type: 'request/header', data: { model: 'deepseek-v4-pro' } } },
        ],
        '社区宣教助理',
        memText2,
        memEntry.id,
        2,
        'deepseek-v4-pro',
      )
    } catch {
      rejectedMissingMeta = true
    }
    if (!rejectedMissingMeta) fail('Negative control failed: assertion accepted missing entry ID / revision metadata')
    ok('Negative control: rejected missing entry ID / revision metadata')

    // 4. Missing or mismatched request/header model
    let rejectedWrongModel = false
    try {
      assertPositivePromptAndSnapshot(
        [
          { event: { type: 'user/message', data: { text: 'prompt' } } },
          { event: { type: 'system/message', data: { text: `社区宣教助理: <!-- [entry:${memEntry.id} rev:2] -->\n- ${memText2}` } } },
          { event: { type: 'request/header', data: { model: 'deepseek-chat' } } },
        ],
        '社区宣教助理',
        memText2,
        memEntry.id,
        2,
        'deepseek-v4-pro',
      )
    } catch {
      rejectedWrongModel = true
    }
    if (!rejectedWrongModel) fail('Negative control failed: assertion accepted mismatched request/header model')
    ok('Negative control: rejected mismatched request/header model')

    // 5. Unexecuted new topic (missing system/message or request/header)
    let rejectedUnexecutedNewTopic = false
    try {
      assertNewTopicMemoryExclusion(
        [{ event: { type: 'user/message', data: { text: 'new prompt' } } }],
        '社区宣教助理',
        memText2,
        memEntry.id,
      )
    } catch {
      rejectedUnexecutedNewTopic = true
    }
    if (!rejectedUnexecutedNewTopic) fail('Negative control failed: assertion accepted unexecuted new topic')
    ok('Negative control: rejected unexecuted new topic session')

    // 6. Leaked removed memory into new topic
    let rejectedLeakedMem = false
    try {
      assertNewTopicMemoryExclusion(
        [
          { event: { type: 'user/message', data: { text: 'new prompt' } } },
          { event: { type: 'system/message', data: { text: `社区宣教助理: <!-- [entry:${memEntry.id}] --> ${memText2}` } } },
          { event: { type: 'request/header', data: { model: 'deepseek-v4-pro' } } },
        ],
        '社区宣教助理',
        memText2,
        memEntry.id,
      )
    } catch {
      rejectedLeakedMem = true
    }
    if (!rejectedLeakedMem) fail('Negative control failed: assertion accepted leaked removed memory in new topic')
    ok('Negative control: rejected leaked removed memory in new topic')

    // ==========================================
    // FLOW 2: Copied Existing Profile Lifecycle
    // ==========================================
    section('Flow 2: Copied Existing Profile Lifecycle')
    const existingHome = mkdtempSync(join(tmpdir(), 's20-existing-home-'))
    temporaryPaths.add(existingHome)
    const existingWorkspace = mkdtempSync(join(tmpdir(), 's20-existing-ws-'))
    temporaryPaths.add(existingWorkspace)
    const existingProfileDir = join(existingHome, '.dsh', 'profiles', 'desktop')
    mkdirSync(existingProfileDir, { recursive: true })

    // Simulate pre-existing legacy profile manifest
    const legacyManifest = {
      name: 'dsh-profile-desktop',
      version: '0.1.0',
      dependencies: {
        '@deepseek-ai/dsh-base': 'workspace:*',
        '@deepseek-ai/dsh-web-app': 'workspace:*',
        '@deepseek-ai/dsh-desktop-app': 'workspace:*',
      },
      dsh: {
        profile: {
          bundles: [
            '@deepseek-ai/dsh-base',
            '@deepseek-ai/dsh-web-app',
            '@deepseek-ai/dsh-desktop-app',
          ],
        },
      },
    }
    writeFileSync(join(existingProfileDir, 'package.json'), JSON.stringify(legacyManifest, null, 2))
    writeFileSync(join(existingProfileDir, 'cordis.patch.yml'), '[]\n')

    // Simulate pre-existing persisted storage: ~/.dsh/storages/assistants.json
    const storagesDir = join(existingHome, '.dsh', 'storages')
    mkdirSync(storagesDir, { recursive: true })
    const preExistingStorage = {
      unit: { name: 'assistants', version: 1 },
      global: null,
      tables: {
        profiles: {
          'prof-preexisting-001': {
            id: 'prof-preexisting-001',
            name: '社区合规专员',
            responsibility: '负责审核社区项目合规性与资金规范',
            instructions: '遵循非营利组织资金监管规范与信息公开要求',
            revision: 1,
            createdAt: 1728000000000,
            updatedAt: 1728000000000,
          },
        },
        operations: {},
        conversations: {
          'conv-preexisting-001': {
            id: 'conv-preexisting-001',
            profileId: 'prof-preexisting-001',
            rootSessionId: 'session-preexisting-root-001',
            title: '年度财务合规审查',
            createdAt: 1728000000000,
            updatedAt: 1728000000000,
            modelOverride: {
              provider: 'deepseek-official',
              model: 'deepseek-v4-pro',
            },
          },
        },
        teams: {},
        seats: {},
        adoptions: {},
        memory: {
          'mem-preexisting-001': {
            id: 'mem-preexisting-001',
            scope: {
              kind: 'profile',
              profileId: 'prof-preexisting-001',
            },
            text: '单笔支出超过5000元必须经管委会三人联签并公示',
            revision: 1,
            createdAt: 1728000000000,
            updatedAt: 1728000000000,
          },
        },
      },
    }
    writeFileSync(join(storagesDir, 'assistants.json'), JSON.stringify(preExistingStorage, null, 2))

    // Stage durable session log for pre-existing conversation rootSessionId
    const preSessId = 'session-preexisting-root-001'
    const sessProjDir = join(existingHome, '.dsh', 'sessions', projectKey(existingWorkspace), encodeSegment(preSessId))
    mkdirSync(sessProjDir, { recursive: true })

    const preHeader = JSON.stringify({
      type: 'session',
      version: 4,
      id: preSessId,
      createdAt: 1728000000000,
      cwd: existingWorkspace,
      isSeeded: false,
      delegationDepth: 0,
      agentPreset: 'standard',
    }) + '\n'

    const preEvents = [
      {
        type: 'turn/start',
        seq: 0,
        time: 1728000001000,
        data: { turn: 1 },
      },
      {
        type: 'step/start',
        seq: 1,
        time: 1728000001001,
        data: { turn: 1, step: 1 },
      },
      {
        type: 'system/message',
        seq: 2,
        time: 1728000001002,
        data: {
          turn: 1,
          step: 1,
          message: {
            id: 'msg-preexisting-system',
            role: 'system',
            source: { kind: 'system-prompt' },
            content: [{
              type: 'text',
              text: '社区合规专员已就位。\n<!-- [entry:mem-preexisting-001 rev:1 data:5Y2V56yU5pSv5Ye66LaF6L+HMzAwMOWFg+W/heimuOe7j+euoeeQhueUteS4ieS6uuiBlOetvOW5tOWFrOekug==] -->\n- 单笔支出超过5000元必须经管委会三人联签并公示',
            }],
          },
        },
        surfaceOp: 'append',
      },
      {
        type: 'user/message',
        seq: 3,
        time: 1728000001003,
        data: {
          id: 'msg-preexisting-user',
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: '请审核2026年Q3社区活动经费报销申请' }],
        },
        surfaceOp: 'append',
      },
      {
        type: 'request/header',
        seq: 4,
        time: 1728000001004,
        data: {
          header: {
            config: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
          },
          reason: 'initial',
        },
      },
      {
        type: 'assistant/message',
        seq: 5,
        time: 1728000001005,
        data: {
          turn: 1,
          step: 1,
          stream: [
            { type: 'chunk', time: 1728000001005, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
            { type: 'text-chunks', time0: 1728000001005, index: 0, dt: [], texts: ['已受理报销申请。单笔支出如超过5000元需经管委会三人联签。'] },
            { type: 'chunk', time: 1728000001006, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: '已受理报销申请。单笔支出如超过5000元需经管委会三人联签。' } } },
            { type: 'chunk', time: 1728000001006, chunk: { type: 'finish', reason: { kind: 'stop' } } },
          ],
          message: {
            id: 'msg-preexisting-asst',
            role: 'assistant',
            source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-pro' },
            content: [{ type: 'text', text: '已受理报销申请。单笔支出如超过5000元需经管委会三人联签。' }],
          },
        },
        surfaceOp: 'append',
      },
      {
        type: 'step/end',
        seq: 6,
        time: 1728000001006,
        data: { turn: 1, step: 1 },
      },
      {
        type: 'turn/end',
        seq: 7,
        time: 1728000001007,
        data: { turn: 1, reason: { kind: 'completed' } },
      },
    ]
    const preEventsLines = preEvents.map(e => JSON.stringify(e)).join('\n') + '\n'

    const f1 = zstdCompressSync(Buffer.from(preHeader, 'utf8'), { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
    const f2 = zstdCompressSync(Buffer.from(preEventsLines, 'utf8'), { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
    writeFileSync(join(sessProjDir, 'session.v4.jsonl.zstd'), Buffer.concat([f1, f2]))
    ok('Staged pre-existing profile, conversation, memory, and durable session log in copied profile fixture')

    const existingClient = new CompanionClient(appPath, existingHome, existingWorkspace)
    existingClient.seedProfilePlugins()
    ok('Upgraded existing profile with bundled desktop plugins')

    const existingReady = await existingClient.start()
    ok(`Existing profile companion booted successfully (runtimeVersion: ${existingReady.runtimeVersion})`)

    // Verify pre-existing data recovered upon packaged initialization
    const preProfiles = await existingClient.call('assistants/listProfiles', { includeArchived: true })
    if (!preProfiles.some(p => p.id === 'prof-preexisting-001' && p.name === '社区合规专员')) {
      fail('Pre-existing profile was not recovered from copied state', preProfiles)
    }
    ok('Pre-existing profile recovered from copied profile state')

    const preConvs = await existingClient.call('assistants/listConversations', { profileId: 'prof-preexisting-001' })
    if (!preConvs.some(c => c.id === 'conv-preexisting-001' && c.modelOverride?.model === 'deepseek-v4-pro')) {
      fail('Pre-existing conversation with model override was not recovered', preConvs)
    }
    ok('Pre-existing conversation and model override recovered from copied state')

    const preMems = await existingClient.call('assistants/recallMemory', {
      scope: { kind: 'profile', profileId: 'prof-preexisting-001' },
      query: '联签',
    })
    if (!preMems.some(m => m.id === 'mem-preexisting-001')) {
      fail('Pre-existing memory was not recalled from copied state', preMems)
    }
    ok('Pre-existing memory recalled from copied profile state')

    // Reopen and inspect pre-existing durable conversation session log
    const preProj = await existingClient.call('session/projections', {
      request: { sessionId: preSessId },
    })
    if (!preProj || preProj.asOfSeq < 3) {
      fail('Pre-existing session did not recover durable event history', preProj)
    }
    const prePage = await existingClient.call('session/page', {
      request: {
        address: { kind: 'session', sessionId: preSessId },
        throughSeq: preProj.asOfSeq,
      },
    })
    const preUserMsg = prePage?.records?.find(r => r.event?.type === 'user/message')
    const preSysMsg = prePage?.records?.find(r => r.event?.type === 'system/message')
    const preAsstMsg = prePage?.records?.find(r => r.event?.type === 'assistant/message')
    if (!preUserMsg || !JSON.stringify(preUserMsg).includes('请审核2026年Q3社区活动经费报销申请')) {
      fail('Pre-existing user prompt was not recovered from durable session log', prePage)
    }
    if (!preSysMsg || !JSON.stringify(preSysMsg).includes('社区合规专员') || !JSON.stringify(preSysMsg).includes('联签')) {
      fail('Pre-existing system role/memory was not recovered from durable session log', prePage)
    }
    if (!preAsstMsg || !JSON.stringify(preAsstMsg).includes('已受理报销申请')) {
      fail('Pre-existing assistant message was not recovered from durable session log', prePage)
    }
    ok('Verified pre-existing durable conversation history restored from disk upon packaged boot')

    // Continue the pre-existing conversation with a new request
    const continueReceipt = await existingClient.call('session/prompt', {
      request: {
        requestId: 'req-s20-existing-continue',
        sessionId: preSessId,
        mode: 'queue',
        content: [{ type: 'text', text: '请补充说明活动餐费报销标准' }],
      },
    })
    if (!continueReceipt?.accepted) {
      fail('Follow-up prompt to pre-existing session was not accepted', continueReceipt)
    }
    ok('Submitted follow-up prompt to pre-existing conversation session')

    // Bounded wait for continuation turn events to append
    let continuedPage = null
    const contDeadline = Date.now() + 8000
    while (Date.now() < contDeadline) {
      const updatedProj = await existingClient.call('session/projections', {
        request: { sessionId: preSessId },
      })
      if (updatedProj && updatedProj.asOfSeq > preProj.asOfSeq) {
        const page = await existingClient.call('session/page', {
          request: {
            address: { kind: 'session', sessionId: preSessId },
            throughSeq: updatedProj.asOfSeq,
          },
        })
        const hasContinuation = page?.records?.some(r =>
          r.event?.type === 'user/message' && JSON.stringify(r.event.data).includes('请补充说明活动餐费报销标准')
        )
        if (hasContinuation) {
          continuedPage = page
          break
        }
      }
      await new Promise(r => setTimeout(r, 100))
    }
    if (!continuedPage) {
      fail('Timed out waiting for follow-up prompt events to append to pre-existing session')
    }
    ok('Verified follow-up turn appended contiguously to pre-existing conversation log')

    // 1. Template team creation parity (blank vs document)
    const coordProfile = await existingClient.call('assistants/createProfile', {
      options: {
        name: '项目主管',
        responsibility: '统筹规划专项任务',
        instructions: '请主持工作协同',
      },
    })

    const blankTeamResult = await existingClient.call('assistants/createTeamFromTemplate', {
      templateId: 'blank',
      options: {
        coordinatorProfileId: coordProfile.id,
        name: '自定义协同小组',
        avatar: 'character:sea-seal-apricot',
        description: '空白模板创建的协同小组',
      },
    })
    if (blankTeamResult.seats.length !== 1 || blankTeamResult.seats[0].role !== 'coordinator') {
      fail('Blank team must create exactly 1 coordinator seat', blankTeamResult)
    }
    ok('Blank template created team with coordinator seat parity')

    const docTeamResult = await existingClient.call('assistants/createTeamFromTemplate', {
      templateId: 'document',
      options: {
        coordinatorProfileId: coordProfile.id,
        name: '公文编撰工作组',
        avatar: 'character:bot-sprout',
        description: '公文处理模板团队',
      },
    })
    if (docTeamResult.seats.length < 2) {
      fail('Document template team must create coordinator + teammate seats', docTeamResult)
    }
    ok(`Document template created team with ${docTeamResult.seats.length} seats (coordinator + teammates)`)
    assert.equal(blankTeamResult.team.avatar, 'character:sea-seal-apricot')
    assert.equal(docTeamResult.team.avatar, 'character:bot-sprout')
    const avatarTeam = await existingClient.call('assistants/getTeam', { id: blankTeamResult.team.id })
    await existingClient.call('assistants/updateTeam', { id: avatarTeam.id, expectedRevision: avatarTeam.revision, options: { avatar: '' } })
    ok('Packaged team templates preserve avatars and explicit initials restoration')
    const dormantActivity = await existingClient.call('assistants/getTeamActivity', { teamId: avatarTeam.id })
    assert.equal(dormantActivity, undefined)
    assert.equal((await existingClient.call('assistants/getTeam', { id: avatarTeam.id })).leadSessionId, undefined)
    ok('Read-only collaboration query leaves an unstarted saved team dormant')

    // 2. Team shared memory and scoped grants
    const teamScope = { kind: 'team', teamId: docTeamResult.team.id }
    const teamMem = await existingClient.call('assistants/saveMemory', {
      scope: teamScope,
      text: '团队统一采用GB/T 9704-2012公文格式规范',
    })
    if (!teamMem.id || teamMem.scope.kind !== 'team') {
      fail('Team memory save failed', teamMem)
    }
    ok(`Saved team-scoped memory '${teamMem.id}' for team '${docTeamResult.team.id}'`)

    // Profile memory with grant to team
    const profileMem = await existingClient.call('assistants/saveMemory', {
      scope: { kind: 'profile', profileId: coordProfile.id },
      text: '主管核稿意见标准模板',
      options: { grants: [docTeamResult.team.id] },
    })
    if (!profileMem.grants?.includes(docTeamResult.team.id)) {
      fail('Profile memory grant to team failed', profileMem)
    }
    ok(`Saved profile memory with explicit grant to team '${docTeamResult.team.id}'`)

    // 3. Cold restart existing profile
    section('Flow 2: Existing Profile Cold Restart Verification')
    await existingClient.stop()
    ok('Existing profile companion stopped')

    const restartExisting = new CompanionClient(appPath, existingHome, existingWorkspace)
    const restartExistingReady = await restartExisting.start()
    ok(`Existing profile companion restarted cold (runtimeVersion: ${restartExistingReady.runtimeVersion})`)

    // Verify both pre-existing profile and new coordinator profile survive cold restart
    const finalProfiles = await restartExisting.call('assistants/listProfiles', { includeArchived: true })
    if (!finalProfiles.some(p => p.id === 'prof-preexisting-001') || !finalProfiles.some(p => p.id === coordProfile.id)) {
      fail('Profiles did not survive cold restart of existing profile', finalProfiles)
    }
    ok('Both pre-existing profile and new coordinator profile survived cold restart')

    const teams = await restartExisting.call('assistants/listTeams', {})
    if (teams.length !== 2) {
      fail('Expected 2 teams to persist across restart', teams)
    }
    ok(`Verified ${teams.length} teams restored from disk`)
    assert.equal(teams.find(team => team.id === blankTeamResult.team.id)?.avatar, '')
    assert.equal(teams.find(team => team.id === docTeamResult.team.id)?.avatar, 'character:bot-sprout')
    ok('Team avatar presets and initials restoration survive packaged cold restart')

    const reloadedTeamMem = await restartExisting.call('assistants/listMemory', { scope: teamScope })
    if (reloadedTeamMem.length !== 1 || reloadedTeamMem[0].id !== teamMem.id) {
      fail('Team memory did not restore correctly', reloadedTeamMem)
    }
    ok('Team-scoped memory restored intact across restart')

    const reloadedPriorMem = await restartExisting.call('assistants/recallMemory', {
      scope: { kind: 'profile', profileId: 'prof-preexisting-001' },
      query: '联签',
    })
    if (reloadedPriorMem.length !== 1 || reloadedPriorMem[0].id !== 'mem-preexisting-001') {
      fail('Pre-existing memory did not survive cold restart', reloadedPriorMem)
    }
    ok('Pre-existing memory survived cold restart and remains recallable')

    // Verify pre-existing session history and continuation survive cold restart
    const restartPreProj = await restartExisting.call('session/projections', {
      request: { sessionId: preSessId },
    })
    const restartPrePage = await restartExisting.call('session/page', {
      request: {
        address: { kind: 'session', sessionId: preSessId },
        throughSeq: restartPreProj.asOfSeq,
      },
    })
    const origHistoricalMsg = restartPrePage?.records?.find(r =>
      r.event?.type === 'user/message' && JSON.stringify(r.event.data).includes('请审核2026年Q3社区活动经费报销申请')
    )
    const continuationMsg = restartPrePage?.records?.find(r =>
      r.event?.type === 'user/message' && JSON.stringify(r.event.data).includes('请补充说明活动餐费报销标准')
    )
    if (!origHistoricalMsg || !continuationMsg) {
      fail('Pre-existing conversation history and continuation did not survive cold restart', restartPrePage)
    }
    ok('Verified pre-existing durable conversation history and continuation survive cold restart')

    // ==========================================
    // FLOW 3: Stage C Packaged Acceptance Flows
    // ==========================================
    section('Flow 3: Stage C Packaged Acceptance Flows (Rounds, Ownership, Prediction, Usage)')

    const legacyEmptyTeam = await restartExisting.call('assistants/createTeam', { options: {
      name: 'Legacy empty roster regression', coordinatorProfileId: coordProfile.id, templateOrigin: 'blank',
    } })
    assert.equal((await restartExisting.call('assistants/listSeats', { teamId: legacyEmptyTeam.id })).length, 0)
    assert.equal(await restartExisting.call('assistants/getTeamActivity', { teamId: legacyEmptyTeam.id }), undefined)
    assert.equal((await restartExisting.call('assistants/listSeats', { teamId: legacyEmptyTeam.id })).length, 0)
    ok('Reading a legacy empty team does not silently create seats or start work')
    const repairedAllocation = await restartExisting.call('assistants/provisionTeam', { teamId: legacyEmptyTeam.id })
    const repairedSeats = await restartExisting.call('assistants/listSeats', { teamId: legacyEmptyTeam.id })
    assert.equal(repairedAllocation.team.id, legacyEmptyTeam.id)
    assert.equal(repairedSeats.length, 1)
    assert.equal(repairedSeats[0].role, 'coordinator')
    assert.equal(repairedSeats[0].profileId, coordProfile.id)
    ok('Explicit legacy team provisioning repairs its missing coordinator while preserving identity')
    const repairedDiscussion = await restartExisting.call('assistants/createDiscussion', { options: { teamId: legacyEmptyTeam.id } })
    const repairedRound = await restartExisting.call('assistants/scheduleRound', { options: {
      teamId: legacyEmptyTeam.id, discussionId: repairedDiscussion.id, prompt: 'Legacy coordinator admission regression',
    } })
    assert.equal(repairedRound.slots[0].seatId, repairedSeats[0].id)
    await restartExisting.call('assistants/cancelRound', { roundId: repairedRound.id, reason: 'Pending regression control complete' })
    ok('A repaired legacy team admits a coordinator round and cancels without dispatch')

    // 1. Discussions & Round Scheduling
    const disc = await restartExisting.call('assistants/createDiscussion', {
      options: {
        teamId: docTeamResult.team.id,
        topic: '2026年Q4公文联审讨论',
      },
    })
    if (!disc.id || disc.teamId !== docTeamResult.team.id) {
      fail('Discussion creation failed on packaged runtime', disc)
    }
    ok(`Created group discussion '${disc.id}' for team '${docTeamResult.team.id}'`)

    const discList = await restartExisting.call('assistants/listDiscussions', {
      teamId: docTeamResult.team.id,
    })
    if (!Array.isArray(discList) || !discList.some(d => d.id === disc.id)) {
      fail('Discussion list does not contain created discussion', discList)
    }
    ok(`Verified discussion '${disc.id}' appears in team discussion list`)

    // 2. Keyed round admission & conflict check (C3)
    const round1 = await restartExisting.call('assistants/scheduleRound', {
      options: {
        id: 'round-stagec-pkg-001',
        teamId: docTeamResult.team.id,
        discussionId: disc.id,
        prompt: '请各席位协同审核公文初稿',
      },
    })
    if (round1.id !== 'round-stagec-pkg-001' || round1.status !== 'pending') {
      fail('Round scheduling failed on packaged runtime', round1)
    }
    ok(`Scheduled group round '${round1.id}' with status 'pending'`)

    // Idempotent re-admission with identical fingerprint returns existing round
    const round1Replay = await restartExisting.call('assistants/scheduleRound', {
      options: {
        id: 'round-stagec-pkg-001',
        teamId: docTeamResult.team.id,
        discussionId: disc.id,
        prompt: '请各席位协同审核公文初稿',
      },
    })
    if (round1Replay.id !== round1.id) {
      fail('Idempotent re-admission failed to return identical round', round1Replay)
    }
    ok('Verified idempotent round admission with matching fingerprint')

    await assertRejected(() => restartExisting.call('assistants/scheduleRound', {
      options: { id: round1.id, teamId: docTeamResult.team.id, discussionId: disc.id, prompt: 'changed fingerprint' },
    }), /conflict|fingerprint|different|reuse/i)
    ok('Rejected reused admission key with changed prompt fingerprint')

    await restartExisting.call('assistants/cancelRound', { roundId: round1.id, reason: 'admission probe complete' })

    // Model execution is background work so the serialized carrier remains free for cancellation.
    const executePackagedRound = async roundId => {
      const receipt = await restartExisting.call('assistants/startRound', { roundId })
      assert.equal(receipt.id, roundId)
      return waitForEvidence(() => restartExisting.call('assistants/getRound', { roundId }),
        state => state && ['completed', 'failed', 'cancelled'].includes(state.status),
        `terminal packaged round ${roundId}`)
    }

    // Real seat execution and committed public history, observed at the provider and durable log.
    const allocation = await restartExisting.call('assistants/provisionTeam', { teamId: docTeamResult.team.id })
    assert(allocation.coordinatorSessionId, 'Missing provisioned coordinator session')
    const seatAddress = sessionId => sessionId === allocation.coordinatorSessionId
      ? { kind: 'session', sessionId }
      : { kind: 'subagent', parentSessionId: allocation.coordinatorSessionId, childSessionId: sessionId, mode: 'unknown' }
    const seats = await restartExisting.call('assistants/listSeats', { teamId: docTeamResult.team.id })
    assert(seats.length >= 2, 'Two seats are required to exercise downstream shared context')
    const executionRound = await restartExisting.call('assistants/scheduleRound', {
      options: { id: 'stage-c-real-round', teamId: docTeamResult.team.id, discussionId: disc.id,
        recipients: seats.slice(0, 2).map(seat => seat.id), prompt: 'STAGE_C_ACTUAL_EXECUTION' },
    })
    const observedBefore = syntheticProvider.observations.length
    const completed = await executePackagedRound(executionRound.id)
    assert.equal(completed.status, 'completed')
    assert.equal(completed.slots.length, 2)
    assert(completed.slots.every(slot => slot.status === 'completed' && slot.committedReply && slot.tokensUsed >= 22 && slot.tokensUsed % 22 === 0), JSON.stringify({ completed, observed: syntheticProvider.observations.slice(observedBefore).map(request => ({ text: request.text, model: request.payload.model, closed: request.closed })) }))
    const publicTranscript = await restartExisting.call('assistants/queryPublicTranscript', { options: { discussionId: disc.id } })
    assert.equal(publicTranscript.items.length, 2)
    const replies = publicTranscript.items
    const observedRequests = syntheticProvider.observations.slice(observedBefore)
    assert(observedRequests.length >= 2, 'Both scheduled seats must issue actual requests')
    assert.equal(completed.totalTokensUsed, observedRequests.length * 22, 'Round billing must include every observed owned seat/parent-notice call')
    const afterRoundObservations = syntheticProvider.observations.length
    for (const reply of replies) {
      assert(observedRequests.some(request => request.text === reply.text), 'Public reply was not emitted by actual provider')
      assert(reply.sourceEventSeq > 0 && reply.sourceSessionId && reply.authorSeatId)
      const projection = await restartExisting.call('session/projections', { request: { sessionId: reply.sourceSessionId } })
      const page = await restartExisting.call('session/page', { request: { address: seatAddress(reply.sourceSessionId), throughSeq: projection.asOfSeq } })
      const source = page.records.find(record => record.event?.seq === reply.sourceEventSeq)
      assert.equal(source?.event?.type, 'assistant/message')
      assert(JSON.stringify(source.event.data).includes(reply.text))
      assert.equal(source.event.data.usage.inputTokens + source.event.data.usage.outputTokens, 22)
    }
    assert(observedRequests.some(request => JSON.stringify(request.payload.messages).includes(replies[0].text)), 'Downstream provider request omitted first committed reply')
    ok('Executed two packaged seats with real provider replies, observed usage, durable attribution, and shared committed context')
    const replay = await executePackagedRound(executionRound.id)
    assert.equal(replay.status, 'completed')
    assert.equal(syntheticProvider.observations.length, afterRoundObservations)
    ok('Completed round replay does not issue another model request')

    // Cancel a running owned default Agent request, not merely an unstarted journal entry.
    const cancellationRound = await restartExisting.call('assistants/scheduleRound', {
      options: { id: 'stage-c-active-cancel', teamId: docTeamResult.team.id, discussionId: disc.id, prompt: 'STAGE_C_HANG_OWNED_REQUEST' },
    })
    const cancellationReceipt = await restartExisting.call('assistants/startRound', { roundId: cancellationRound.id })
    assert.equal(cancellationReceipt.id, cancellationRound.id)
    const hanging = await waitForEvidence(async () => {
      const state = await restartExisting.call('assistants/getRound', { roundId: cancellationRound.id })
      if (state.status !== 'pending' && state.status !== 'active') throw new Error(`Owned execution settled before active hang observation: ${JSON.stringify(state)}`)
      return syntheticProvider.observations
    }, observations => observations.some(request => request.hanging), 'active owned provider request')
    const hangingRequest = hanging.findLast(request => request.hanging)
    const cancelled = await restartExisting.call('assistants/cancelRound', { roundId: cancellationRound.id, reason: 'installed cancellation control' })
    assert.equal(cancelled.status, 'cancelled')
    await waitForEvidence(() => hangingRequest.closed, closed => closed, 'provider connection closure after cancellation')
    const cancellationResult = await restartExisting.call('assistants/getRound', { roundId: cancellationRound.id })
    assert.equal(cancellationResult.status, 'cancelled')
    const afterCancellation = await restartExisting.call('assistants/queryPublicTranscript', { options: { discussionId: disc.id } })
    assert.equal(afterCancellation.items.length, 2)
    ok('Cancelling active owned Agent request closes provider connection and suppresses late publication')

    await restartExisting.call('assistants/setReadCursor', { conversationId: disc.id, lastReadSeq: 2 })
    const reviewSessionId = replies.at(-1).sourceSessionId
    const reviewProjection = await restartExisting.call('session/projections', { request: { sessionId: reviewSessionId } })
    const reviewHistory = await restartExisting.call('session/page', { request: { address: seatAddress(reviewSessionId), throughSeq: reviewProjection.asOfSeq } })
    const reviewedTurn = reviewHistory.records.findLast(record => record.event?.type === 'turn/end')
    assert(reviewedTurn?.event?.seq > 0, 'Memory review must correspond to an actually completed seat turn')
    const boundedCandidate = `材料归档采用统一编号规范${'记'.repeat(400)}`
    const reviewRes = await restartExisting.call('assistants/reviewTurn', { request: {
      sessionId: reviewSessionId, scope: { teamId: docTeamResult.team.id }, turnSeq: reviewedTurn.event.seq,
      turnTexts: ['公文复核必须由两名同事共同审核'],
      candidateMemories: ['公文复核必须由两名同事共同审核', '公文复核必须由两名同事共同审核', ...Array(20).fill(boundedCandidate)], trigger: 'manual',
    } })
    assert.equal(reviewRes.addedMemories.length, 2)
    assert.equal(reviewRes.addedMemories.filter(memory => memory.text === '公文复核必须由两名同事共同审核').length, 1)
    assert.equal(reviewRes.candidateMemories.length, 10)
    assert(reviewRes.candidateMemories.every(text => text.length <= 200))
    assert.equal(reviewRes.addedMemories.find(memory => memory.text.startsWith('材料归档采用统一编号规范'))?.text.length, 200)
    ok('Packaged manual review deduplicates candidates and enforces ten-candidate/200-character bounds')

    const predictionSession = allocation.coordinatorSessionId
    const beforePrediction = await restartExisting.call('session/projections', { request: { sessionId: predictionSession } })
    const usageRequest = { sessionBindings: completed.slots.map(slot => ({ sessionId: slot.sessionId, bindingId: slot.seatId, startBoundarySeq: 0, teamId: docTeamResult.team.id })) }
    const usageBefore = await restartExisting.call('assistants/aggregateUsage', { request: usageRequest })
    const priorAuxiliary = usageBefore.reduce((sum, item) => sum + item.auxiliaryTokens.totalTokens, 0)
    const composerContext = await restartExisting.call('assistants/getComposerContext', { sessionId: predictionSession })
    assert(composerContext && composerContext.asOfSeq > 0 && composerContext.recentTexts.length > 0, 'Real completed-turn composer context must be available')
    const predictionObservation = syntheticProvider.observations.length
    const prediction = await restartExisting.call('assistants/predictComposer', { request: {
      sessionId: predictionSession, asOfSeq: composerContext.asOfSeq, draftText: '', recentTexts: composerContext.recentTexts,
    } })
    assert(prediction && prediction.text, 'Enabled eligible prediction must produce nonempty provider text')
    assert.equal(syntheticProvider.observations.length, predictionObservation + 1)
    const actualPrediction = syntheticProvider.observations.at(-1)
    assert.equal(prediction.text, actualPrediction.text)
    assert.equal(prediction.usage.usage.totalTokens, 22)
    assert(!actualPrediction.payload.tools?.length, 'Prediction request must remain tool-free')
    const afterPrediction = await restartExisting.call('session/projections', { request: { sessionId: predictionSession } })
    assert(afterPrediction.asOfSeq > beforePrediction.asOfSeq, 'Auxiliary request and outcome must advance durable history')
    const auxiliaryPage = await restartExisting.call('session/page', { request: {
      address: { kind: 'session', sessionId: predictionSession }, throughSeq: afterPrediction.asOfSeq,
    } })
    const predictionEvents = auxiliaryPage.records.filter(record => record.event?.seq > beforePrediction.asOfSeq)
    assert(!predictionEvents.some(record => ['turn/start', 'user/message', 'assistant/message'].includes(record.event?.type)), 'Prediction must not submit a conversation turn')
    const loggedRequest = predictionEvents.find(record => record.event?.type === 'assistant/auxiliary' && record.event.data.phase === 'request' && record.event.data.purpose === 'prediction')
    const loggedResult = predictionEvents.find(record => record.event?.type === 'assistant/auxiliary' && record.event.data.phase === 'result' && record.event.data.purpose === 'prediction')
    assert(loggedRequest && loggedResult, 'Prediction requires reconstructable logged request and outcome')
    assert.equal(loggedRequest.event.data.id, loggedResult.event.data.id)
    assert(JSON.stringify(loggedRequest.event.data.messages).includes(composerContext.recentTexts.at(-1)))
    assert.equal(loggedResult.event.data.text, prediction.text)
    assert.equal(loggedResult.event.data.usage.totalTokens, 22)
    const usageAfter = await restartExisting.call('assistants/aggregateUsage', { request: usageRequest })
    const auxiliaryAfter = usageAfter.reduce((sum, item) => sum + item.auxiliaryTokens.totalTokens, 0)
    assert.equal(auxiliaryAfter - priorAuxiliary, 22)
    ok('Enabled packaged prediction produces actual provider output and accounts observed auxiliary usage')

    const activity = await restartExisting.call('assistants/getTeamActivity', { teamId: docTeamResult.team.id })
    assert(activity?.members.some(member => member.id === allocation.coordinatorSessionId), 'Legitimate live team activity must include its own coordinator')
    ok('Packaged activity projection returns the legitimate live team roster')
    const foreignLeadTeam = await restartExisting.call('assistants/createTeam', { options: {
      name: 'Foreign lead projection regression', coordinatorProfileId: coordProfile.id,
      leadSessionId: allocation.coordinatorSessionId,
    } })
    assert.equal(foreignLeadTeam.leadSessionId, allocation.coordinatorSessionId, 'Foreign-lead control must actually persist its borrowed lead')
    assert.equal(await restartExisting.call('assistants/getTeamActivity', { teamId: foreignLeadTeam.id }), undefined, 'Foreign saved lead must not expose another roster')
    ok('Packaged activity projection refuses another saved team pointing at a foreign coordinator')

    await restartExisting.stop()
    const recovered = new CompanionClient(appPath, existingHome, existingWorkspace)
    await recovered.start()
    const restoredReceipt = await recovered.call('assistants/startRound', { roundId: executionRound.id })
    assert.equal(restoredReceipt.id, executionRound.id)
    const restoredRound = await recovered.call('assistants/getRound', { roundId: executionRound.id })
    assert.equal(restoredRound.status, 'completed')
    assert.equal(restoredRound.totalTokensUsed, completed.totalTokensUsed)
    const restoredTranscript = await recovered.call('assistants/queryPublicTranscript', { options: { discussionId: disc.id } })
    assert.deepEqual(restoredTranscript.items, replies)
    const restoredCursor = await recovered.call('assistants/getReadCursor', { conversationId: disc.id })
    assert.equal(restoredCursor.lastReadSeq, 2)
    const restoredUsage = await recovered.call('assistants/aggregateUsage', { request: usageRequest })
    assert.equal(restoredUsage.reduce((sum, item) => sum + item.auxiliaryTokens.totalTokens, 0), auxiliaryAfter)
    await recovered.stop()
    ok('Cold packaged restart retains committed round, public transcript, read cursor, and observed auxiliary billing')

    await restartExisting.stop()
    rmSync(existingHome, { recursive: true, force: true })
    rmSync(existingWorkspace, { recursive: true, force: true })
    ok('Existing profile test cleanup complete')

  } catch (error) {
    primaryError = error
    console.error('Primary installed acceptance failure:', error)
    throw error
  } finally {
    const cleanupErrors = []
    for (const client of activeClients) {
      try { await client.stop() } catch (error) { cleanupErrors.push(error) }
    }
    try { await syntheticProvider.close() } catch (error) { cleanupErrors.push(error) }
    for (const path of temporaryPaths) {
      try { rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch (error) { cleanupErrors.push(error) }
    }
    try {
      execFileSync('hdiutil', ['detach', mountPoint, '-force'], { stdio: 'ignore' })
      ok(`Detached DMG mount at ${mountPoint}`)
    } catch (error) { cleanupErrors.push(error) }
    try { rmSync(mountPoint, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch (error) { cleanupErrors.push(error) }
    if (cleanupErrors.length > 0) {
      failCount += cleanupErrors.length
      console.error('Installed acceptance cleanup failures:', cleanupErrors)
      if (!primaryError) throw new AggregateError(cleanupErrors, 'Installed acceptance cleanup failed')
    }
  }

  assert.equal(failCount, 0, 'Acceptance must never succeed after a recorded failed check')
  console.log(`\n\x1b[1;32mS20 Verification Complete: ${passCount} checks passed, ${failCount} failures.\x1b[0m`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runVerification().catch((err) => {
  if (failCount === 0) failCount++
  console.error(`\x1b[1;31mS20 Verification FAILED: ${passCount} checks passed, ${failCount} failures.\x1b[0m`, err)
  process.exit(1)
})
