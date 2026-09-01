#!/usr/bin/env node
/**
 * Drive a bundled desktop companion exactly as the Tauri shell does, then hold
 * the connection open to prove the process stays alive.
 *
 * Module-resolution checks are not sufficient: a companion can import every
 * module, answer `control/ready`, and then exit — at which point the shell's
 * next stdin write fails with EPIPE and the window reports
 * "companion stdin write failed: Broken pipe". Only a live handshake plus a
 * hold period observes that, so this is the check that stands between a build
 * and a user.
 *
 * Usage: node scripts/smoke-companion-lifecycle.mjs <path-to-.app> [holdMs]
 * Exit 0 when the companion answered ready and outlived the hold period.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [appArg, holdArg] = process.argv.slice(2)
if (appArg === undefined) {
  console.error('usage: smoke-companion-lifecycle.mjs <path-to-.app> [holdMs]')
  process.exit(2)
}

const app = resolve(appArg)
const resources = join(app, 'Contents', 'Resources', 'resources')
const nodeBin = join(resources, 'node')
const companion = join(resources, 'harness', 'lib', 'desktop-companion.js')
const holdMs = Number(holdArg ?? 8000)

for (const [label, path] of [['embedded node', nodeBin], ['companion entry', companion]]) {
  if (!existsSync(path)) {
    console.error(`smoke: ${label} missing at ${path}`)
    process.exit(1)
  }
}

/** The protocol version the shell announces; a mismatch is a refused handshake. */
const PROTOCOL_VERSION = 2

const workspaceRoot = process.env.HOME ?? '/tmp'
const appData = process.env.OCTOPUS_APP_DATA ?? join(workspaceRoot, '.octopus-dsh-smoke-app-data')
const sidecarHome = process.env.OCTOPUS_SIDECAR_HOME ?? join(resources, 'kb-runtime')
if (!appData.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(appData)) {
  console.error('smoke: OCTOPUS_APP_DATA must be an absolute path')
  process.exit(2)
}
const childEnv = { ...process.env, OCTOPUS_APP_DATA: appData, OCTOPUS_SIDECAR_HOME: sidecarHome }
delete childEnv.DEEPSEEK_API_KEY
const child = spawn(nodeBin, [companion, '--workspace-root', workspaceRoot], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: childEnv,
})

/** @type {string[]} */
const stderrLines = []
let exited = false
/** @type {number | null} */
let exitCode = null
let ready = false
/** @type {string | undefined} */
let readyVersion

child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => {
  for (const line of chunk.split('\n')) if (line.trim() !== '') stderrLines.push(line)
})

let stdoutBuffer = ''
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk
  let newline = stdoutBuffer.indexOf('\n')
  while (newline !== -1) {
    const line = stdoutBuffer.slice(0, newline)
    stdoutBuffer = stdoutBuffer.slice(newline + 1)
    newline = stdoutBuffer.indexOf('\n')
    if (line.trim() === '') continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      // A non-JSON line on stdout is companion diagnostic noise, not a record.
      continue
    }
    if (record?.type !== 'wire/message' || typeof record.encoded !== 'string') continue
    let frame
    try {
      frame = JSON.parse(record.encoded)
    } catch {
      // A malformed logical frame is reported by the summary below as "no ready".
      continue
    }
    if (frame?.type === 'control/ready') {
      ready = true
      readyVersion = frame.runtimeVersion
    } else if (frame?.type === 'control/error') {
      stderrLines.push(`control/error ${String(frame.code)}: ${String(frame.message)}`)
    }
  }
})

child.on('exit', (code) => {
  exited = true
  exitCode = code
})

/**
 * Write one logical frame as a newline-delimited physical record.
 * @param frame - the carrier frame to send.
 * @returns whether the write was accepted by the pipe.
 */
function sendFrame(frame) {
  const record = JSON.stringify({ type: 'wire/message', encoded: JSON.stringify(frame) })
  try {
    return child.stdin.write(`${record}\n`)
  } catch {
    // EPIPE here is the exact production symptom; the summary reports it.
    return false
  }
}

/**
 * @param ms - milliseconds to wait.
 * @returns a promise resolving after `ms`.
 */
const wait = (ms) => new Promise((r) => { setTimeout(r, ms) })

sendFrame({
  type: 'control/hello',
  protocolVersion: PROTOCOL_VERSION,
  extensionVersion: '0.0.0-smoke',
  workspaceRoot,
  locale: 'zh',
})

// Handshake window, then the hold that catches a companion which dies after ready.
const deadline = Date.now() + 20_000
while (!ready && !exited && Date.now() < deadline) await wait(200)

/**
 * Report and exit.
 * @param code - process exit code.
 * @param message - one-line result.
 */
function finish(code, message) {
  console.log(message)
  if (code !== 0 && stderrLines.length > 0) {
    console.log('companion stderr:')
    for (const line of stderrLines.slice(0, 25)) console.log(`  ${line}`)
  }
  if (!exited) child.kill('SIGTERM')
  process.exit(code)
}

if (exited) {
  finish(1, `smoke: companion exited before ready (code ${String(exitCode)})`)
}
if (!ready) {
  finish(1, 'smoke: companion never answered control/ready within 20s')
}

console.log(`smoke: handshake ok (runtime ${readyVersion ?? 'unknown'}); holding ${String(holdMs)}ms`)
await wait(holdMs)

if (exited) {
  finish(1, `smoke: companion answered ready then EXITED (code ${String(exitCode)}) — this is the Broken pipe cause`)
}

// The shell's next write is what surfaces a dead companion as EPIPE, so the
// pipe itself is asserted rather than only the process. `control/hello` cannot
// serve here — a second one is a protocol violation the host rightly refuses.
if (child.stdin.destroyed || child.stdin.writableEnded) {
  finish(1, 'smoke: companion stdin closed after ready — the shell would report Broken pipe')
}

finish(0, `smoke: companion alive with an open pipe after ready + ${String(holdMs)}ms hold`)
