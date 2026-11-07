/** Root-owned finite host operations; requests cannot supply commands, paths or recipients. */
import { createServer } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, mkdirSync, chmodSync, chownSync, statSync, existsSync, unlinkSync, realpathSync, openSync, closeSync, fstatSync, constants } from 'node:fs'
import { join, dirname } from 'node:path'
import { freemem, totalmem, loadavg, cpus, uptime } from 'node:os'
import { pathToFileURL } from 'node:url'
import { fields, readPolicy } from './policy.mjs'
import { Operations, atomicJson, digest } from './operations.mjs'

const exec = promisify(execFile)
const MAX_FRAME = 16384

function receiptJson(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > 16384) throw new Error('Invalid receipt file')
    try { return JSON.parse(readFileSync(fd, 'utf8')) } catch (error) { throw new Error('Receipt JSON is invalid', { cause: error }) }
  } finally { closeSync(fd) }
}

/** Remove common credential assignments and bearer values from bounded service output. */
export function redact(text) {
  return text.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|app[_-]?secret|access[_-]?token|password|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
}

/** Run only program/argv assembled by this module, with no inherited credentials. */
export async function command(program, args, policy) {
  const result = await exec(program, args, { timeout: policy.limits.commandSeconds * 1000,
    maxBuffer: 1024 * 1024, env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', HOME: '/root' } })
  return redact(result.stdout)
}

/** Resolve a root-configured unit alias without accepting a shell or a unit supplied by the model. */
export function unit(policy, target) {
  if (!Object.hasOwn(policy.services, target)) throw new Error('Unknown service alias')
  return policy.services[target]
}

/** Enqueue one immutable message for the existing, serialized desktop worker. */
export async function perform(operation, policy) {
  if (operation.kind === 'restart_container') {
    const target = operation.payload.target
    if (!policy.containers.includes(target)) throw new Error('Container is not allowed')
    if (operation.targetProof !== target) throw new Error('Target changed after preview')
    await command('/usr/bin/podman', ['restart', '--time', '10', target], policy)
    const state = await command('/usr/bin/podman', ['inspect', '--format', '{{.State.Running}}', target], policy)
    if (state.trim() !== 'true') throw new Error('Container did not become running')
    return { target, running: true, note: 'Process running; application readiness requires its health checks' }
  }
  if (operation.kind === 'restart_service') {
    const service = unit(policy, operation.payload.target)
    if (operation.targetProof !== service) throw new Error('Service binding changed after preview')
    const before = await command('/usr/bin/systemctl', ['show', service, '-p', 'ActiveState', '-p', 'SubState'], policy)
    await command('/usr/bin/systemctl', ['restart', service], policy)
    const after = await command('/usr/bin/systemctl', ['show', service, '-p', 'ActiveState', '-p', 'SubState', '-p', 'Result'], policy)
    if (!after.includes('ActiveState=active')) throw new Error(`Service did not become active: ${after}`)
    return { target: operation.payload.target, before, after }
  }
  if (operation.kind !== 'wechat_send') throw new Error('Unsupported executor operation')
  const config = JSON.parse(readFileSync(policy.wechatConfig, 'utf8'))
  if (config.enabled !== true || config.direct_enabled !== true || !config.recipient_id || !config.account_id) throw new Error('WeChat direct messaging is not configured')
  if (operation.targetProof !== digest(JSON.stringify([config.account_id, config.recipient_id]))) throw new Error('WeChat identity binding changed after preview')
  const outbox = join(policy.wechatRoot, 'adhoc', 'outbox')
  const exchange = statSync(policy.wechatRoot)
  mkdirSync(outbox, { recursive: true, mode: 0o750 })
  chownSync(join(policy.wechatRoot, 'adhoc'), 0, exchange.gid)
  chmodSync(join(policy.wechatRoot, 'adhoc'), 0o750)
  chownSync(outbox, 0, exchange.gid)
  chmodSync(outbox, 0o2750)
  const path = join(outbox, `${operation.id}.json`)
  if (existsSync(path)) throw new Error('Message queue entry already exists; reconcile instead of resending')
  atomicJson(path, { schema_version: 1, kind: 'send', job_id: operation.id, account_sha256: digest(config.account_id),
    recipient_id: config.recipient_id, recipient_alias: operation.payload.recipient,
    text: operation.payload.text, text_sha256: digest(operation.payload.text),
    created_at: Date.now(), expires_at: operation.expiresAt,
    confirmation_request_id: operation.confirmationRequestId }, 0o640)
  chownSync(path, 0, exchange.gid)
  return { queued: true, operation: operation.id, recipient: operation.payload.recipient }
}

/** Handle a strict operation request from the dedicated Agent Unix-socket group. */
export async function dispatch(request, journal) {
  fields(request, ['action'], ['params'])
  const params = request.params ?? {}
  const policy = journal.policy
  switch (request.action) {
    case 'host_status': {
      fields(params, [])
      const memory = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'))
      return { cpuCount: cpus().length, load: loadavg(), memoryTotal: totalmem(), memoryAvailable: memory ? Number(memory[1]) * 1024 : freemem(), uptimeSeconds: uptime(),
        disk: await command('/usr/bin/df', ['-h', '/'], policy),
        containers: await command('/usr/bin/podman', ['ps', '--format', '{{.Names}}\t{{.Status}}', '--filter', 'status=running'], policy),
        services: Object.keys(policy.services), limits: policy.limits }
    }
    case 'service_status': {
      fields(params, ['target'])
      return { target: params.target, status: await command('/usr/bin/systemctl', ['show', unit(policy, params.target),
        '-p', 'Id', '-p', 'ActiveState', '-p', 'SubState', '-p', 'Result', '-p', 'MemoryCurrent', '-p', 'NRestarts'], policy) }
    }
    case 'service_logs': {
      fields(params, ['target'])
      return { target: params.target, logs: await command('/usr/bin/journalctl', ['-u', unit(policy, params.target),
        '-n', String(policy.limits.logLines), '--no-pager', '-o', 'cat'], policy) }
    }
    case 'wechat_status': {
      fields(params, [])
      const config = JSON.parse(readFileSync(policy.wechatConfig, 'utf8'))
      const heartbeat = JSON.parse(readFileSync(join(policy.wechatRoot, 'receipts', 'worker.json'), 'utf8'))
      return { alias: policy.wechatRecipientAlias, displayName: config.recipient_query, directEnabled: config.direct_enabled,
        heartbeat, fresh: Date.now() - Date.parse(heartbeat.checked_at) < 120000,
        note: 'ready reflects the worker UI check, not an end-to-end network delivery or recipient read receipt' }
    }
    case 'wechat_screenshot': {
      fields(params, [])
      const result = await exec('/usr/bin/podman', ['exec', 'gamma-wechat-login', '/usr/local/bin/python3', '-c',
        'from PIL import ImageGrab; import sys; ImageGrab.grab(xdisplay=":99").save(sys.stdout.buffer,format="PNG")'],
      { timeout: policy.limits.commandSeconds * 1000, maxBuffer: 2 * 1024 * 1024, encoding: 'buffer', env: { PATH: '/usr/bin:/bin', HOME: '/root' } })
      return { image: result.stdout.toString('base64'), mimeType: 'image/png', note: 'Read-only current WeChat desktop; do not infer recipient delivery from this image' }
    }
    case 'prepare': return journal.prepare(params)
    case 'execute': fields(params, ['id']); return journal.run(params.id)
    case 'receipt': {
      fields(params, ['id'])
      const operation = journal.get(params.id)
      if (operation.kind === 'wechat_send' && operation.state === 'queued') {
        const path = join(policy.wechatRoot, 'adhoc', 'receipts', `${operation.id}.json`)
        const deadline = Date.now() + policy.limits.commandSeconds * 1000
        while (Date.now() < deadline) {
          if (existsSync(path)) {
            operation.workerReceipt = receiptJson(path)
            if (!['queued', 'preparing', 'prepared', 'publishing'].includes(operation.workerReceipt.state)) break
          }
          await new Promise(resolve => setTimeout(resolve, policy.limits.workerPollSeconds * 1000))
        }
        if (operation.workerReceipt?.state === 'sent_verified') operation.state = 'completed'
        else if (operation.workerReceipt?.state === 'needs_review') operation.state = 'needs_review'
        else if (['refused', 'auth_required', 'failed_before_submit', 'expired'].includes(operation.workerReceipt?.state)) operation.state = 'failed'
        journal.save(operation)
      }
      return operation
    }
    default: throw new Error('Unknown broker action')
  }
}

/** Start the broker with a protected, pre-created socket directory and deterministic shutdown. */
export function startBroker(policyPath) {
  const policy = readPolicy(policyPath)
  const directory = statSync(dirname(policy.socket))
  if (directory.uid !== 0 || (directory.mode & 0o022) || realpathSync(dirname(policy.socket)) !== dirname(policy.socket)) throw new Error('Unsafe socket directory')
  const journal = new Operations(policy, policyPath, perform)
  if (existsSync(policy.socket)) throw new Error('Socket already exists; refuse a second broker')
  const server = createServer(socket => {
    let input = Buffer.alloc(0)
    let accepted = false
    socket.setTimeout(policy.limits.commandSeconds * 1000 + 5000, () => socket.destroy())
    socket.on('error', () => { /* The request still settles and journals independently after client disconnect. */ })
    socket.on('data', chunk => {
      if (accepted) return
      input = Buffer.concat([input, chunk])
      if (input.length > MAX_FRAME) { socket.destroy(); return }
      const end = input.indexOf(10)
      if (end === -1) return
      accepted = true
      void (async () => {
        try { const result = await dispatch(JSON.parse(input.subarray(0, end).toString()), journal); socket.end(JSON.stringify({ ok: true, result }) + '\n') }
        catch (error) { socket.end(JSON.stringify({ ok: false, error: redact(String(error.message)).slice(0, 600) }) + '\n') }
      })()
    })
  })
  server.maxConnections = 8
  server.listen(policy.socket, () => {
    chmodSync(policy.socket, 0o660)
    // systemd's RuntimeDirectory is root:octopus-agent, so its GID is the socket's authority.
    chownSync(policy.socket, 0, statSync(dirname(policy.socket)).gid)
    console.log('Octopus operations broker ready')
  })
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    server.close(() => { journal.close(); if (existsSync(policy.socket)) unlinkSync(policy.socket) })
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) startBroker(process.argv[2])
