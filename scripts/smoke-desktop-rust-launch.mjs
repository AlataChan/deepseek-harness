#!/usr/bin/env node
/** Exercise installed-runtime resolution and companion readiness through the production Rust shell. */
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, toNamespacedPath } from 'node:path'
import { createInterface } from 'node:readline'

const [app, harness] = process.argv.slice(2)
if (!app || !harness) throw new Error('usage: smoke-desktop-rust-launch.mjs <install-dir> <carrier-harness>')
const resources = join(resolve(app), 'resources')
const home = mkdtempSync(join(tmpdir(), 'octopus-rust-launch-'))
const node = join(resources, process.platform === 'win32' ? 'node.exe' : 'node')
const child = spawn(harness, [], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    DSH_TELEMETRY_DISABLED: '1',
    DSH_HOME: process.env.DSH_HOME ?? join(home, '.dsh'),
    DSH_DESKTOP_HARNESS_HOME: home,
    DSH_DESKTOP_HARNESS_CLI: toNamespacedPath(join(resources, 'installed-runtime-cli.js')),
  },
})
const exit = once(child, 'exit')
const pending = new Map()
let sequence = 0
let stderr = ''
let readyResolve
let readyReject
const ready = new Promise((resolveReady, rejectReady) => {
  readyResolve = resolveReady
  readyReject = rejectReady
})
// Attach immediately: startup may fail before the ready wait begins.
ready.catch(() => {})
child.stderr.on('data', chunk => { stderr += chunk })
child.stdin.on('error', error => {
  for (const request of pending.values()) request.reject(error)
  readyReject(error)
})
child.on('error', error => {
  for (const request of pending.values()) request.reject(error)
  readyReject(error)
})
child.on('exit', code => {
  const error = new Error(`Rust shell exited (${code}): ${stderr}`)
  for (const request of pending.values()) request.reject(error)
  readyReject(error)
})
const lines = createInterface({ input: child.stdout })
lines.on('line', line => {
  try {
    const record = JSON.parse(line)
    if (record.id !== undefined) {
      const request = pending.get(record.id)
      pending.delete(record.id)
      if (record.ok) request?.resolve(record.result)
      else request?.reject(new Error(record.error))
    } else if (record.event === 'record') {
      const wire = JSON.parse(record.data.line)
      if (wire.type !== 'wire/message') return
      const frame = JSON.parse(wire.encoded)
      if (frame.type === 'control/ready') readyResolve(frame)
      if (frame.type === 'control/error') readyReject(new Error(JSON.stringify(frame)))
    } else if (record.event === 'closed' || record.event === 'child-exit') {
      readyReject(new Error(JSON.stringify(record)))
    }
  } catch (error) {
    readyReject(error)
  }
})
/** Send one shell command and await its matching reply. */
function request(cmd, args = {}) {
  const id = ++sequence
  return new Promise((resolveReply, reject) => {
    pending.set(id, { resolve: resolveReply, reject })
    child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`)
  })
}
let timer
const deadline = new Promise((_, reject) => {
  timer = setTimeout(() => reject(new Error(`Rust launch exceeded 30s: ${stderr}`)), 30_000)
})
try {
  if (process.platform === 'win32') {
    const fixture = join(home, 'entry with spaces.mjs')
    writeFileSync(fixture, 'console.log("entry-ok")\n')
    const ordinary = spawnSync(node, [fixture], { encoding: 'utf8', timeout: 10_000 })
    const verbatim = spawnSync(node, [toNamespacedPath(fixture)], { encoding: 'utf8', timeout: 10_000 })
    console.log(`Node main-path comparison: ordinary=${ordinary.status}, verbatim=${verbatim.status}`)
    if (ordinary.status !== 0) throw new Error(ordinary.stderr || String(ordinary.error))
    if (verbatim.status !== 0) console.log(verbatim.stderr)
  }
  await Promise.race([deadline, (async () => {
    await request('runtime_configure', {
      nodePath: toNamespacedPath(node),
      runtimePath: toNamespacedPath(join(resources, 'harness')),
      workspaceRoot: home,
    })
    const runtime = await request('runtime_resolve')
    await request('carrier_open')
    await request('carrier_send', { line: JSON.stringify({
      type: 'wire/message',
      encoded: JSON.stringify({ type: 'control/hello', protocolVersion: 2, extensionVersion: '0.0.0-smoke', workspaceRoot: home, locale: 'zh' }),
    }) })
    const frame = await ready
    if (frame.runtimeVersion !== runtime.runtimeVersion) throw new Error('Rust launch runtime version mismatch')
    const bundle = frame.bundles[0]
    if (!bundle) throw new Error('Installed desktop announced no Client bundles')
    const cached = await request('cache_bundle', {
      sourcePath: bundle.sourcePath, sha256: bundle.sha256,
      graphRev: frame.graph.rev, index: 0, id: bundle.id,
    })
    const assetUrl = new URL(cached.src)
    const prefix = process.platform === 'win32' ? 'http://asset.localhost/' : 'asset://localhost/'
    if (!cached.src.startsWith(prefix) || decodeURIComponent(assetUrl.pathname.slice(1)) !== cached.destination) {
      throw new Error(`Cached Client URL does not preserve its absolute path: ${cached.src}`)
    }
    const config = JSON.parse(readFileSync(new URL('../apps/desktop/src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
    const scriptSources = config.app.security.csp.split(';').find(value => value.trim().startsWith('script-src ')).trim().split(/\s+/).slice(1)
    const assetSource = process.platform === 'win32' ? 'http://asset.localhost' : 'asset:'
    if (!scriptSources.includes(assetSource)) throw new Error(`Desktop CSP blocks cached Client scripts: ${assetSource}`)
    console.log('Rust cached Client URL preserves its absolute path and platform protocol')
    console.log(`Rust shell resolved installed runtime and received control/ready (${runtime.runtimeVersion})`)
  })()])
} finally {
  clearTimeout(timer)
  child.stdin.end()
  const kill = setTimeout(() => child.kill(), 7000)
  try {
    await exit
  } finally {
    clearTimeout(kill)
    lines.close()
    rmSync(home, { recursive: true, force: true })
  }
}
