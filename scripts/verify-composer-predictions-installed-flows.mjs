#!/usr/bin/env node
/**
 * Execute synthetic prediction acceptance against an explicit installed app/resources directory.
 * This verifier never imports checkout product code or invokes workspace build/test commands.
 * Browser keyboard/presentation acceptance is a separate browser lane.
 * Executable discovery admits the bundled runtime and platform system utilities only.
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { accessSync, constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function requireInside(root, path) {
  const actual = realpathSync(path)
  const rel = relative(root, actual)
  assert(!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`), `Installed path escaped target: ${path}`)
  return actual
}

/** Validate real installed files before any runtime executes. */
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
  const harness = JSON.parse(readFileSync(requireInside(resources, join(resources, 'harness', 'package.json')), 'utf8'))
  assert(harness.name && harness.version, 'Installed harness manifest is invalid')
  const plugins = []
  const pluginRoot = join(resources, 'profile-plugins')
  for (const scope of readdirSync(pluginRoot)) {
    const scopeDir = join(pluginRoot, scope)
    if (!lstatSync(scopeDir).isDirectory()) continue
    for (const name of scope.startsWith('@') ? readdirSync(scopeDir) : ['']) {
      const path = name ? join(scopeDir, name) : scopeDir
      const manifestPath = requireInside(resources, join(path, 'package.json'))
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (!manifest.dsh?.bundle?.patch) continue
      requireInside(resources, join(path, manifest.dsh.bundle.patch))
      requireInside(resources, join(path, manifest.main ?? 'lib/index.js'))
      plugins.push({ path, manifest })
    }
  }
  const registryPath = join(resources, 'harness', 'node_modules', '@deepseek-ai', 'dsh-experimental-assistant-registry')
  const registry = JSON.parse(readFileSync(requireInside(resources, join(registryPath, 'package.json')), 'utf8'))
  assert.equal(registry.name, '@deepseek-ai/dsh-experimental-assistant-registry')
  requireInside(resources, join(registryPath, registry.main ?? 'lib/index.js'))
  const client = plugins.find(item => item.manifest.name === '@deepseek-ai/dsh-experimental-client-ui-assistants')
  assert(client, 'Installed client-ui-assistants package is missing')
  const clientExport = client.manifest.exports?.['./client']
  const clientPath = typeof clientExport === 'string' ? clientExport : clientExport?.default
  assert(typeof clientPath === 'string', 'Installed Client export is missing')
  requireInside(resources, join(client.path, clientPath))
  // No dependency symlink may quietly resolve to this checkout or global packages.
  const inspect = path => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      assert(!entry.isSymbolicLink(), `Installed closure contains a symlink: ${child}`)
      if (entry.isDirectory()) inspect(child)
    }
  }
  inspect(join(resources, 'harness'))
  inspect(pluginRoot)
  const version = spawnSync(node, ['--version'], { encoding: 'utf8', timeout: 5000, env: {} })
  assert.equal(version.status, 0, `Installed Node cannot execute: ${version.stderr}`)
  assert.match(version.stdout, /^v\d+\./)
  return { resources, node, companion, plugins }
}

/**
 * Keep installed verification independent of developer tools while admitting OS utilities.
 * @param node - validated absolute path to the installed Node executable.
 * @returns executable search path containing no inherited PATH entries.
 */
export function installedVerificationPath(node) {
  let systemDirectories
  if (process.platform === 'win32') {
    assert(process.env.SystemRoot && isAbsolute(process.env.SystemRoot), 'Windows SystemRoot is required')
    const windows = realpathSync(process.env.SystemRoot)
    systemDirectories = [join(windows, 'System32'), windows]
  } else {
    systemDirectories = ['/usr/bin', '/bin', '/usr/sbin', '/sbin']
  }
  return [dirname(node), ...systemDirectories].join(delimiter)
}

const delay = ms => new Promise(done => setTimeout(done, ms))
async function until(read, predicate, label, timeout = 12000) {
  const deadline = Date.now() + timeout
  do {
    const value = await read()
    if (predicate(value)) return value
    await delay(30)
  } while (Date.now() < deadline)
  throw new Error(`Bounded wait expired: ${label}`)
}

class InstalledClient {
  constructor(bundle, home, workspace, providerURL) {
    Object.assign(this, { bundle, home, workspace, providerURL })
    this.pending = new Map()
    this.predictions = new Map()
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
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', private: true, dependencies, dsh: { profile: { bundles } } }) + '\n')
    writeFileSync(join(profile, 'cordis.patch.yml'), `- id: llm-deepseek\n  config:\n    baseURL: '${this.providerURL}'\n    thinking: disabled\n    retryPolicy:\n      mode: normal\n      maxRetries: 0\n- id: assistant-registry\n  config:\n    enableMemoryReview: false\n`)
  }
  async start() {
    const env = {
      HOME: this.home, USERPROFILE: this.home, DSH_HOME: join(this.home, '.dsh'),
      OCTOPUS_APP_DATA: join(this.home, 'app-data'), OCTOPUS_SIDECAR_HOME: join(this.bundle.resources, 'kb-runtime'),
      DEEPSEEK_API_KEY: 'synthetic-loopback-only', PATH: installedVerificationPath(this.bundle.node),
      TMPDIR: this.home, TMP: this.home, TEMP: this.home,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    }
    const ready = new Promise((done, reject) => { this.ready = { done, reject } })
    this.child = spawn(this.bundle.node, [this.bundle.companion, '--workspace-root', this.workspace], { env, cwd: this.home, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-16000) })
    let buffer = ''
    this.child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8')
      for (let index; (index = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1)
        let wire
        try { wire = JSON.parse(line) } catch { continue /* Non-protocol bootstrap diagnostics. */ }
        if (wire.type !== 'wire/message') continue
        const frame = JSON.parse(wire.encoded)
        if (frame.type === 'control/ready') this.ready?.done(frame)
        if (frame.type === 'stream/frame' || frame.type === 'stream/error' || frame.type === 'stream/end') {
          const prediction = this.predictions.get(frame.streamId)
          if (prediction) {
            this.predictions.delete(frame.streamId); clearTimeout(prediction.timer)
            if (frame.type === 'stream/error') prediction.reject(new Error(frame.message))
            else prediction.done(frame.type === 'stream/frame' ? frame.value : null)
          }
        }
        if (frame.type === 'rpc/message' && frame.message?.type === 'server-response') {
          const pending = this.pending.get(frame.message.rpcId)
          if (pending) { this.pending.delete(frame.message.rpcId); clearTimeout(pending.timer); pending.done(frame.message.result) }
        }
      }
    })
    const failed = error => {
      this.ready?.reject(error)
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error) }
      this.pending.clear()
      for (const prediction of this.predictions.values()) { clearTimeout(prediction.timer); prediction.reject(error) }
      this.predictions.clear()
    }
    this.child.once('error', failed)
    this.child.once('exit', code => failed(new Error(`Installed companion exited (${code}): ${this.stderr}`)))
    this.send({ type: 'control/hello', protocolVersion: 2, extensionVersion: '0.1.2', workspaceRoot: this.workspace, locale: 'zh' })
    let timer
    try { return await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Installed boot timed out: ${this.stderr}`)), 20000) })]) }
    finally { clearTimeout(timer); this.ready = undefined }
  }
  send(frame) { this.child.stdin.write(JSON.stringify({ type: 'wire/message', encoded: JSON.stringify(frame) }) + '\n') }
  async call(method, args = {}) {
    const rpcId = `prediction-acceptance-${this.nextId++}`
    const response = new Promise((done, reject) => {
      const timer = setTimeout(() => { this.pending.delete(rpcId); reject(new Error(`Installed RPC timed out: ${method}`)) }, 15000)
      this.pending.set(rpcId, { done, reject, timer })
    })
    this.send({ type: 'rpc/message', message: { type: 'client-request', rpcId, method, payload: { args } } })
    const result = await response
    assert(result.ok, `Installed RPC ${method} refused: ${JSON.stringify(result.error)}`)
    return result.value
  }
  predict(request) {
    const streamId = `prediction-stream-${this.nextId++}`
    return new Promise((done, reject) => {
      const timer = setTimeout(() => {
        this.predictions.delete(streamId)
        this.send({ type: 'stream/close', streamId })
        reject(new Error('Installed prediction stream diagnostic deadline exceeded'))
      }, 30000)
      this.predictions.set(streamId, { done, reject, timer })
      this.send({ type: 'stream/open', streamId, endpoint: 'assistants/streamComposerPrediction', payload: { args: { request } } })
    })
  }
  async stop() {
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise(done => child.once('exit', done))
    this.send({ type: 'control/shutdown' })
    const term = setTimeout(() => child.kill('SIGTERM'), 3000)
    const kill = setTimeout(() => child.kill('SIGKILL'), 5000)
    let timeout
    try { await Promise.race([exited, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Installed companion shutdown timed out')), 7000) })]) }
    finally { clearTimeout(term); clearTimeout(kill); clearTimeout(timeout) }
  }
}

/** Run installed Host acceptance with synthetic credentials and local-only model traffic. */
export async function verifyInstalledPredictions(target) {
  const bundle = validateInstalledTarget(target)
  let checks = 0
  const check = (condition, label) => { assert(condition, label); console.log(`✓ ${label}`); checks++ }
  const root = mkdtempSync(join(tmpdir(), 'composer-installed-'))
  const home = join(root, 'home'), workspace = join(root, 'workspace')
  mkdirSync(home); mkdirSync(workspace)
  const observations = []
  const responses = new Set()
  let hold = false
  const server = createServer(async (request, response) => {
    try {
      assert(request.url?.endsWith('/messages'), 'Only Messages protocol traffic is permitted')
      let body = ''
      for await (const chunk of request) { body += chunk; assert(Buffer.byteLength(body) < 2000000, 'Synthetic request exceeded bound') }
      const payload = JSON.parse(body)
      const item = { payload, response, closed: false }
      observations.push(item); responses.add(response)
      response.on('close', () => { item.closed = true; responses.delete(response) })
      item.finish = () => {
        if (response.destroyed) return
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        const event = data => response.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)
        event({ type: 'message_start', message: { id: `synthetic-${observations.length}`, type: 'message', role: 'assistant', model: payload.model, content: [], usage: { input_tokens: 14, output_tokens: 0 } } })
        event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
        event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '请继续检查这项实现。' } })
        event({ type: 'content_block_stop', index: 0 })
        event({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } })
        event({ type: 'message_stop' }); response.end()
      }
      if (!hold) item.finish()
    } catch (error) { response.writeHead(500).end(String(error)) }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const client = new InstalledClient(bundle, home, workspace, `http://127.0.0.1:${server.address().port}`)
  let sessionId
  const history = async () => {
    const projection = await client.call('session/projections', { request: { sessionId } })
    return client.call('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: projection.asOfSeq } })
  }
  const setting = async enabled => {
    const view = await client.call('settings/describe')
    const namespace = view.namespaces.find(row => row.ns === 'assistant-registry')
    assert(namespace, 'Installed prediction settings namespace missing')
    return client.call('settings/update', { ns: 'assistant-registry', patch: { enableComposerPredictions: enabled }, expectedRevision: namespace.revision })
  }
  try {
    client.seed()
    await client.start()
    check(true, 'Bundled companion boots from isolated installed profile')
    const workspaceValue = await client.call('workspace/create', { request: { path: workspace } })
    const created = await client.call('session/create', { request: { workspaceId: workspaceValue.workspace.workspaceId } })
    sessionId = created.sessionId
    check(typeof sessionId === 'string', 'Public remote creates ordinary unbound session')
    const catalog = await client.call('session/modelCatalog')
    const provider = catalog.groups.find(group => group.id === 'deepseek-official')
    assert(provider?.models.length, 'Synthetic provider has no installed routable catalog models')
    const selectedModel = provider.models.find(model => model.id !== catalog.default.model) ?? provider.models[0]
    const route = { provider: provider.id, model: selectedModel.id }
    await client.call('session/selectModel', { request: { sessionId, ...route } })
    check(provider.models.length < 2 || route.model !== catalog.default.model, 'Public selection exercises an available non-default model route')
    const prompt = async text => {
      const previous = await history()
      const previousSeq = Math.max(0, ...previous.records.map(row => row.event?.seq ?? 0))
      const receipt = await client.call('session/prompt', { request: { sessionId, requestId: `installed-turn-${Date.now()}`, mode: 'queue', content: [{ type: 'text', text }] } })
      assert(receipt.accepted, 'Synthetic turn was not admitted')
      return until(history, page => page.records.some(row => row.event?.type === 'turn/end' && row.event.seq > previousSeq && row.event.data.reason.kind === 'completed'), 'completed canonical turn')
    }
    await prompt('核验下一步建议的真实上下文 INSTALLED_PREDICTION_INTENT')
    const predict = (asOfSeq, draftText = '') => client.predict({ sessionId, asOfSeq, draftText })
    let context = await client.call('assistants/getComposerContext', { sessionId })
    const beforeDisabled = observations.length
    check(context === null, 'Predictions are disabled by default')
    check(await predict(1) === null && observations.length === beforeDisabled, 'Disabled request dispatches no model call')
    await setting(true)
    context = await client.call('assistants/getComposerContext', { sessionId })
    check(context?.asOfSeq > 0, 'General setting enables ordinary-chat prediction context')
    const beforeInvalid = observations.length
    for (const draft of [' ', '\n', 'already typed']) assert.equal(await predict(context.asOfSeq, draft), null)
    assert.equal(await predict(context.asOfSeq - 1), null)
    check(observations.length === beforeInvalid, 'Whitespace, nonempty drafts and stale sequence dispatch zero calls')
    hold = true
    const first = predict(context.asOfSeq), second = predict(context.asOfSeq)
    await until(() => observations.length, count => count > beforeInvalid, 'shared prediction request')
    await delay(12000)
    const whilePending = await client.call('settings/describe')
    check(whilePending.namespaces.some(row => row.ns === 'assistant-registry'), 'Settings remain responsive during a prediction held beyond both former deadlines')
    check(observations.length === beforeInvalid + 1, 'Concurrent public requests share one actual provider dispatch')
    const actual = observations.at(-1)
    actual.finish(); hold = false
    const [a, b] = await Promise.all([first, second])
    check(a?.text === '请继续检查这项实现。' && b?.text === a.text, 'Both public subscribers receive actual synthetic provider result')
    check(actual.payload.model === route.model, 'Ordinary prediction uses explicitly selected next model route')
    check(!actual.payload.tools?.length && JSON.stringify(actual.payload.messages).includes('INSTALLED_PREDICTION_INTENT'), 'Prediction is tool-free and uses canonical logged turn intent')
    const page = await history()
    const requestEvent = page.records.find(row => row.event?.type === 'assistant/auxiliary' && row.event.data.phase === 'request')?.event
    const resultEvent = page.records.find(row => row.event?.type === 'assistant/auxiliary' && row.event.data.phase === 'result')?.event
    check(requestEvent && resultEvent && requestEvent.data.id === resultEvent.data.id, 'Installed history retains linked auxiliary request and result')
    check(requestEvent.data.model === actual.payload.model && JSON.stringify(requestEvent.data.messages).includes('INSTALLED_PREDICTION_INTENT'), 'Logged prediction route and canonical context match actual provider dispatch')
    check(resultEvent.data.usage?.totalTokens === 22 && a.usage?.usage?.totalTokens === 22, 'Provider-reported auxiliary billing is observed without estimates')
    const usageRequest = { sessionBindings: [{ sessionId, bindingId: 'installed-ordinary-conversation', startBoundarySeq: 0 }] }
    const billed = await client.call('assistants/aggregateUsage', { request: usageRequest })
    const auxiliaryTokens = billed.reduce((sum, item) => sum + item.auxiliaryTokens.totalTokens, 0)
    check(auxiliaryTokens === 22, 'Installed usage aggregation includes exactly the real prediction bill')
    await prompt('继续核验关闭预测时取消请求 INSTALLED_PREDICTION_CANCEL')
    context = await client.call('assistants/getComposerContext', { sessionId })
    assert(context?.asOfSeq > 0)
    hold = true
    const startCount = observations.length
    const cancelled = predict(context.asOfSeq)
    await until(() => observations.length, count => count > startCount, 'held inference before opt-out')
    const held = observations.at(-1)
    await setting(false)
    check(await cancelled === null, 'Disabling live setting rejects in-flight prediction')
    await until(() => held.closed, Boolean, 'provider cancellation')
    check(held.closed, 'Opt-out cancellation reaches actual provider connection')
    hold = false
    await setting(true)
    await client.stop()
    await client.start()
    const coldSettings = await client.call('settings/describe')
    check(coldSettings.namespaces.find(row => row.ns === 'assistant-registry')?.value.enableComposerPredictions === true, 'Cold restart restores persisted opt-in setting')
    const callsBeforeHistory = observations.length
    const restored = await history()
    check(restored.records.some(row => row.event?.type === 'assistant/auxiliary' && row.event.data.usage?.totalTokens === 22), 'Cold restart preserves real auxiliary billing evidence')
    const restoredBilling = await client.call('assistants/aggregateUsage', { request: usageRequest })
    check(restoredBilling.reduce((sum, item) => sum + item.auxiliaryTokens.totalTokens, 0) === auxiliaryTokens, 'Cold restart restores durable auxiliary usage totals')
    check(observations.length === callsBeforeHistory, 'Opening retained history after restart dispatches no inference')
    await prompt('重启后继续核验新的已完成轮次 INSTALLED_PREDICTION_RESTART')
    context = await client.call('assistants/getComposerContext', { sessionId })
    check(context?.asOfSeq > 0, 'A new completed ordinary turn after restart becomes eligible')
    const afterRestart = await predict(context.asOfSeq)
    check(afterRestart?.text === '请继续检查这项实现。', 'Cold runtime executes fresh eligible prediction using persisted opt-in')
    await setting(false)
    const beforeColdDisabled = observations.length
    await client.stop(); await client.start()
    assert.equal(await client.call('assistants/getComposerContext', { sessionId }), null)
    check(observations.length === beforeColdDisabled, 'Cold restart retains opt-out without background inference')
    console.log(`Installed Host prediction acceptance: ${checks} checks passed. Browser UI acceptance is separate.`)
    return checks
  } finally {
    try { await client.stop() } finally {
      for (const response of responses) response.destroy()
      server.closeAllConnections()
      await new Promise(done => server.close(done))
      rmSync(root, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyInstalledPredictions(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1 })
}
