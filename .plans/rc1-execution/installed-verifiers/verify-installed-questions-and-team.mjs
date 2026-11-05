#!/usr/bin/env node
/**
 * Installed persistent-questions + agent-team acceptance (scratch verifier,
 * B1.5 task_b7b8af58534e). Executes against an explicit NEWLY COPIED installed
 * .app/resources directory — never the checkout, never an old dist as
 * acceptance. Bundled Node/runtime/plugins only; PATH admits the bundled
 * runtime and OS utilities; all model traffic is a local loopback HTTP server
 * with scripted Messages-protocol responses (no paid keys, no network).
 *
 * Reuses the public installed target/runner pattern from
 * scripts/verify-dsh-context-installed-flows.mjs and the loopback scripted
 * provider + companion wire client from
 * scripts/verify-composer-predictions-installed-flows.mjs.
 *
 * Scope (root instruction msg_450338e3ad10): installed question-producing
 * tool, catalog/get card metadata, queued submit + exact-request dedup,
 * restart-persisted question/answer, Goal activation semantics, and the
 * busy-team fallback where the installed public API supports it. The agent
 * team section is explicitly gated: when the installed public Remote surface
 * does not expose team operations, it reports UNIMPLEMENTED instead of faking.
 * Root owns the build and executes this against the new DMG.
 *
 * Usage: node verify-installed-questions-and-team.mjs <installed .app or resources dir>
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import {
  accessSync, constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function requireInside(root, path) {
  const actual = realpathSync(path)
  const rel = relative(root, actual)
  assert(!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
    `Installed path escaped target: ${path}`)
  return actual
}

/**
 * Validate the real installed target before any runtime executes, including
 * the pinned persistent-questions feature bundle.
 */
export function validateInstalledTarget(target) {
  assert(target, 'Explicit installed app or resources directory is required')
  const base = realpathSync(resolve(target))
  const resources = existsSync(join(base, 'Contents', 'Resources', 'resources'))
    ? realpathSync(join(base, 'Contents', 'Resources', 'resources'))
    : existsSync(join(base, 'resources', 'harness')) ? realpathSync(join(base, 'resources')) : base
  requireInside(base, resources)
  const node = requireInside(resources, join(resources, process.platform === 'win32' ? 'node.exe' : 'node'))
  assert(lstatSync(node).isFile(), 'Installed Node must be a file')
  accessSync(node, constants.X_OK)
  const companion = requireInside(resources, join(resources, 'harness', 'lib', 'desktop-companion.js'))
  assert(lstatSync(companion).isFile(), 'Installed companion entry is missing')

  const plugins = []
  const pluginRoot = join(resources, 'profile-plugins')
  for (const scope of readdirSync(pluginRoot)) {
    const scopeDir = join(pluginRoot, scope)
    if (!lstatSync(scopeDir).isDirectory()) continue
    for (const name of scope.startsWith('@') ? readdirSync(scopeDir) : ['']) {
      const path = name ? join(scopeDir, name) : scopeDir
      const manifest = JSON.parse(readFileSync(requireInside(resources, join(path, 'package.json')), 'utf8'))
      if (!manifest.dsh?.bundle?.patch) continue
      // The declared patch is a string or an array of layer files; each must
      // be a real installed file (session-decisions declares two).
      const patchLayers = Array.isArray(manifest.dsh.bundle.patch)
        ? manifest.dsh.bundle.patch : [manifest.dsh.bundle.patch]
      assert(patchLayers.length > 0, `Installed bundle declares no patch layers: ${manifest.name}`)
      for (const layer of patchLayers) {
        assert(typeof layer === 'string' && layer.length > 0, `Invalid patch layer in ${manifest.name}`)
        requireInside(resources, join(path, layer))
      }
      requireInside(resources, join(path, manifest.main ?? 'lib/index.js'))
      plugins.push({ path, manifest })
    }
  }
  const decisions = plugins.find(item => item.manifest.name === '@deepseek-ai/dsh-experimental-session-decisions')
  assert(decisions, 'Installed pinned session-decisions bundle is missing from profile-plugins')
  const decisionsPreset = existsSync(join(decisions.path, 'preset.cordis.yml'))
  assert(decisionsPreset, 'Installed session-decisions bundle lacks its preset patch')

  // No dependency symlink may quietly resolve to a checkout or global packages.
  const inspect = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      assert(!entry.isSymbolicLink(), `Installed closure contains a symlink: ${child}`)
      if (entry.isDirectory()) inspect(child)
    }
  }
  inspect(join(resources, 'harness'))
  inspect(pluginRoot)

  const version = spawnSync(node, ['--version'], { encoding: 'utf8', timeout: 90000, env: {} })
  assert.equal(version.status, 0, `Installed Node cannot execute: ${version.stderr}`)
  assert.match(version.stdout, /^v\d+\./)
  return { resources, node, companion, plugins, decisions }
}

/** Executable search path: bundled runtime + OS utilities only, no inherited PATH. */
export function installedVerificationPath(node) {
  const systemDirectories = process.platform === 'win32'
    ? [join(realpathSync(process.env.SystemRoot), 'System32'), realpathSync(process.env.SystemRoot)]
    : ['/usr/bin', '/bin', '/usr/sbin', '/sbin']
  return [dirname(node), ...systemDirectories].join(delimiter)
}

const delay = ms => new Promise(done => setTimeout(done, ms))
async function until(read, predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  do {
    const value = await read()
    if (predicate(value)) return value
    await delay(30)
  } while (Date.now() < deadline)
  throw new Error(`Bounded wait expired: ${label}`)
}

/**
 * Scripted loopback provider: each /messages request consumes the next
 * sequence entry; an entry may be a hold-gate (promise) so a turn stays live
 * while the verifier drives queue mutations, exactly like the Host lane's
 * gated adapter streams. Messages protocol only, loopback bind only.
 */
export function scriptedProvider() {
  const state = { sequence: [], observations: [], route: undefined }
  const server = createServer(async (request, response) => {
    try {
      assert(request.url?.endsWith('/messages'), 'Only Messages protocol traffic is permitted')
      let body = ''
      for await (const chunk of request) {
        body += chunk
        assert(Buffer.byteLength(body) < 2000000, 'Synthetic request exceeded bound')
      }
      const payload = JSON.parse(body)
      const item = { payload, response, closed: false }
      state.observations.push(item)
      response.on('close', () => { item.closed = true })
      const finish = () => {
        const entry = state.route?.(payload) ?? state.sequence.shift()
        assert(entry !== undefined, 'Scripted provider sequence exhausted')
        Promise.resolve(typeof entry === 'function' ? entry(payload) : entry).then(script => {
          if (response.destroyed) return
          response.writeHead(200, { 'content-type': 'text/event-stream' })
          const event = data => response.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)
          event({ type: 'message_start', message: { id: `synthetic-${state.observations.length}`, type: 'message', role: 'assistant', model: payload.model, content: [], usage: { input_tokens: 14, output_tokens: 0 } } })
          let index = 0
          for (const block of script) {
            event({ type: 'content_block_start', index, content_block: block.tool
              ? { type: 'tool_use', id: block.id, name: block.name, input: {} }
              : { type: 'text', text: '' } })
            if (block.tool) {
              event({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.args) } })
            } else {
              event({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } })
            }
            event({ type: 'content_block_stop', index })
            index += 1
          }
          event({ type: 'message_delta', delta: { stop_reason: script.some(block => block.tool) ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } })
          event({ type: 'message_stop' })
          response.end()
        }, error => {
          if (!response.destroyed) response.writeHead(500).end(String(error))
        })
      }
      item.finish = finish
      if (!state.hold) finish()
    } catch (error) {
      response.writeHead(500).end(String(error))
    }
  })
  return {
    state,
    server,
    listen: () => new Promise(done => server.listen(0, '127.0.0.1', done)),
    close: () => {
      server.closeAllConnections()
      return new Promise(done => server.close(done))
    },
  }
}

/**
 * Companion wire client (same protocol surface as the composer verifier):
 * control/hello handshake, client-request RPC, fresh HOME/workspace, bundled
 * runtime only.
 */
export class InstalledClient {
  constructor(bundle, home, workspace, providerURL) {
    Object.assign(this, { bundle, home, workspace, providerURL })
    this.pending = new Map()
    this.nextId = 1
    this.stderr = ''
  }

  seed() {
    const profile = join(this.home, '.dsh', 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-desktop-app']
    const dependencies = {}
    for (const { path, manifest } of this.bundle.plugins) {
      const destination = join(profile, 'node_modules', ...manifest.name.split('/'))
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(path, destination, { recursive: true })
      bundles.push(manifest.name)
      dependencies[manifest.name] = manifest.version
    }
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      name: 'dsh-profile-desktop', private: true, dependencies, dsh: { profile: { bundles } },
    }) + '\n')
    // Synthetic loopback provider route + the feature preset under test.
    writeFileSync(join(profile, 'cordis.patch.yml'), [
      `- id: llm-deepseek`,
      `  config:`,
      `    baseURL: '${this.providerURL}'`,
      `    thinking: disabled`,
      `    retryPolicy:`,
      `      mode: normal`,
      `      maxRetries: 0`,
      '- id: session-title-llm', '  disabled: true',
      '- id: session-log-deepseek', '  disabled: true',
      '- id: assistant-registry', '  config:', '    enableMemoryReview: false',
    ].join('\n') + '\n')
  }

  async start() {
    const env = {
      DSH_TELEMETRY_DISABLED: '1',
      HOME: this.home, USERPROFILE: this.home, DSH_HOME: join(this.home, '.dsh'),
      OCTOPUS_APP_DATA: join(this.home, 'app-data'), OCTOPUS_SIDECAR_HOME: join(this.bundle.resources, 'kb-runtime'),
      DEEPSEEK_API_KEY: 'synthetic-loopback-only', PATH: installedVerificationPath(this.bundle.node),
      TMPDIR: this.home, TMP: this.home, TEMP: this.home,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    }
    const ready = new Promise((done, reject) => { this.ready = { done, reject } })
    this.child = spawn(this.bundle.node, [this.bundle.companion, '--workspace-root', this.workspace], {
      env, cwd: this.home, stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-16000) })
    let buffer = ''
    this.child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8')
      for (let index; (index = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        let wire
        try { wire = JSON.parse(line) } catch { continue /* Non-protocol bootstrap diagnostics. */ }
        if (wire.type !== 'wire/message') continue
        const frame = JSON.parse(wire.encoded)
        if (frame.type === 'control/ready') this.ready?.done(frame)
        if (frame.type === 'rpc/message' && frame.message?.type === 'server-response') {
          const pending = this.pending.get(frame.message.rpcId)
          if (pending) {
            this.pending.delete(frame.message.rpcId)
            clearTimeout(pending.timer)
            pending.done(frame.message.result)
          }
        }
      }
    })
    const failed = error => {
      this.ready?.reject(error)
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error) }
      this.pending.clear()
    }
    this.child.once('error', failed)
    this.child.once('exit', code => failed(new Error(`Installed companion exited (${code}): ${this.stderr}`)))
    this.send({ type: 'control/hello', protocolVersion: 2, extensionVersion: '0.1.2', workspaceRoot: this.workspace, locale: 'zh' })
    let timer
    try {
      return await Promise.race([ready, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Installed boot timed out: ${this.stderr}`)), 30000)
      })])
    } finally { clearTimeout(timer); this.ready = undefined }
  }

  send(frame) { this.child.stdin.write(JSON.stringify({ type: 'wire/message', encoded: JSON.stringify(frame) }) + '\n') }

  /** One installed Remote RPC; `args` is the named-args object for the namespace method. */
  async call(method, args = {}) {
    const rpcId = `questions-installed-${this.nextId++}`
    const response = new Promise((done, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rpcId)
        reject(new Error(`Installed RPC timed out: ${method}`))
      }, 20000)
      this.pending.set(rpcId, { done, reject, timer })
    })
    this.send({ type: 'rpc/message', message: { type: 'client-request', rpcId, method, payload: { args } } })
    const result = await response
    assert(result.ok, `Installed RPC ${method} refused: ${JSON.stringify(result.error)}`)
    return result.value
  }

  async stop() {
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise(done => child.once('exit', done))
    this.send({ type: 'control/shutdown' })
    const term = setTimeout(() => child.kill('SIGTERM'), 3000)
    const kill = setTimeout(() => child.kill('SIGKILL'), 5000)
    let timeout
    try {
      await Promise.race([exited, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Installed companion shutdown timed out')), 7000)
      })])
    } finally { clearTimeout(term); clearTimeout(kill); clearTimeout(timeout) }
  }
}

/** Compose the choice-answer body exactly as the feature's pinned contract states. */
const choiceAnswer = (decisionId, ordinal) => `Answer to question ${decisionId}: option ${ordinal}`

/** Run the installed B1 questions acceptance; returns the check count. */
export async function verifyInstalledQuestions(target) {
  const bundle = validateInstalledTarget(target)
  let checks = 0
  const check = (condition, label) => { assert(condition, label); console.log(`✓ ${label}`); checks++ }
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'questions-installed-')))
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  mkdirSync(home)
  mkdirSync(workspace)
  const provider = scriptedProvider()
  await provider.listen()
  const client = new InstalledClient(bundle, home, workspace, `http://127.0.0.1:${provider.server.address().port}`)
  try {
    client.seed()
    await client.start()
    check(true, 'Bundled companion boots from isolated installed profile')

    const workspaceValue = await client.call('workspace/create', { request: { path: workspace } })
    const created = await client.call('session/create', {
      request: { workspaceId: workspaceValue.workspace.workspaceId, agentPreset: 'persistent-questions' },
    })
    const sessionId = created.sessionId
    check(typeof sessionId === 'string', 'Public remote creates a session on the persistent-questions preset')

    const catalogModels = await client.call('session/modelCatalog')
    const providerGroup = catalogModels.groups.find(group => group.id === 'deepseek-official')
    assert(providerGroup?.models.length, 'Loopback provider has no installed routable catalog models')
    await client.call('session/selectModel', { request: { sessionId, provider: providerGroup.id, model: providerGroup.models[0].id } })

    // Bounded wait for one completed canonical turn on the public history page.
    const history = async () => {
      const projection = await client.call('session/projections', { request: { sessionId } })
      return client.call('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: projection.asOfSeq } })
    }

    // --- Installed question-producing tool through the real turn path.
    provider.state.sequence.push([{ tool: true, id: 'call-ask', name: 'request_persistent_question', args: {
      question: 'Enable the installed beta flag?', choices: ['Enable', 'Hold'], ttlMs: 60000,
    } }])
    const before = provider.state.observations.length
    await client.call('session/prompt', {
      request: { sessionId, requestId: 'installed-q1', mode: 'queue', content: [{ type: 'text', text: 'Ask me about the beta flag.' }] },
    })
    const decision = await until(async () => {
      const page = await client.call('sessionDecisions/catalog', { sessionId })
      return Array.isArray(page) && page.length === 1 ? page[0] : undefined
    }, Boolean, 'question record from the installed tool path').catch(async error => {
      console.error('Question diagnostic:', JSON.stringify({ observations: provider.state.observations.map(item => ({
        model: item.payload.model, tools: item.payload.tools?.map(tool => tool.name),
      })), history: (await history()).records.filter(row => !['request/header', 'request/context'].includes(row.event?.type)).slice(-8), stderr: client.stderr }).slice(-16000))
      throw error
    })
    check(provider.state.observations.length === before + 1, 'Question production used exactly one real provider dispatch')
    check(decision.lifecycle === 'open' && Array.isArray(decision.choices) && decision.choices.length === 2,
      'Installed catalog exposes the open question with card metadata')

    const view = await client.call('sessionDecisions/get', { decisionId: decision.decisionId })
    check(view?.requestId === decision.requestId && typeof view.revision === 'number',
      'Installed get returns the correlated requestId and revision')

    // --- Queued submit: the answer turn needs a real scripted model response;
    // wait for its actual settlement before classifying retries.
    const pageBefore = await history()
    const beforeSeq = Math.max(0, ...pageBefore.records.map(row => row.event?.seq ?? 0))
    provider.state.sequence.push([{ text: 'Installed answer turn reply.' }])
    const submitted = await client.call('sessionDecisions/submit', {
      decisionId: decision.decisionId, expectedRevision: view.revision, requestId: view.requestId,
      payload: { choiceOrdinal: 1 },
    })
    check(submitted.outcome === 'accepted', 'Installed submit accepts the composed choice answer')
    await until(history, page => page.records.some(row =>
      row.event?.type === 'turn/end' && row.event.seq > beforeSeq && row.event.data.reason.kind === 'completed'),
    'completed answer turn after submit')
    const duplicate = await client.call('sessionDecisions/submit', {
      decisionId: decision.decisionId, expectedRevision: view.revision, requestId: view.requestId,
      payload: { choiceOrdinal: 1 },
    })
    check(duplicate.outcome === 'admitted', 'Exact-request retry classifies as admitted without a new prompt')
    const conflicting = await client.call('sessionDecisions/submit', {
      decisionId: decision.decisionId, expectedRevision: view.revision, requestId: view.requestId,
      payload: { choiceOrdinal: 2 },
    })
    check(conflicting.outcome === 'rejected', 'Conflicting retry is rejected on the installed path')

    // --- Restart persistence: the answered record and dedup survive cold restart.
    // (Goal activation semantics stay in the Host lane goldens; the installed
    // case leaves them explicitly pending — no Goal is created here.)
    const afterAnswer = await client.call('sessionDecisions/get', { decisionId: decision.decisionId })
    check(afterAnswer.lifecycle === 'answered' && afterAnswer.answerIndex === 'admitted',
      'Answered record settles durably on the installed Host')

    // --- Restart persistence: the answered record and dedup survive cold restart.
    await client.stop()
    await client.start()
    const restored = await client.call('sessionDecisions/get', { decisionId: decision.decisionId })
    check(restored.lifecycle === 'answered' && restored.answerIndex === 'admitted',
      'Cold restart restores the answered question record')
    const restoredRetry = await client.call('sessionDecisions/submit', {
      decisionId: decision.decisionId, expectedRevision: restored.revision, requestId: restored.requestId,
      payload: { choiceOrdinal: 1 },
    })
    check(restoredRetry.outcome === 'admitted', 'Exact-request dedup survives restart without a second prompt')

    // --- Native team section over the actual installed agentTeams routes.
    // The desktop ships @deepseek-ai/dsh-experimental-client-ui-agent-team,
    // whose cordis.patch.yml mounts the HOST agent-team + tool-agent-team
    // services — package presence is NOT the capability gate. A refused RPC
    // is reported as the exact API failure instead.
    const squads = await client.call('agentTeams/listInstitutionSquads')
    if (squads !== undefined) {
      check(Array.isArray(squads) && squads.some(row => row.id === 'case'), 'Installed nativeTeam lists the institution squads')
      const caseSquad = squads.find(row => row.id === 'case')
      const seatName = caseSquad?.seats?.[0]?.name
      assert(seatName, 'Installed case squad exposes no seat names')
      const routeModel = (providerGroup.models[1] ?? providerGroup.models[0])?.id
      assert(routeModel, 'Loopback catalog model missing for the seat route')

      provider.state.route = payload => JSON.stringify(payload.system).includes('Your Team role is teammate')
        ? [{ text: 'Teammate standing reply.' }] : undefined
      for (let index = 0; index < 6; index += 1) provider.state.sequence.push([{ text: 'Standing report noted.' }])

      // Ensure: binds this Session as Lead and spawns ONLY missing seats,
      // with the requested route stored before spawn.
      const ensured = await client.call('agentTeams/ensureInstitutionSquad', {
        agentId: sessionId,
        request: { squadId: 'case', seats: [{ name: seatName, provider: 'deepseek-official', model: routeModel }] },
      })
      const memberCount = ensured.members.length
      check(memberCount >= 2, `Ensure binds the Lead and spawns missing seats (${memberCount} members)`)
      check(ensured.sessionId === sessionId, 'Ensure binds the caller Session as the standing Lead')

      // No-new-seat on second ensure: the roster is stable.
      const ensuredAgain = await client.call('agentTeams/ensureInstitutionSquad', {
        agentId: sessionId, request: { squadId: 'case' },
      })
      check(ensuredAgain.members.length === memberCount, 'Second ensure spawns no new seats')

      // Seat routes stored in the institution catalog: names from the
      // returned list, provider/model exactly as requested.
      const storedSquads = await client.call('agentTeams/listInstitutionSquads')
      const storedCase = storedSquads.find(row => row.id === 'case')
      const storedSeat = storedCase?.seats?.find(seat => seat.name === seatName)
      check(storedSeat?.provider === 'deepseek-official' && storedSeat?.model === routeModel,
        'Requested seat route is stored exactly (provider + model) in the institution catalog')

      // TeamView: members, tasks, interactions through the scoped wire.
      const teamView = await client.call('agentTeams/view', { agentId: sessionId })
      check(Array.isArray(teamView.members) && teamView.members.length === memberCount
        && Array.isArray(teamView.tasks) && Array.isArray(teamView.interactions),
      'Installed TeamView exposes members, tasks, and interactions')

      const selectedMember = teamView.members.find(member => member.name === seatName)
      console.log('Runtime model-route evidence:', JSON.stringify({ seatName, routeModel, members: teamView.members }))
      check(selectedMember?.model === routeModel,
        'Runtime Team roster reports the requested model (provider identifies the continuation implementation)')
      await until(() => client.call('agentTeams/view', { agentId: sessionId }),
        current => current.members.every(member => member.role === 'lead' || member.status !== 'running'),
        'standing teammates settle before persistence checkpoint')
      check(provider.state.observations.some(item => item.payload.model === routeModel &&
        JSON.stringify(item.payload.system).includes('Your Team role is teammate')),
      'The loopback provider actually received a teammate request on the selected model')
      const createdTask = await client.call('agentTeams/createTask', { agentId: sessionId,
        request: { subject: 'Installed persistence probe', description: 'Retain a real completed task across restart.' } })
      check(createdTask.ok, 'Public Team task creation commits a real task')
      const claimedTask = await client.call('agentTeams/updateTask', { agentId: sessionId,
        request: { taskId: createdTask.value.id, expectedRevision: createdTask.value.revision, action: 'claim' } })
      check(claimedTask.ok, 'Public Team task claim records ownership')
      const completedTask = await client.call('agentTeams/updateTask', { agentId: sessionId,
        request: { taskId: claimedTask.value.id, expectedRevision: claimedTask.value.revision, action: 'complete' } })
      check(completedTask.ok && completedTask.value.status === 'completed', 'Public Team task completion commits')

      // Restart evidence: the persisted institution catalog keeps the bound
      // Lead binding across a cold restart.
      await client.stop()
      await client.start()
      const restoredSquads = await client.call('agentTeams/listInstitutionSquads')
      const restoredCase = restoredSquads.find(row => row.id === 'case')
      check(restoredCase?.established === true && restoredCase.leadSessionId === sessionId,
        'Cold restart restores the persisted squad Lead binding')
      await client.call('session/prompt', { request: { sessionId, requestId: 'installed-restore-team', mode: 'queue',
        content: [{ type: 'text', text: 'Read the saved Team task board.' }] } })
      const restoredTeam = await client.call('agentTeams/view', { agentId: sessionId })
      check(restoredTeam.tasks.some(task => task.id === createdTask.value.id && task.status === 'completed'),
        'Cold restart retains the actual completed Team task')
    }

    console.log(`Installed questions and native Team acceptance: ${checks} checks passed.`)
    return checks
  } finally {
    try { await client.stop() } finally { await provider.close() }
    rmSync(root, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyInstalledQuestions(process.argv[2]).catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
