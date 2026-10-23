#!/usr/bin/env node
/**
 * Packaged context acceptance: confined Host RPCs, production Rust seeding,
 * and the matching built desktop page through the native carrier harness.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function requireInside(root, path) {
  const actual = realpathSync(path)
  const rel = relative(root, actual)
  assert(!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`), `Installed path escaped target: ${path}`)
  return actual
}

/** Validate real installed files and metadata before any runtime executes. */
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

  const pluginRoot = join(resources, 'profile-plugins')
  const manifestPath = requireInside(resources, join(pluginRoot, 'plugins.json'))
  assert(lstatSync(manifestPath).isFile(), 'plugins.json must exist in profile-plugins')

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.schemaVersion, 1, 'plugins.json must declare schemaVersion: 1')
  assert(manifest.plugins && typeof manifest.plugins === 'object', 'plugins.json must have plugins object')

  const contextEntry = manifest.plugins['dsh-context']
  assert(contextEntry, 'plugins.json must contain dsh-context')
  assert.equal(contextEntry.version, '0.74.0', 'plugins.json must pin dsh-context@0.74.0')
  assert.equal(contextEntry.defaultEnabled, false, 'plugins.json must declare defaultEnabled: false for dsh-context')

  const contextDir = requireInside(resources, join(pluginRoot, 'dsh-context'))
  assert(lstatSync(contextDir).isDirectory(), 'dsh-context directory must exist in profile-plugins')

  const contextPkg = JSON.parse(readFileSync(requireInside(resources, join(contextDir, 'package.json')), 'utf8'))
  assert.equal(contextPkg.name, 'dsh-context', 'dsh-context package.json name must match')
  assert.equal(contextPkg.version, '0.74.0', 'dsh-context package.json version must match 0.74.0')
  assert(contextPkg.exports?.['./client'], 'dsh-context must export ./client')

  const clientBundlePath = requireInside(resources, join(contextDir, 'lib', 'client.js'))
  assert(lstatSync(clientBundlePath).isFile(), 'dsh-context lib/client.js must exist')

  const version = spawnSync(node, ['--version'], { encoding: 'utf8', timeout: 5000, env: {} })
  assert.equal(version.status, 0, `Installed Node cannot execute: ${version.stderr}`)

  return { resources, node, companion, pluginRoot }
}

function verificationPath(node) {
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

/** Check if an endpoint address strictly resolves to a loopback host (rejecting wildcards and WAN IPs). */
export function isLoopbackEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'string') return false
  const trimmed = endpoint.trim()
  if (!trimmed) return false

  let host = trimmed
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close === -1) return false
    host = host.slice(1, close)
    return host === '::1'
  }
  const lastColon = host.lastIndexOf(':')
  if (lastColon !== -1) {
    host = host.slice(0, lastColon)
  }

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  // IPv4 127.0.0.0/8 loopback block
  if (/^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/.test(host)) return true
  return false
}

/** Observe live sockets for a process and ensure all network endpoints are loopback only. */
export function assertSocketsLoopbackOnly(pid, rawOutput = null, inspect = processId => execFileSync(
  '/usr/sbin/lsof', ['-nP', '-i', '-a', '-p', String(processId)],
  { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
)) {
  let output = rawOutput
  if (output === null) {
    try {
      output = inspect(pid)
    } catch (e) {
      if (e.status === 1 && !String(e.stderr ?? '').trim()) {
        // Exit status 1 means no open network sockets found; offline isolation satisfied.
        return
      }
      throw new Error(`Failed to inspect network sockets for process ${pid}: ${e.message}`)
    }
  }

  const lines = output.trim().split('\n')
  for (const line of lines) {
    if (!line.trim() || line.startsWith('COMMAND ')) continue
    const match = line.match(/(?:TCP|UDP)\s+([^\s]+)/)
    if (!match) continue
    const conn = match[1]
    const endpoints = conn.split('->')
    for (const endpoint of endpoints) {
      assert(
        isLoopbackEndpoint(endpoint),
        `Offline isolation violated: Non-loopback network endpoint detected: ${endpoint} (in row: ${line})`,
      )
    }
  }
}

/** macOS confinement inherited by the companion and every child process. */
export const OFFLINE_POLICY = `(version 1)
(allow default)
(deny network*)
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-outbound (remote ip "localhost:*"))`

export class InstalledCompanionRunner {
  constructor(target, home, workspace) {
    Object.assign(this, { target, home, workspace })
    this.stderr = ''
    this.child = null
    this.pending = new Map()
    this.nextRpcId = 1
  }

  seedProfile({ enabled = false, version = '0.74.0' } = {}) {
    const profile = join(this.home, '.dsh', 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-desktop-app']
    if (enabled) {
      bundles.push('dsh-context')
    }
    const dependencies = {
      'dsh-context': version,
    }

    const contextSrc = join(this.target.pluginRoot, 'dsh-context')
    const contextDest = join(profile, 'node_modules', 'dsh-context')
    mkdirSync(dirname(contextDest), { recursive: true })
    cpSync(contextSrc, contextDest, { recursive: true })

    writeFileSync(
      join(profile, 'package.json'),
      JSON.stringify({
        name: 'dsh-profile-desktop',
        private: true,
        dependencies,
        dsh: { profile: { bundles } },
      }, undefined, 2) + '\n',
    )
    writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  }

  async start({ timeout = 25000, offline = true } = {}) {
    const env = {
      HOME: this.home,
      USERPROFILE: this.home,
      DSH_HOME: join(this.home, '.dsh'),
      OCTOPUS_APP_DATA: join(this.home, 'app-data'),
      DEEPSEEK_API_KEY: 'synthetic-loopback-only',
      PATH: verificationPath(this.target.node),
      TMPDIR: this.home,
      TMP: this.home,
      TEMP: this.home,
      ...(offline ? {
        HTTP_PROXY: 'http://127.0.0.1:0',
        HTTPS_PROXY: 'http://127.0.0.1:0',
        ALL_PROXY: 'http://127.0.0.1:0',
        NO_PROXY: 'none',
      } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    }

    const ready = new Promise((done, reject) => {
      this.ready = { done, reject }
    })

    if (offline && process.platform !== 'darwin') {
      throw new Error('Offline acceptance requires macOS sandbox-exec; proxy variables are not network confinement')
    }
    const argv = [this.target.companion, '--workspace-root', this.workspace]
    this.child = spawn(offline ? '/usr/bin/sandbox-exec' : this.target.node,
      offline ? ['-p', OFFLINE_POLICY, this.target.node, ...argv] : argv, {
      env,
      cwd: this.home,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.child.stderr.on('data', chunk => {
      this.stderr = (this.stderr + chunk).slice(-16000)
    })

    let buffer = ''
    this.child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8')
      for (let index; (index = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        let wire
        try {
          wire = JSON.parse(line)
        } catch {
          continue
        }
        if (wire.type !== 'wire/message') continue
        const frame = JSON.parse(wire.encoded)
        if (frame.type === 'control/error') failed(new Error(`Companion ${frame.code}: ${frame.message}`))
        if (frame.type === 'control/ready') this.ready?.done(frame)
        if (frame.type === 'rpc/message' && frame.message?.type === 'server-response') {
          const pending = this.pending.get(frame.message.rpcId)
          if (pending) {
            this.pending.delete(frame.message.rpcId)
            clearTimeout(pending.timer)
            if (frame.message.result.ok) {
              pending.resolve(frame.message.result.value)
            } else {
              pending.reject(frame.message.result.error)
            }
          }
        }
      }
    })

    const failed = error => {
      this.ready?.reject(error)
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer)
        reject(error)
      }
      this.pending.clear()
    }

    this.child.once('error', failed)
    this.child.once('exit', code => failed(new Error(`Companion exited (${code}): ${this.stderr}`)))

    this.send({
      type: 'control/hello',
      protocolVersion: 2,
      extensionVersion: '0.1.2',
      workspaceRoot: this.workspace,
      locale: 'zh',
    })

    let timer
    try {
      return await Promise.race([
        ready,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Companion boot timed out: ${this.stderr}`)), timeout)
        }),
      ])
    } catch (error) {
      await this.stop()
      throw error
    } finally {
      clearTimeout(timer)
      this.ready = undefined
    }
  }

  send(frame) {
    if (!this.child || !this.child.stdin || this.child.stdin.destroyed) return
    this.child.stdin.write(JSON.stringify({ type: 'wire/message', encoded: JSON.stringify(frame) }) + '\n')
  }

  call(method, args = {}) {
    const rpcId = `context-rpc-${this.nextRpcId++}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rpcId)
        reject(new Error(`RPC timed out: ${method}`))
      }, 15000)
      this.pending.set(rpcId, { resolve, reject, timer })
      this.send({
        type: 'rpc/message',
        message: {
          type: 'client-request',
          rpcId,
          method,
          payload: { args },
        },
      })
    })
  }

  async stop() {
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      this.child = null
      return
    }

    const exited = new Promise(done => child.once('exit', done))
    try {
      this.send({ type: 'control/shutdown' })
    } catch {}

    const term = setTimeout(() => {
      try { child.kill('SIGTERM') } catch {}
    }, 2000)
    const kill = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
    }, 4000)

    let deadline
    try {
      await Promise.race([
        exited,
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Companion shutdown timed out')), 6000) }),
      ])
    } catch {
      try { child.kill('SIGKILL') } catch {}
      await exited
    } finally {
      clearTimeout(term)
      clearTimeout(kill)
      clearTimeout(deadline)
      this.child = null
    }
  }
}

/** Negative control: prove that startup timeout terminates the companion and cleans up deterministically. */
async function testStartupTimeoutCleanupControl(validated, tempRoot) {
  const home = join(tempRoot, 'timeout-home')
  const workspace = join(tempRoot, 'timeout-workspace')
  mkdirSync(home, { recursive: true })
  mkdirSync(workspace, { recursive: true })

  // Use a controlled stuck companion script that deliberately withholds control/ready
  const controlledCompanion = join(tempRoot, 'controlled-stuck-companion.js')
  writeFileSync(controlledCompanion, 'setInterval(() => {}, 60000);\n')
  const stuckTarget = { ...validated, companion: controlledCompanion }

  const runner = new InstalledCompanionRunner(stuckTarget, home, workspace)
  runner.seedProfile({ enabled: false })

  let timeoutCaught = false
  try {
    await runner.start({ timeout: 100 })
  } catch (err) {
    if (/Companion boot timed out/.test(err.message)) {
      timeoutCaught = true
    } else {
      throw err
    }
  }

  assert(timeoutCaught, 'Bounded startup timeout must reject with timeout error')
  // Child must be terminated by runner.start failure cleanup
  assert(
    runner.child === null || runner.child.exitCode !== null || runner.child.signalCode !== null,
    'Timeout must terminate companion child process',
  )
}

/** Prove that the same policy permits local transport and denies a foreign TCP destination. */
function testOfflineConfinement(node) {
  const code = `
    const assert = require('node:assert/strict');
    const net = require('node:net');
    const server = net.createServer(socket => socket.end());
    server.listen(0, '127.0.0.1', () => {
      const local = net.connect(server.address().port, '127.0.0.1');
      local.on('error', error => { throw error });
      local.on('close', () => {
        server.close();
        const remote = net.connect(443, '203.0.113.1');
        const timeout = setTimeout(() => { throw new Error('Network denial was not enforced') }, 1500);
        remote.on('connect', () => { throw new Error('Foreign connection was allowed') });
        remote.on('error', error => {
          clearTimeout(timeout);
          assert(['EPERM', 'EACCES'].includes(error.code), error.message);
          console.log('Loopback allowed; foreign TCP denied by kernel');
        });
      });
    });
  `
  const control = spawnSync('/usr/bin/sandbox-exec', ['-p', OFFLINE_POLICY, node, '-e', code], {
    env: { PATH: verificationPath(node) }, encoding: 'utf8', timeout: 5000,
  })
  assert.equal(control.signal, null, 'Network control must complete without a timeout or signal')
  assert.equal(control.status, 0, `Network confinement control failed: ${control.stderr}`)
  assert.match(control.stdout, /foreign TCP denied by kernel/)
}

/** The test-only binary executes the same installer and carrier as the packaged shell. */
function installerHarness() {
  return realpathSync(process.argv[3] ?? fileURLToPath(new URL('../apps/desktop/src-tauri/target/debug/carrier-harness', import.meta.url)))
}

/** Invoke Rust seeding without manufacturing the installer's revision stamp. */
function runRustInstaller(target, profileDir, revision) {
  const control = spawnSync(installerHarness(), [], {
    input: JSON.stringify({ id: 1, cmd: 'seed_profile', args: { profileDir, resourcesDir: target.pluginRoot, revision } }) + '\n',
    env: { PATH: verificationPath(target.node), DSH_DESKTOP_HARNESS_HOME: join(dirname(profileDir), 'installer-control') },
    encoding: 'utf8', timeout: 30000,
  })
  assert.equal(control.signal, null, 'Rust installer must finish without timeout or signal')
  assert.equal(control.status, 0, `Rust installer failed: ${control.stderr}`)
  const response = JSON.parse(control.stdout.trim())
  assert.equal(response.ok, true, `Rust installer rejected the profile: ${response.error}`)
  assert.equal(response.result.outcome, 'reseeded')
}

async function run() {
  const target = process.argv[2]
  assert(target, 'Usage: verify-dsh-context-installed-flows.mjs <app-or-resources-dir>')

  console.log('▶ Verifying packaged dsh-context metadata and exports')
  const validated = validateInstalledTarget(target)
  console.log('  ✓ Packaged inventory: plugins.json and dsh-context@0.74.0 verified with defaultEnabled: false')

  const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-context-acceptance-'))
  const home = join(tempRoot, 'home')
  const workspace = join(tempRoot, 'workspace')
  mkdirSync(home, { recursive: true })
  mkdirSync(workspace, { recursive: true })

  let activeRunner = null

  try {
    // R6 Negative Control: Bounded startup timeout process cleanup
    console.log('▶ Verifying R6 Failure Cleanup & Bounded Startup Timeout Control')
    await testStartupTimeoutCleanupControl(validated, tempRoot)
    console.log('  ✓ R6: Startup timeout cleanly terminates companion child process')

    // G1: Offline Isolation Enforcement & Negative Controls
    console.log('▶ Verifying G1: Offline isolation')
    testOfflineConfinement(validated.node)
    // Negative control 1: verify detector catches WAN remote peer with localhost local endpoint
    let neg1Caught = false
    try {
      assertSocketsLoopbackOnly(
        0,
        'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 123 user 14u IPv4 0x123 0t0 TCP localhost:51234->93.184.216.34:https (ESTABLISHED)',
      )
    } catch {
      neg1Caught = true
    }
    assert(neg1Caught, 'G1 Negative Control 1: assertSocketsLoopbackOnly must catch WAN remote peer')

    // Negative control 2: verify detector catches wildcard binding (*:port)
    let neg2Caught = false
    try {
      assertSocketsLoopbackOnly(
        0,
        'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 123 user 14u IPv4 0x123 0t0 TCP *:8080 (LISTEN)',
      )
    } catch {
      neg2Caught = true
    }
    assert(neg2Caught, 'G1 Negative Control 2: assertSocketsLoopbackOnly must catch wildcard listener')

    // Negative control 3: verify assertSocketsLoopbackOnly catches real live non-loopback socket
    const wildcardChild = spawn(
      validated.node,
      ['-e', "require('net').createServer().listen(0, '0.0.0.0', () => console.log('listening'))"],
      { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: verificationPath(validated.node) } },
    )
    const wildcardExited = new Promise(done => wildcardChild.once('exit', done))
    let listeningTimer
    try {
      await new Promise((done, reject) => {
        listeningTimer = setTimeout(() => reject(new Error('Wildcard control did not start listening')), 5000)
        wildcardChild.once('error', reject)
        wildcardChild.once('exit', code => reject(new Error(`Wildcard control exited before readiness: ${code}`)))
        wildcardChild.stdout.once('data', chunk => {
          if (String(chunk).trim() === 'listening') done()
          else reject(new Error('Unexpected wildcard control readiness message'))
        })
      })
      assert.throws(() => assertSocketsLoopbackOnly(wildcardChild.pid), /Non-loopback network endpoint/)
    } finally {
      clearTimeout(listeningTimer)
      wildcardChild.kill('SIGKILL')
      await wildcardExited
    }

    // Start single companion instance for live toggle flow (G2 - G5)
    activeRunner = new InstalledCompanionRunner(validated, home, workspace)
    runRustInstaller(validated, join(home, '.dsh/profiles/desktop'), '1'.repeat(64))
    await activeRunner.start({ offline: true })

    // Verify companion holds loopback-only sockets
    if (activeRunner.child?.pid) {
      assertSocketsLoopbackOnly(activeRunner.child.pid)
    }
    console.log('  ✓ G1: Offline isolation enforced and observed (loopback-only sockets)')

    // Create session to observe live projection attachment and detachment
    const wsRes = await activeRunner.call('workspace/create', { request: { path: workspace } })
    const sessionRes = await activeRunner.call('session/create', { request: { workspaceId: wsRes.workspace.workspaceId } })
    const sessionId = sessionRes.sessionId

    // G2: Default-OFF Discovery
    console.log('▶ Verifying G2: Default-OFF discovery')
    const bundlesOff = await activeRunner.call('pluginManager/listBundles')
    const contextBundleOff = bundlesOff.find(b => b.name === 'dsh-context')
    assert(contextBundleOff, 'dsh-context must be discoverable in listBundles')
    assert.equal(contextBundleOff.enabled, false, 'dsh-context must be disabled by default')
    assert.equal(contextBundleOff.version, '0.74.0', 'dsh-context must report 0.74.0')
    assert(contextBundleOff.meta?.title, 'dsh-context must provide localized title metadata')

    const projectionsOff = await activeRunner.call('session/projections', { request: { sessionId } })
    const projKeysOff = Object.keys(projectionsOff.values)
    assert(!projKeysOff.includes('contextTimeline'), 'contextTimeline projection must NOT be registered when default-OFF')
    assert(!projKeysOff.includes('contextActivity'), 'contextActivity projection must NOT be registered when default-OFF')
    console.log('  ✓ G2: Default-OFF discovery verified: bundle row disabled, projections absent')


    // G3: Hot Activation (OFF → ON) in running companion & Client mounting
    console.log('▶ Verifying G3: Hot activation (OFF → ON)')
    const enableResult = await activeRunner.call('pluginManager/setBundleEnabled', { name: 'dsh-context', enabled: true })
    assert.equal(enableResult.changed, true, 'setBundleEnabled must report changed: true')
    assert.equal(enableResult.application, 'applied', 'setBundleEnabled must report application: applied (not restart-required)')

    if (activeRunner.child?.pid) {
      assertSocketsLoopbackOnly(activeRunner.child.pid)
    }

    const bundlesOn = await activeRunner.call('pluginManager/listBundles')
    assert.equal(bundlesOn.find(b => b.name === 'dsh-context')?.enabled, true, 'listBundles must reflect enabled: true')

    const projectionsOn = await activeRunner.call('session/projections', { request: { sessionId } })
    const projKeysOn = Object.keys(projectionsOn.values)
    assert(projKeysOn.includes('contextTimeline'), 'contextTimeline projection must mount dynamically on activation')
    assert(projKeysOn.includes('contextActivity'), 'contextActivity projection must mount dynamically on activation')

    console.log('  ✓ G3 Host: activation applied and projections attached')

    // G4: Hot Deactivation (ON → OFF) in running companion & Client disposal
    console.log('▶ Verifying G4: Hot deactivation (ON → OFF)')
    const disableResult = await activeRunner.call('pluginManager/setBundleEnabled', { name: 'dsh-context', enabled: false })
    assert.equal(disableResult.changed, true, 'setBundleEnabled must report changed: true')
    assert.equal(disableResult.application, 'applied', 'setBundleEnabled must report application: applied')

    if (activeRunner.child?.pid) {
      assertSocketsLoopbackOnly(activeRunner.child.pid)
    }

    const bundlesDeactivated = await activeRunner.call('pluginManager/listBundles')
    assert.equal(bundlesDeactivated.find(b => b.name === 'dsh-context')?.enabled, false, 'listBundles must reflect enabled: false')

    const projectionsDeactivated = await activeRunner.call('session/projections', { request: { sessionId } })
    const projKeysDeactivated = Object.keys(projectionsDeactivated.values)
    assert(!projKeysDeactivated.includes('contextTimeline'), 'contextTimeline projection must be disposed cleanly')
    assert(!projKeysDeactivated.includes('contextActivity'), 'contextActivity projection must be disposed cleanly')

    console.log('  ✓ G4 Host: deactivation applied and projections disposed')

    // G5: Repeated Live Cycle Idempotency in the same running process
    console.log('▶ Verifying G5: Repeated cycle idempotency')
    for (let cycle = 1; cycle <= 2; cycle++) {
      const onRes = await activeRunner.call('pluginManager/setBundleEnabled', { name: 'dsh-context', enabled: true })
      assert.equal(onRes.application, 'applied')

      const offRes = await activeRunner.call('pluginManager/setBundleEnabled', { name: 'dsh-context', enabled: false })
      assert.equal(offRes.application, 'applied')
    }
    const finalProj = await activeRunner.call('session/projections', { request: { sessionId } })
    assert(!Object.keys(finalProj.values).includes('contextTimeline'), 'No projections may leak across repeated cycles')
    if (activeRunner.child?.pid) {
      assertSocketsLoopbackOnly(activeRunner.child.pid)
    }
    console.log('  ✓ G5: Repeated live cycles (OFF→ON→OFF) verified without leakage')

    // G8: Activation Error Boundary & Negative Controls in running companion
    console.log('▶ Verifying G8: Activation error boundary & negative controls')
    const badBundleResult = await activeRunner.call('pluginManager/setBundleEnabled', { name: 'nonexistent-broken-plugin', enabled: true })
    assert.equal(badBundleResult.changed, false, 'Invalid bundle must report changed: false')
    assert.equal(badBundleResult.application, 'failed', 'Invalid bundle must report application: failed (never applied)')
    assert(badBundleResult.error, 'Invalid bundle must return structured error')

    // Stop live runner cleanly before restart and refresh gates
    await activeRunner.stop()
    activeRunner = null
    console.log('  ✓ G8: Activation error boundary verified: invalid bundles fail safely')

    // G6: Restart Persistence (test both ON and OFF without reseeding)
    console.log('▶ Verifying G6: Restart persistence without reseeding')

    // Step 1: Start runner, toggle to ON via public RPC
    const persistRunner = new InstalledCompanionRunner(validated, home, workspace)
    activeRunner = persistRunner
    await persistRunner.start({ offline: true })

    const enableRes = await persistRunner.call('pluginManager/setBundleEnabled', { name: 'dsh-context', enabled: true })
    assert.equal(enableRes.application, 'applied', 'setBundleEnabled ON must report applied')

    // Stop runner cleanly. DO NOT reseed profile!
    await persistRunner.stop()
    activeRunner = null

    // Step 2: Cold boot without reseeding. Assert ON is persisted and projections attach.
    const coldOnRunner = new InstalledCompanionRunner(validated, home, workspace)
    activeRunner = coldOnRunner
    await coldOnRunner.start({ offline: true })

    const bundlesColdOn = await coldOnRunner.call('pluginManager/listBundles')
    assert.equal(
      bundlesColdOn.find(b => b.name === 'dsh-context')?.enabled,
      true,
      'Cold restart must preserve enabled: true without reseeding',
    )
    const wsColdOn = await coldOnRunner.call('workspace/create', { request: { path: workspace } })
    const sColdOn = await coldOnRunner.call('session/create', { request: { workspaceId: wsColdOn.workspace.workspaceId } })
    const pColdOn = await coldOnRunner.call('session/projections', { request: { sessionId: sColdOn.sessionId } })
    assert(
      Object.keys(pColdOn.values).includes('contextTimeline'),
      'Cold restart must mount contextTimeline projection when ON was persisted',
    )
    assert(
      Object.keys(pColdOn.values).includes('contextActivity'),
      'Cold restart must mount contextActivity projection when ON was persisted',
    )

    // Step 3: Now toggle to OFF via public RPC in the running companion
    const disableRes = await coldOnRunner.call('pluginManager/setBundleEnabled', { name: 'dsh-context', enabled: false })
    assert.equal(disableRes.application, 'applied', 'setBundleEnabled OFF must report applied')

    // Stop runner cleanly. DO NOT reseed profile!
    await coldOnRunner.stop()
    activeRunner = null

    // Step 4: Cold boot without reseeding. Assert OFF is persisted and projections absent.
    const coldOffRunner = new InstalledCompanionRunner(validated, home, workspace)
    activeRunner = coldOffRunner
    await coldOffRunner.start({ offline: true })

    const bundlesColdOff = await coldOffRunner.call('pluginManager/listBundles')
    assert.equal(
      bundlesColdOff.find(b => b.name === 'dsh-context')?.enabled,
      false,
      'Cold restart must preserve enabled: false without reseeding',
    )
    const wsColdOff = await coldOffRunner.call('workspace/create', { request: { path: workspace } })
    const sColdOff = await coldOffRunner.call('session/create', { request: { workspaceId: wsColdOff.workspace.workspaceId } })
    const pColdOff = await coldOffRunner.call('session/projections', { request: { sessionId: sColdOff.sessionId } })
    assert(
      !Object.keys(pColdOff.values).includes('contextTimeline'),
      'Cold restart must keep contextTimeline projection absent when OFF was persisted',
    )
    assert(
      !Object.keys(pColdOff.values).includes('contextActivity'),
      'Cold restart must keep contextActivity projection absent when OFF was persisted',
    )

    await coldOffRunner.stop()
    activeRunner = null
    console.log('  ✓ G6: Cold restart persistence verified for both ON and OFF without reseeding')

    console.log('▶ Verifying G7: production Rust payload refresh')
    const profileDir = join(home, '.dsh/profiles/desktop')
    const refreshRunner = new InstalledCompanionRunner(validated, home, workspace)
    for (const [enabled, revision] of [[true, '2'.repeat(64)], [false, '3'.repeat(64)]]) {
      activeRunner = refreshRunner
      await refreshRunner.start({ offline: true })
      const selection = await refreshRunner.call('pluginManager/setBundleEnabled', { name: 'dsh-context', enabled })
      assert.equal(selection.application, 'applied')
      await refreshRunner.stop()
      activeRunner = null
      const installedClient = join(profileDir, 'node_modules/dsh-context/lib/client.js')
      writeFileSync(installedClient, 'stale payload control')
      runRustInstaller(validated, profileDir, revision)
      const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
      assert.equal(manifest.dsh.profile.bundles.includes('dsh-context'), enabled)
      assert.equal(manifest.dependencies['dsh-context'], '0.74.0')
      assert.equal(readFileSync(join(profileDir, '.dsh-seed-rev'), 'utf8').trim(), revision)
      assert.equal(readFileSync(installedClient, 'utf8'), readFileSync(join(validated.pluginRoot, 'dsh-context/lib/client.js'), 'utf8'))
      activeRunner = refreshRunner
      await refreshRunner.start({ offline: true })
      const refreshedBundles = await refreshRunner.call('pluginManager/listBundles')
      assert.equal(refreshedBundles.find(row => row.name === 'dsh-context')?.enabled, enabled)
      const refreshedWorkspace = await refreshRunner.call('workspace/create', { request: { path: workspace } })
      const refreshedSession = await refreshRunner.call('session/create', { request: { workspaceId: refreshedWorkspace.workspace.workspaceId } })
      const refreshedProjections = await refreshRunner.call('session/projections', { request: { sessionId: refreshedSession.sessionId } })
      for (const projection of ['contextTimeline', 'contextActivity']) {
        assert.equal(Object.keys(refreshedProjections.values).includes(projection), enabled)
      }
      await refreshRunner.stop()
      activeRunner = null
    }
    console.log('  ✓ G7: Rust installer copied the payload, wrote new stamps and preserved ON/OFF')
    console.log('▶ Verifying built desktop Client through the native carrier and Rust cache')
    const native = spawnSync(validated.node, [fileURLToPath(new URL('verify-dsh-context-webview.mjs', import.meta.url)), target, installerHarness()], {
      stdio: 'inherit', timeout: 180000,
      env: { PATH: verificationPath(validated.node), HOME: process.env.HOME, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH },
    })
    assert.equal(native.signal, null, 'Desktop Client acceptance must finish without a signal or timeout')
    assert.equal(native.status, 0, 'Built desktop Client acceptance failed')
    console.log('\n✓ READY: context Host, Rust refresh and built desktop Client acceptance passed')

  } finally {
    if (activeRunner) {
      try { await activeRunner.stop() } catch {}
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(err => {
    console.error('\n✗ FAILED dsh-context acceptance:', err)
    process.exit(1)
  })
}
