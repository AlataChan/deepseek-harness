#!/usr/bin/env node
/** Built desktop page, production Rust carrier/cache, and packaged Client acceptance. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { OFFLINE_POLICY, validateInstalledTarget } from './verify-dsh-context-installed-flows.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('playwright')
const target = validateInstalledTarget(process.argv[2])
const harnessBin = realpathSync(process.argv[3] ?? join(root, 'apps/desktop/src-tauri/target/debug/carrier-harness'))
const assets = realpathSync(process.argv[4] ?? join(root, 'apps/desktop/dist'))
const temp = realpathSync(mkdtempSync(join(tmpdir(), 'context-webview-')))
const home = join(temp, 'home')
const workspace = join(temp, 'workspace')
const cache = join(temp, 'cache')
for (const dir of [home, workspace, cache]) mkdirSync(dir)
const pending = new Map()
let sequence = 0
let channelId
let channelIndex = 0
let page
let browser
let browserServer
let cleanupPromise
let server
let origin
let eventQueue = Promise.resolve()
let stderr = ''
let closing = false
let deliveryError
let rejectBridgeFailure
const bridgeFailure = new Promise((_, reject) => { rejectBridgeFailure = reject })
void bridgeFailure.catch(error => { deliveryError ??= error })
const files = new Map()
const env = {
  HOME: home, DSH_HOME: join(home, '.dsh'), PATH: `${dirname(target.node)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  DSH_DESKTOP_HARNESS_HOME: home, DSH_DESKTOP_HARNESS_CONFIG: join(temp, 'config'),
  DSH_DESKTOP_HARNESS_CACHE: cache,
  DSH_DESKTOP_HARNESS_CLI: join(target.resources, 'installed-runtime-cli.js'),
  DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'synthetic-loopback-only',
  TMPDIR: temp, TMP: temp, TEMP: temp,
}
const child = spawn('/usr/bin/sandbox-exec', ['-p', OFFLINE_POLICY, harnessBin], {
  env, cwd: temp, stdio: ['pipe', 'pipe', 'pipe'],
})
const exited = new Promise(done => { child.once('exit', done); child.once('error', done) })
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000) })
child.on('error', failBridge)
child.stdin.on('error', failBridge)
child.on('exit', code => { failBridge(new Error(`Rust bridge exited ${code}: ${stderr}`)) })
const lines = createInterface({ input: child.stdout })
lines.on('line', line => {
  let value
  try {
    value = JSON.parse(line)
    assert(value && typeof value === 'object' && !Array.isArray(value), 'Rust bridge reply must be an object')
  } catch (error) { failBridge(error); return }
  if (value.id !== undefined) {
    const job = pending.get(value.id)
    if (!job) return
    pending.delete(value.id)
    clearTimeout(job.timer)
    if (value.ok) job.resolve(value.result)
    else job.reject(new Error(value.error))
  } else if (value.event && page && channelId !== undefined && !closing) {
    const index = channelIndex++
    eventQueue = eventQueue.then(() => page.evaluate(({ id, index, value }) => {
      window.__nativeCallbacks.get(id)?.({ index, message: value })
    }, { id: channelId, index, value })).catch(failBridge)
  }
})

function failBridge(error) {
  if (!closing) { deliveryError ??= error; rejectBridgeFailure(error) }
  for (const job of pending.values()) { clearTimeout(job.timer); job.reject(error) }
  pending.clear()
}

function invoke(cmd, args = {}) {
  if (deliveryError) return Promise.reject(deliveryError)
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { failBridge(new Error(`Rust command timed out: ${cmd}`)) }, 120000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ id, cmd, args }) + '\n')
  })
}

async function remote(method, args = {}) {
  return page.evaluate(async ({ method, args }) => {
    const response = await window.__DSH_TRANSPORT__.fetch('/api', { method: 'POST', body: JSON.stringify({
      type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args },
    }) })
    const envelope = await response.json()
    if (!envelope.result.ok) throw new Error(JSON.stringify(envelope.result.error))
    return envelope.result.value
  }, { method, args })
}

async function views() {
  return page.evaluate(() => window.__nativeModules?.entries.loader?.ctx.get('slots')?.entries('conversation.view').map(row => row.options.id) ?? [])
}

process.once('SIGTERM', () => { void cleanup().finally(() => process.exit(1)) })

try {
  const seeded = await invoke('seed_profile', {
    profileDir: join(home, '.dsh/profiles/desktop'), resourcesDir: target.pluginRoot, revision: '1'.repeat(64),
  })
  assert.equal(seeded.outcome, 'reseeded')
  console.log('WebView: production Rust installer seeded the packaged profile')
  await invoke('runtime_configure', { nodePath: target.node, runtimePath: join(target.resources, 'harness'), workspaceRoot: workspace })
  server = createServer((req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://local').pathname)
      const file = files.get(path) ?? join(assets, path === '/' ? 'index.html' : path)
      assert(files.has(path) || !relative(assets, realpathSync(file)).startsWith('..'), 'Asset escaped desktop build')
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
      res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'")
      res.end(readFileSync(file))
    } catch (error) { res.writeHead(404); res.end(String(error)) }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${server.address().port}`
  browserServer = await chromium.launchServer({ headless: true })
  browser = await chromium.connect(browserServer.wsEndpoint())
  console.log('WebView: browser process started')
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error('Page error:', error.message) })
  page.on('console', message => { if (message.type() === 'error') console.error('Page console:', message.text().slice(0, 600)) })
  await page.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/') || route.request().url().startsWith('data:')) return route.continue()
    errors.push(`Foreign page request: ${route.request().url()}`)
    return route.abort()
  })
  await page.exposeFunction('__nativeInvoke', async (cmd, args, callbackId) => {
    if (cmd === 'carrier_open') { channelId = callbackId; channelIndex = 0; args = {} }
    if (cmd !== 'carrier_send' && cmd !== 'cache_bundle') console.log('WebView bridge:', cmd)
    const result = await invoke(cmd, args)
    if (cmd !== 'cache_bundle') return result
    assert(!relative(cache, realpathSync(result.destination)).startsWith('..'), 'Rust cache escaped its root')
    const key = '/cache/' + createHash('sha256').update(result.destination).digest('hex') + '.js'
    files.set(key, result.destination)
    return { ...result, src: origin + key }
  })
  await page.addInitScript(() => {
    let id = 0
    window.__nativeCallbacks = new Map()
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) { const key = ++id; window.__nativeCallbacks.set(key, callback); return key },
      unregisterCallback(key) { window.__nativeCallbacks.delete(key) },
      invoke(cmd, args = {}) { return window.__nativeInvoke(cmd, cmd === 'carrier_open' ? {} : args, args.downlink?.id) },
    }
    let target
    Object.defineProperty(window, '__ModuleLoader__', {
      configurable: true, get: () => target,
      set(value) {
        target = value
        const create = value.create
        value.create = function (...args) {
          const modules = create.apply(this, args)
          window.__nativeModules = modules
          return modules
        }
      },
    })
  })
  await page.goto(origin)
  console.log('WebView: built desktop page loaded')
  await Promise.race([
    page.waitForFunction(() => window.__nativeModules?.entries.loader?.ctx.get('slots', false), null, { timeout: 120000 }),
    bridgeFailure,
  ])
  assert(!(await views()).includes('context'), 'Default-OFF must not mount the context view')
  const initial = await remote('pluginManager/listBundles')
  assert.equal(initial.find(row => row.name === 'dsh-context')?.enabled, false)
  for (let cycle = 0; cycle < 3; cycle++) {
    const on = await remote('pluginManager/setBundleEnabled', { name: 'dsh-context', enabled: true })
    assert.equal(on.application, 'applied')
    await page.waitForFunction(() => {
      const rows = window.__nativeModules.entries.loader.ctx.get('slots').entries('conversation.view')
      return rows.filter(row => ['context', 'fleet'].includes(row.options.id)).length === 2
    })
    assert.equal((await views()).filter(id => id === 'context').length, 1)
    const off = await remote('pluginManager/setBundleEnabled', { name: 'dsh-context', enabled: false })
    assert.equal(off.application, 'applied')
    await page.waitForFunction(() => !window.__nativeModules.entries.loader.ctx.get('slots').entries('conversation.view').some(row => ['context', 'fleet'].includes(row.options.id)))
  }
  assert.deepEqual(errors, [])
  assert.equal(deliveryError, undefined)
  assert.deepEqual(await page.evaluate(() => window.__nativeModules.entries.state.getSnapshot().failures), [])
  const screenshot = '/tmp/dsh-context-native-webview.png'
  await page.screenshot({ path: screenshot })
  console.log(`READY: built desktop page followed live carrier graphs through Rust cache, mounted and removed real packaged Client views over 3 cycles; ${screenshot}`)
} catch (error) {
  if (page) {
    console.error('Built desktop page:', (await page.locator('body').innerText()).slice(0, 5000))
    console.error('Page state:', await page.evaluate(() => ({ callbacks: [...window.__nativeCallbacks.keys()], modules: !!window.__nativeModules, transport: !!window.__DSH_TRANSPORT__ })))
    try { await page.screenshot({ path: '/tmp/dsh-context-webview-failed.png', timeout: 5000 }) } catch (captureError) { console.error('Screenshot unavailable:', captureError.message) }
  }
  console.error('Companion diagnostic:', stderr, existsSync(join(cache, 'companion.log')) ? readFileSync(join(cache, 'companion.log'), 'utf8') : '')
  throw error
} finally {
  await cleanup()
}

function cleanup() {
  if (cleanupPromise) return cleanupPromise
  cleanupPromise = (async () => {
    closing = true
    const failures = []
    if (browserServer) {
      const process = browserServer.process()
      const killBrowser = setTimeout(() => process.kill('SIGKILL'), 5000)
      try { await browserServer.close() } catch (error) { failures.push(error) } finally { clearTimeout(killBrowser) }
    }
    if (server) {
      server.closeAllConnections()
      await new Promise(done => server.close(done))
    }
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('Verifier closing')) }
    pending.clear()
    child.stdin.end()
    const kill = setTimeout(() => child.kill('SIGKILL'), 6000)
    await exited
    clearTimeout(kill)
    lines.close()
    rmSync(temp, { recursive: true, force: true })
    if (failures.length) throw new AggregateError(failures, 'Native page cleanup failed')
  })()
  return cleanupPromise
}
