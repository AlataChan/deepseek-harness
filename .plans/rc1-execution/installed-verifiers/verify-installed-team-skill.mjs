#!/usr/bin/env node
/**
 * Stage A6 installed TEAM SKILL qualification (scratch verifier,
 * task_505e11641018). Executes against an explicit NEWLY COPIED installed
 * .app/resources directory — never the checkout, never an old dist as
 * acceptance. Bundled Node/runtime/plugins only; PATH admits the bundled
 * runtime and OS utilities; all model traffic is a local loopback HTTP server
 * with scripted Messages-protocol responses (no paid keys, no network).
 *
 * Reuses the installed target/runner pattern from
 * scripts/verify-dsh-context-installed-flows.mjs and the loopback scripted
 * provider + companion wire client from
 * scripts/verify-composer-predictions-installed-flows.mjs.
 *
 * Scope (root instruction, task_505e11641018): the bundled team-orchestration
 * SKILL qualification — packaged guide/package/two required refs and hashes,
 * ACTUAL installed filesystem-provider discovery through the public
 * `skills/list` Remote, real project>home>bundled precedence, skill-tool +
 * resource reads through a real controller turn (scripted loopback model),
 * an explicit ad-hoc team flow through the REAL Team tools, and an
 * ordinary-chat control. The standing-native team / full-task-mail /
 * effective-model-route gate is owned separately by
 * verify-installed-questions-and-team.mjs — this script LINKS that gate and
 * does not claim it.
 *
 * The installed startup refresh invoker is the Tauri binary itself
 * (apps/desktop/src-tauri/src/app.rs run().setup() → install_bundled_skills).
 * This verifier does NOT simulate that copy and call it Rust startup
 * acceptance: it validates the packaged payload the invoker consumes and
 * documents the authorized GUI-launch probe (`--probe-startup-refresh`,
 * authored here, executed by root against the new DMG — see
 * ../stage-a/installed-verifier-preflight.md).
 *
 * Usage:
 *   node verify-installed-team-skill.mjs <installed .app or resources dir> [--source <repo-root>]
 *   node verify-installed-team-skill.mjs <installed .app dir> --probe-startup-refresh
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer as createHttpServer } from 'node:http'
import {
  accessSync, constants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_NAME = 'team-orchestration'
const REQUIRED_REFS = ['references/task-spec.md', 'references/recovery.md']

/**
 * Pinned sha256 of the packaged skill payload, computed from
 * .agents/skills/team-orchestration at verifier authoring time (2026-11-04,
 * post cursor-team-replay-final-review acceptance). Root refreshes these if
 * the skill source changes before the DMG build (see preflight doc).
 */
const PINNED_SHA256 = {
  'SKILL.md': '8103154a79a588ca36e9572233482cfc23d7fe455b520a0820167e121eabfa48',
  'package.json': '0bd6a3100beaf4ffaa6979992b22585cbe0ca42b3d3dda83fb657e0ec6e0d022',
  'references/task-spec.md': '9f3989e529d3c93333a97934805e4eefa74db0d91008adda7b004327abf2bd6a',
  'references/recovery.md': '10a94a4a093caa3b277d98ce1ef1bb7e70248af2a88934e2ae2d8ee23cc28984',
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** `needle` as it appears inside a JSON.stringify'd payload. */
function jsonHas(jsonText, needle) {
  return jsonText.includes(JSON.stringify(needle).slice(1, -1))
}

function requireInside(root, path) {
  const actual = realpathSync(path)
  const rel = relative(root, actual)
  assert(!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`),
    `Installed path escaped target: ${path}`)
  return actual
}

/** Executable search path: bundled runtime + OS utilities only, no inherited PATH. */
export function installedVerificationPath(node) {
  const systemDirectories = process.platform === 'win32'
    ? [join(realpathSync(process.env.SystemRoot), 'System32'), realpathSync(process.env.SystemRoot)]
    : ['/usr/bin', '/bin', '/usr/sbin', '/sbin']
  return [dirname(node), ...systemDirectories].join(delimiter)
}

/** A real regular file (never a symlink) with content. */
function realFile(path, label) {
  const stat = lstatSync(path)
  assert(stat.isFile(), `${label} must be a real file: ${path}`)
  assert(!stat.isSymbolicLink(), `${label} must not be a symlink: ${path}`)
  assert(stat.size > 0, `${label} must not be empty: ${path}`)
  return path
}

/**
 * Validate the real installed target before any runtime executes: bundled
 * runtime + companion + profile plugins (string-or-array patch paths) and the
 * packaged team-orchestration skill payload the Rust startup refresh consumes.
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
  assert(lstatSync(pluginRoot).isDirectory(), 'Installed profile-plugins directory is missing')
  for (const scope of readdirSync(pluginRoot)) {
    const scopeDir = join(pluginRoot, scope)
    if (!lstatSync(scopeDir).isDirectory()) continue
    for (const name of scope.startsWith('@') ? readdirSync(scopeDir) : ['']) {
      const path = name ? join(scopeDir, name) : scopeDir
      const manifest = JSON.parse(readFileSync(requireInside(resources, join(path, 'package.json')), 'utf8'))
      if (!manifest.dsh?.bundle?.patch) continue
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
  const teamClient = plugins.find(item => item.manifest.name === '@deepseek-ai/dsh-experimental-client-ui-agent-team')
  assert(teamClient, 'Installed client-ui-agent-team bundle is missing (mounts the Host agent-team + tool-agent-team services)')

  // Packaged skill payload: the exact tree the Tauri startup refresh copies.
  const skillRoot = requireInside(resources, join(resources, 'bundled-skills', SKILL_NAME))
  const files = { 'SKILL.md': realFile(join(skillRoot, 'SKILL.md'), `packaged ${SKILL_NAME} guide`) }
  for (const ref of REQUIRED_REFS) {
    files[ref] = realFile(requireInside(resources, join(skillRoot, ref)), `packaged ${SKILL_NAME} ref ${ref}`)
  }
  const pkgPath = requireInside(resources, join(skillRoot, 'package.json'))
  files['package.json'] = pkgPath
  const hashes = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, sha256(path)]))

  // Packaged seed revision the startup refresh stamps (app.rs SEED_REVISION_FILE).
  const seedRevPath = join(resources, 'seed-rev.txt')
  assert(lstatSync(seedRevPath).isFile(), 'Installed seed-rev.txt is missing from resources')
  const seedRev = readFileSync(seedRevPath, 'utf8').trim()
  assert(/^[0-9a-f]{64}$/.test(seedRev), `Installed seed revision must be 64 lowercase hex: ${seedRev}`)

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
  return { resources, node, companion, plugins, skillRoot, files, hashes, seedRev }
}

/** Validate the packaged skill metadata and (optionally) byte-compare against a checkout source tree. */
function verifyPackagedPayload(bundle, sourceRoot) {
  const guide = readFileSync(bundle.files['SKILL.md'], 'utf8')
  assert(guide.startsWith('---\n'), 'Packaged SKILL.md must carry frontmatter')
  assert(guide.includes(`name: ${SKILL_NAME}`), `Packaged SKILL.md frontmatter must name ${SKILL_NAME}`)
  assert(/description: \S/.test(guide), 'Packaged SKILL.md frontmatter must carry a non-empty description')
  assert(/whenToUse: \S/.test(guide), 'Packaged SKILL.md frontmatter must carry whenToUse guidance')
  for (const ref of REQUIRED_REFS) {
    assert(guide.includes(ref), `Packaged SKILL.md body must reference ${ref} so the model can find it`)
    assert(readFileSync(bundle.files[ref], 'utf8').length > 0, `Packaged ref ${ref} must have content`)
  }
  const pkg = JSON.parse(readFileSync(bundle.files['package.json'], 'utf8'))
  assert.equal(pkg.name, SKILL_NAME, 'Packaged package.json name must match the skill name')
  assert.equal(pkg.version, '0.1.0', 'Packaged package.json must pin version 0.1.0')

  for (const [key, pinned] of Object.entries(PINNED_SHA256)) {
    assert.equal(bundle.hashes[key], pinned,
      `Packaged ${key} sha256 drifted from the A6-pinned source revision: ${bundle.hashes[key]}`)
  }

  if (sourceRoot !== undefined) {
    const sourceSkill = resolve(sourceRoot, '.agents', 'skills', SKILL_NAME)
    for (const key of Object.keys(bundle.hashes)) {
      const source = realFile(join(sourceSkill, key), `source ${key}`)
      assert.equal(sha256(source), bundle.hashes[key],
        `Packaged ${key} is not byte-identical to the checkout source`)
    }
  }
  return { guide, pkg }
}

/**
 * Scripted loopback provider: each /messages request consumes the next
 * sequence entry; an entry may be a function of the request payload so the
 * verifier can assert real model-visible tool results and compute follow-up
 * tool args from them. Messages protocol only, loopback bind only.
 */
function scriptedProvider() {
  const state = { sequence: [], observations: [], route: undefined }
  const server = createHttpServer(async (request, response) => {
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
          console.error('Scripted provider assertion:', error)
          if (!response.destroyed) response.writeHead(500).end(String(error))
        })
      }
      item.finish = finish
      finish()
    } catch (error) {
      console.error('Scripted provider request:', error)
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

const delay = ms => new Promise(done => setTimeout(done, ms))
async function until(read, predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  do {
    const value = await read()
    if (predicate(value)) return value
    await delay(30)
  } while (Date.now() < deadline)
  throw new Error(`Bounded wait expired: ${label}`)
}

/**
 * Companion wire client: control/hello handshake, client-request RPC, fresh
 * HOME/workspace, bundled runtime only. DSH_BUNDLED_SKILL_DIR is set so the
 * skill-filesystem provider mounts the packaged payload as its 'bundled'
 * tier (rank 600) — the provider's packaged-root mechanism.
 */
class InstalledClient {
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
      DSH_BUNDLED_SKILL_DIR: join(this.bundle.resources, 'bundled-skills'),
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
    const rpcId = `team-skill-installed-${this.nextId++}`
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

/** Reproduce the documented outcome of the Rust startup installer: copy the packaged payload into the user-dsh skill root. */
function seedSkillIntoHome(home, skillRoot) {
  const destination = join(home, '.dsh', 'skills', SKILL_NAME)
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(skillRoot, destination, { recursive: true })
  return destination
}

/** An unrelated user-installed skill the startup refresh must never touch. */
function writeUnrelatedUserSkill(home) {
  const dir = join(home, '.dsh', 'skills', 'user-handbook')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), [
    '---',
    'name: user-handbook',
    'description: 用户自装技能：刷新重装时必须原样保留。',
    'whenToUse: 用户明确要求查阅用户手册时。',
    '---',
    '',
    '# 用户手册',
    '',
    'USER_HANDBOOK_PRESERVATION_MARKER',
    '',
  ].join('\n'))
  return dir
}

/** A project-tier variant of the team skill that must outrank home and bundled tiers. */
function writeProjectSkill(workspace) {
  const dir = join(workspace, '.dsh', 'skills', SKILL_NAME)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), [
    '---',
    `name: ${SKILL_NAME}`,
    'description: 项目层覆盖变体：验证 project-dsh(rank 100) 高于 user-dsh(400) 和 bundled(600)。',
    'whenToUse: 项目显式覆盖时使用。',
    '---',
    '',
    '# 项目层 team-orchestration 覆盖',
    '',
    'PROJECT_PRECEDENCE_MARKER',
    '',
  ].join('\n'))
  return dir
}

/** First content line of a packaged file, used as a read-through marker. */
function contentMarker(path) {
  const body = readFileSync(path, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  const line = body.split('\n')
    .map(row => row.trim())
    .find(row => row.length >= 15 && !row.startsWith('#') && !row.startsWith('---') && !row.startsWith('```'))
  assert(line, `No usable content marker line in ${path}`)
  return line
}

/** Public skill catalog for one session through the real sessionSkillCatalog Remote. */
async function listSkills(client, sessionId) {
  const value = await client.call('skills/list', { request: { sessionId } })
  assert(Array.isArray(value.skills), 'skills/list must return a skills array')
  return value.skills
}

async function waitCompletedTurn(client, sessionId, afterSeq) {
  return until(async () => {
    const projection = await client.call('session/projections', { request: { sessionId } })
    const page = await client.call('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: projection.asOfSeq } })
    const ended = page.records.find(row => row.event?.type === 'turn/end' && row.event.seq > afterSeq)
    if (ended) assert.equal(ended.event.data.reason.kind, 'completed', JSON.stringify(ended.event.data.reason))
    return ended
  }, Boolean, 'completed canonical turn')
}

const completedTurnSeq = async (client, sessionId) => {
  const projection = await client.call('session/projections', { request: { sessionId } })
  const page = await client.call('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: projection.asOfSeq } })
  return Math.max(0, ...page.records.map(row => row.event?.seq ?? 0))
}

async function newSession(client, workspace) {
  const workspaceValue = await client.call('workspace/create', { request: { path: workspace } })
  const created = await client.call('session/create', { request: { workspaceId: workspaceValue.workspace.workspaceId } })
  const catalog = await client.call('session/modelCatalog')
  const providerGroup = catalog.groups.find(group => group.id === 'deepseek-official')
  assert(providerGroup?.models.length, 'Loopback provider has no installed routable catalog models')
  await client.call('session/selectModel', { request: { sessionId: created.sessionId, provider: providerGroup.id, model: providerGroup.models[0].id } })
  return created.sessionId
}

async function prompt(client, sessionId, requestId, text) {
  await client.call('session/prompt', {
    request: { sessionId, requestId, mode: 'queue', content: [{ type: 'text', text }] },
  })
}

/**
 * Authorized fresh-home launch probe of the ACTUAL Tauri binary. Authored for
 * root to execute against the new DMG — never run as a quiet default. Opens a
 * brief GUI window on the executing machine (documented preflight gap); it
 * never touches the user's real DSH home because HOME/DSH_HOME point at a
 * fresh isolated home.
 */
async function probeStartupRefresh(target, timeoutMs) {
  assert(process.platform === 'darwin', 'The Tauri startup-refresh probe is authored for macOS DMG targets')
  const running = spawnSync('/bin/ps', ['-A', '-o', 'comm='], { encoding: 'utf8' })
  assert.equal(running.status, 0, 'Could not check the startup probe single-instance precondition')
  assert(!/\.app\/Contents\/MacOS\/dsh-desktop$/m.test(running.stdout),
    'Close the running desktop before the startup-refresh probe; the single-instance guard prevents a fresh-home launch')
  const base = realpathSync(resolve(target))
  const binary = join(base, 'Contents', 'MacOS', 'dsh-desktop')
  assert(lstatSync(binary).isFile() && !lstatSync(binary).isSymbolicLink(), `Actual Tauri binary missing: ${binary}`)
  accessSync(binary, constants.X_OK)
  const payload = validateInstalledTarget(String(base))
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'team-skill-startup-')))
  const home = join(root, 'home')
  mkdirSync(join(home, 'Library', 'Application Support'), { recursive: true })
  // Pre-existing state the real refresh must respect: a modified bundled skill
  // (re-copied from the payload) and an unrelated user skill (preserved).
  const seeded = seedSkillIntoHome(home, payload.skillRoot)
  writeFileSync(join(seeded, 'SKILL.md'), 'stale payload control — must be replaced by the refresh\n')
  const unrelated = writeUnrelatedUserSkill(home)
  const env = {
    HOME: home, USERPROFILE: home, DSH_HOME: join(home, '.dsh'),
    PATH: installedVerificationPath(payload.node),
    TMPDIR: root, TMP: root, TEMP: root,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  }
  console.log(`▶ Launching the actual Tauri binary with isolated HOME=${home} (a window may appear briefly)`)
  const child = spawn(binary, [], { env, cwd: home, stdio: 'ignore', detached: false })
  try {
    const skillMd = join(seeded, 'SKILL.md')
    await until(() => {
      try { return sha256(skillMd) === payload.hashes['SKILL.md'] ? sha256(skillMd) : undefined } catch { return undefined }
    }, Boolean, 'startup refresh re-copied the packaged payload', timeoutMs)
    const stamp = await until(() => {
      const path = join(home, '.dsh', 'skills', '.dsh-seed-rev')
      return existsSync(path) ? readFileSync(path, 'utf8').trim() : undefined
    }, value => value === payload.seedRev, 'startup refresh committed the seed revision', timeoutMs)
    assert.equal(stamp, payload.seedRev, 'Startup refresh must stamp the packaged seed revision')
    for (const ref of REQUIRED_REFS) {
      assert.equal(sha256(join(seeded, ref)), payload.hashes[ref], `Refreshed ${ref} must stay byte-identical to the packaged payload`)
    }
    assert.match(readFileSync(join(unrelated, 'SKILL.md'), 'utf8'), /USER_HANDBOOK_PRESERVATION_MARKER/,
      'Startup refresh must preserve the unrelated user skill')
    const companionLog = join(home, 'Library', 'Application Support', 'studio.octopus.dsh', 'companion.log')
    const log = existsSync(companionLog) ? readFileSync(companionLog, 'utf8') : ''
    assert.match(log, /bundled-skills reseeded/, 'Companion log must record the bundled-skills reseed decision')
    console.log('  ✓ Actual Tauri startup refresh: payload re-copied, refs intact, unrelated user skill preserved, stamp + log recorded')
  } finally {
    try { child.kill('SIGTERM') } catch {}
    await new Promise(done => {
      const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} done() }, 5000)
      child.once('exit', () => { clearTimeout(timer); done() })
    })
    rmSync(root, { recursive: true, force: true })
  }
}

async function run() {
  const argv = process.argv.slice(2)
  const probe = argv.includes('--probe-startup-refresh')
  const sourceIndex = argv.indexOf('--source')
  const sourceRoot = sourceIndex === -1 ? undefined : argv[sourceIndex + 1]
  const target = argv.find((arg, index) => !arg.startsWith('--') && arg !== sourceRoot && (sourceIndex === -1 || index !== sourceIndex + 1))
  assert(target, 'Usage: verify-installed-team-skill.mjs <installed .app or resources dir> [--source <repo-root>]')

  if (probe) {
    assert(!sourceRoot, '--probe-startup-refresh does not take --source')
    await probeStartupRefresh(target, 90000)
    console.log('\n✓ STARTUP REFRESH PROBE COMPLETE')
    return
  }

  let checks = 0
  const check = (condition, label) => { assert(condition, label); console.log(`✓ ${label}`); checks++ }

  console.log('▶ S1: packaged team-orchestration payload, pins, and seed revision')
  const bundle = validateInstalledTarget(target)
  const { guide } = verifyPackagedPayload(bundle, sourceRoot)
  check(true, `Packaged payload verified: SKILL.md + package.json + ${REQUIRED_REFS.join(', ')} with pinned sha256`)
  for (const [key, hash] of Object.entries(bundle.hashes)) console.log(`    ${key}: ${hash}`)
  check(guide.includes('spawn_teammate') && guide.includes('list_agents') && guide.includes('wait_agent')
    && guide.includes('send_message') && guide.includes('team_task_create') && guide.includes('team_task_update'),
    'Packaged guide documents the real Team tool surface it guides')

  const root = realpathSync(mkdtempSync(join(tmpdir(), 'team-skill-installed-')))
  const provider = scriptedProvider()
  await provider.listen()
  const providerURL = `http://127.0.0.1:${provider.server.address().port}`
  const clients = []
  let active = null

  try {
    // Two isolated homes: home1 = user payload + unrelated user skill;
    // home2 = empty skill root, used for the bundled-tier baseline first.
    const home1 = join(root, 'home1')
    const home2 = join(root, 'home2')
    const workspace1 = join(root, 'workspace1')
    const workspace2 = join(root, 'workspace2')
    for (const dir of [home1, home2, workspace1, workspace2]) mkdirSync(dir, { recursive: true })
    writeUnrelatedUserSkill(home1)
    seedSkillIntoHome(home1, bundle.skillRoot)
    const homeSkillDir = join(home1, '.dsh', 'skills', SKILL_NAME)

    const client2 = new InstalledClient(bundle, home2, workspace2, providerURL)
    const client1 = new InstalledClient(bundle, home1, workspace1, providerURL)
    clients.push(client2, client1)

    console.log('▶ S2: installed filesystem-provider discovery and project>home>bundled precedence')
    // Tier 'bundled' (rank 600) alone: packaged payload via DSH_BUNDLED_SKILL_DIR, empty home root.
    active = client2
    client2.seed()
    await client2.start()
    const sessionBundled = await newSession(client2, workspace2)
    const bundledList = await listSkills(client2, sessionBundled)
    const bundledEntry = bundledList.find(row => row.name === SKILL_NAME)
    assert(bundledEntry, 'skills/list must discover team-orchestration from the bundled tier')
    assert.equal(bundledEntry.path, join(bundle.resources, 'bundled-skills', SKILL_NAME, 'SKILL.md'),
      'Bundled tier must win from the actual packaged payload directory')
    assert.equal(bundledEntry.modelInvocable, true, 'Packaged team skill must be model-invocable')
    check(true, 'Bundled tier discovers the packaged payload through the real provider')
    await client2.stop()

    // Tier 'user-dsh' (rank 400) beats 'bundled' (600): seed the payload into home2.
    seedSkillIntoHome(home2, bundle.skillRoot)
    await client2.start()
    const sessionHome2 = await newSession(client2, workspace2)
    const home2Entry = (await listSkills(client2, sessionHome2)).find(row => row.name === SKILL_NAME)
    assert.equal(home2Entry?.path, join(home2, '.dsh', 'skills', SKILL_NAME, 'SKILL.md'),
      'Home (user-dsh) tier must outrank the bundled tier for the same skill name')
    check(true, 'Precedence home > bundled proven through the real provider')
    await client2.stop()

    // Tier 'project-dsh' (rank 100) beats 'user-dsh' (400), and home discovery survives restart.
    const projectSkillDir = writeProjectSkill(workspace1)
    active = client1
    client1.seed()
    await client1.start()
    const sessionProject = await newSession(client1, workspace1)
    const projectEntry = (await listSkills(client1, sessionProject)).find(row => row.name === SKILL_NAME)
    assert.equal(projectEntry?.path, join(projectSkillDir, 'SKILL.md'),
      'Project (project-dsh) tier must outrank the home tier for the same skill name')
    check(true, 'Precedence project > home proven through the real provider')
    await client1.stop()

    rmSync(projectSkillDir, { recursive: true, force: true })
    await client1.start()
    const sessionHome1 = await newSession(client1, workspace1)
    const home1List = await listSkills(client1, sessionHome1)
    const home1Entry = home1List.find(row => row.name === SKILL_NAME)
    assert.equal(home1Entry?.path, join(homeSkillDir, 'SKILL.md'),
      'After the project variant is removed, the home tier wins again (durable seeded copy)')
    const userSkill = home1List.find(row => row.name === 'user-handbook')
    assert(userSkill, 'The unrelated user skill must stay discoverable beside the bundled skill')
    check(userSkill.path === join(home1, '.dsh', 'skills', 'user-handbook', 'SKILL.md'),
      'Unrelated user skill discovered from its own home directory')

    console.log('▶ S3: skill-tool + resource reads through a real controller turn')
    const skillBase = homeSkillDir
    const guideMarker = contentMarker(join(skillBase, 'SKILL.md'))
    const taskSpecMarker = contentMarker(bundle.files['references/task-spec.md'])
    const recoveryMarker = contentMarker(bundle.files['references/recovery.md'])
    provider.state.sequence.push(
      [{ tool: true, id: 'call-skill-1', name: 'skill', args: { name: SKILL_NAME } }],
      // The skill tool result is model-visible in this next request: assert the
      // real rendered <skill_content> and the resource base before reading refs.
      payload => {
        const text = JSON.stringify(payload.messages)
        assert(jsonHas(text, '<skill_content name="team-orchestration">'),
          'The real skill tool result must render the canonical <skill_content> block')
        assert(jsonHas(text, `Base directory for this skill: ${skillBase}`),
          'The skill result must point the model at the actual winning skill directory')
        assert(jsonHas(text, guideMarker), 'The loaded skill body must be the packaged guide content')
        return [{ tool: true, id: 'call-read-1', name: 'read', args: { file_path: join(skillBase, 'references', 'task-spec.md') } }]
      },
      payload => {
        const text = JSON.stringify(payload.messages)
        assert(jsonHas(text, taskSpecMarker), 'The read tool result must carry the packaged task-spec.md content')
        return [{ tool: true, id: 'call-read-2', name: 'read', args: { file_path: join(skillBase, 'references', 'recovery.md') } }]
      },
      payload => {
        const text = JSON.stringify(payload.messages)
        assert(jsonHas(text, recoveryMarker), 'The read tool result must carry the packaged recovery.md content')
        return [{ text: '技能资源读取完成。' }]
      },
    )
    const beforeSkillTurn = await completedTurnSeq(client1, sessionHome1)
    await prompt(client1, sessionHome1, 'a6-skill-turn', `请加载 ${SKILL_NAME} 技能并核对参考资料 A6_SKILL_FLOW_PROBE`)
    await waitCompletedTurn(client1, sessionHome1, beforeSkillTurn)
    check(true, 'Real turn loaded the skill through the skill tool and read both packaged refs via the read tool')

    // Negative control: an unknown skill fails honestly instead of faking.
    provider.state.sequence.push(
      [{ tool: true, id: 'call-skill-bad', name: 'skill', args: { name: 'no-such-skill-x' } }],
      payload => {
        const text = JSON.stringify(payload.messages)
        assert(jsonHas(text, 'is unknown or no longer available'),
          'An unknown skill must produce the honest tool error')
        return [{ text: '已如实转述技能缺失。' }]
      },
    )
    const beforeBadTurn = await completedTurnSeq(client1, sessionHome1)
    await prompt(client1, sessionHome1, 'a6-skill-negative', '加载一个不存在的技能 no-such-skill-x')
    await waitCompletedTurn(client1, sessionHome1, beforeBadTurn)
    check(true, 'Unknown-skill control reports the honest error through the real tool path')

    console.log('▶ S4: explicit ad-hoc team flow through the REAL Team tools')
    provider.state.route = payload => {
      if (JSON.stringify(payload.system).includes('Your Team role is teammate')) return [{ text: '队员收到，继续。' }]
      // Mail can wake the Lead before waitCompletedTurn observes its prior turn.
      const text = JSON.stringify(payload.messages)
      if (provider.state.sequence.length === 0 && text.includes('TEAM_FLOW_DONE')
        && text.includes('请用 Agent Teams 建一个临时队友 researcher 做验证')) {
        return [{ text: 'Team follow-up acknowledged.' }]
      }
      return undefined
    }
    provider.state.sequence.push(
      [{ tool: true, id: 'call-spawn', name: 'spawn_teammate', args: {
        name: 'researcher',
        description: 'A6 安装验收的临时研究员。',
        prompt: '这是 A6 安装验收任务：请直接回复一条状态说明并结束。',
        context: 'fresh',
      } }],
      payload => {
        const text = JSON.stringify(payload.messages)
        assert(jsonHas(text, '"name":"researcher"'), 'spawn_teammate must return the created teammate identity')
        return [{ tool: true, id: 'call-list', name: 'list_agents', args: {} }]
      },
      payload => {
        const text = JSON.stringify(payload.messages)
        assert(jsonHas(text, '"role":"teammate"') && text.includes('researcher'),
          'list_agents must expose the spawned teammate with its Team role')
        return [{ tool: true, id: 'call-send', name: 'send_message', args: {
          target: 'researcher', message: 'A6 安装验收：请报告当前状态 A6_TEAM_FLOW_PROBE。',
        } }]
      },
      payload => {
        const text = JSON.stringify(payload.messages)
        assert(jsonHas(text, '"messageId"'), 'send_message must return a durable message id')
        assert(jsonHas(text, '"status":"accepted"') || jsonHas(text, '"status":"queued"'),
          'send_message must report an accepted or durable-queued status')
        return [{ text: 'TEAM_FLOW_DONE' }]
      },
    )
    const beforeTeamTurn = await completedTurnSeq(client1, sessionHome1)
    await prompt(client1, sessionHome1, 'a6-team-turn', '请用 Agent Teams 建一个临时队友 researcher 做验证')
    await waitCompletedTurn(client1, sessionHome1, beforeTeamTurn)
    const teamView = await client1.call('agentTeams/view', { agentId: sessionHome1 })
    assert(Array.isArray(teamView.members), 'agentTeams/view must expose the roster')
    const lead = teamView.members.find(row => row.role === 'lead')
    const researcher = teamView.members.find(row => row.name === 'researcher')
    assert(lead && researcher, 'Roster must contain the Lead and the ad-hoc teammate')
    check(teamView.members.length >= 2, `Explicit team flow through REAL tools: roster holds ${teamView.members.length} members (lead + researcher)`)

    assert.equal(provider.state.sequence.length, 0, 'Explicit Team tool tape must be fully consumed')
    const teammateRoute = provider.state.route
    provider.state.route = payload => teammateRoute(payload)
      ?? (JSON.stringify(payload.messages).includes('请用 Agent Teams 建一个临时队友 researcher 做验证')
        ? [{ text: 'Team follow-up acknowledged.' }] : undefined)
    const mailProjection = await client1.call('session/projections', { request: { sessionId: sessionHome1 } })
    const mailPage = await client1.call('session/page', { request: {
      address: { kind: 'session', sessionId: sessionHome1 }, throughSeq: mailProjection.asOfSeq,
    } })
    const savedMail = mailPage.records.filter(row => row.event?.type === 'team/message/queued'
      && JSON.stringify(row.event.data).includes('A6_TEAM_FLOW_PROBE')).map(row => row.event.data.message.id)
    assert.equal(savedMail.length, 1, 'Exactly one real authored Team mail must be durable before restart')

    console.log('▶ S5: ordinary-chat control')
    const sessionPlain = await newSession(client1, workspace1)
    provider.state.sequence.push([{ text: '普通回复，不涉及团队。' }])
    const beforePlainTurn = await completedTurnSeq(client1, sessionPlain)
    const observationsBeforePlain = provider.state.observations.length
    await prompt(client1, sessionPlain, 'a6-plain-turn', '普通聊天：今天天气如何？A6_PLAIN_PROBE')
    await waitCompletedTurn(client1, sessionPlain, beforePlainTurn)
    const plainRequest = provider.state.observations.slice(observationsBeforePlain)
      .find(item => JSON.stringify(item.payload.messages).includes('A6_PLAIN_PROBE'))
    assert(plainRequest, 'The ordinary-chat control turn must dispatch exactly its own provider request')
    const plainText = JSON.stringify(plainRequest.payload.messages)
    assert(!jsonHas(plainText, '<skill_content name='), 'Ordinary chat must not auto-load any canonical skill body')
    assert(!plainRequest.payload.messages.some(message => Array.isArray(message.content)
      && message.content.some(block => block.type === 'tool_use' || block.type === 'tool_result')),
    'Ordinary chat control must run without tool calls or results')
    check(true, 'Ordinary-chat control: no skill load, no team tool traffic, turn completed')

    console.log('▶ S6: restart persistence and refresh inputs')
    await client1.stop()
    active = null
    assert.equal(sha256(join(skillBase, 'SKILL.md')), bundle.hashes['SKILL.md'], 'Home skill copy must survive restarts byte-identical')
    for (const ref of REQUIRED_REFS) {
      assert.equal(sha256(join(skillBase, ref)), bundle.hashes[ref], `Home ref ${ref} must survive restarts byte-identical`)
    }
    assert.match(readFileSync(join(home1, '.dsh', 'skills', 'user-handbook', 'SKILL.md'), 'utf8'), /USER_HANDBOOK_PRESERVATION_MARKER/,
      'Unrelated user skill must survive alongside the bundled skill')
    await client1.start()
    active = client1
    const sessionRestored = await newSession(client1, workspace1)
    const restored = (await listSkills(client1, sessionRestored)).find(row => row.name === SKILL_NAME)
    assert.equal(restored?.path, join(skillBase, 'SKILL.md'), 'Cold restart must keep discovering the seeded bundled skill')
    check(true, 'Cold restart preserves the seeded skill, both refs, and the unrelated user skill')
    const coldMailProjection = await client1.call('session/projections', { request: { sessionId: sessionHome1 } })
    const coldMailPage = await client1.call('session/page', { request: {
      address: { kind: 'session', sessionId: sessionHome1 }, throughSeq: coldMailProjection.asOfSeq,
    } })
    for (const id of savedMail) assert(coldMailPage.records.some(row =>
      row.event?.type === 'team/message/queued' && row.event.data.message.id === id), 'Cold log must retain the exact authored mail')
    check(true, 'Cold restart retains the exact durable Team message identity and content')


    console.log('\n▶ LINKED GATE (not claimed here): the standing-native Team / full task mail /')
    console.log('  effective-model-route installed gate lives in orchestration/verify-installed-questions-and-team.mjs')
    console.log('  (agentTeams/listInstitutionSquads + ensureInstitutionSquad + cold-restart Lead binding).')
    console.log(`\n✓ READY: installed team-skill qualification passed (${checks} checks).`)
    return checks
  } finally {
    if (active) { try { await active.stop() } catch {} }
    try { await provider.close() } catch {}
    rmSync(root, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error('\n✗ FAILED installed team-skill qualification:', error)
    process.exit(1)
  })
}
