/** Frozen operations, source-authenticated confirmation and durable single-use execution. */
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, fchmodSync, unlinkSync, constants } from 'node:fs'
import { join, dirname } from 'node:path'
import { fields, validatePolicy } from './policy.mjs'

/** SHA-256 over UTF-8 text for frozen messages and configuration backups. */
export function digest(text) { return createHash('sha256').update(text).digest('hex') }

/** Replace a JSON document durably without following a destination symlink. */
export function atomicJson(path, value, mode = 0o600) {
  const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode)
  try { fchmodSync(fd, mode); writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
  try { renameSync(temporary, path) } catch (error) {
    try { unlinkSync(temporary) } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw new AggregateError([error, cleanupError], 'JSON replacement and cleanup failed')
    }
    throw error
  }
  const directory = openSync(dirname(path), constants.O_RDONLY)
  try { fsyncSync(directory) } finally { closeSync(directory) }
}

/** Resolve authority from the ingress-owned database; model text is never an authority source. */
export function authority(policy, now) {
  const db = new DatabaseSync(policy.ingressDatabase, { readOnly: true })
  try {
    const operator = db.prepare('SELECT value FROM u_im_ingress_operators WHERE key=?').get(policy.bindingKey)
    if (!operator) throw new Error('No authenticated binding')
    const binding = JSON.parse(operator.value)
    if (binding.revokedAt !== null || binding.operatorId !== policy.operatorId || binding.targetTenantId !== policy.tenantId) throw new Error('Binding revoked or changed')
    const rows = db.prepare("SELECT value FROM u_im_ingress_deliveries WHERE json_extract(value,'$.status')='in_flight' AND json_extract(value,'$.operatorId')=? AND json_extract(value,'$.targetTenantId')=?").all(policy.operatorId, policy.tenantId)
    const live = rows.map(row => JSON.parse(row.value)).filter(row => {
      const identity = JSON.parse(row.deliveryKey)
      return JSON.stringify(identity.slice(0, 5)) === policy.bindingKey && Date.parse(row.receivedAt) <= now && now - Date.parse(row.receivedAt) <= policy.limits.previewSeconds * 1000
    })
    if (live.length !== 1) throw new Error('Exactly one current authenticated human delivery is required')
    return { requestId: live[0].requestId, prompt: live[0].prompt, receivedAt: Date.parse(live[0].receivedAt) }
  } finally { db.close() }
}

/** Durable journal with no automatic replay of claimed operations. */
export class Operations {
  constructor(policy, policyPath, execute, clock = Date.now, resolveAuthority = authority) {
    this.policy = validatePolicy(policy)
    this.policyPath = policyPath
    this.execute = execute
    this.clock = clock
    this.resolveAuthority = resolveAuthority
    mkdirSync(policy.state, { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(join(policy.state, 'operations.sqlite'))
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, value TEXT NOT NULL)")
    for (const row of this.db.prepare("SELECT id,value FROM operations WHERE json_extract(value,'$.state')='executing'").all()) {
      const operation = JSON.parse(row.value)
      operation.state = 'needs_review'
      operation.error = 'Broker stopped after claiming the operation; inspect before retrying'
      this.save(operation)
    }
  }

  save(operation) {
    this.db.prepare('INSERT INTO operations(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(operation.id, JSON.stringify(operation))
  }

  get(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) throw new Error('Invalid operation identifier')
    const row = this.db.prepare('SELECT value FROM operations WHERE id=?').get(id)
    if (!row) throw new Error('Unknown operation')
    const operation = JSON.parse(row.value)
    if (operation.state === 'prepared' && this.clock() >= operation.expiresAt) { operation.state = 'expired'; this.save(operation) }
    return operation
  }

  prepare(input) {
    fields(input, ['kind', 'payload'])
    const actor = this.resolveAuthority(this.policy, this.clock())
    const payload = structuredClone(input.payload)
    let direct
    let targetProof
    let recipientDisplayName
    if (input.kind === 'restart_service' || input.kind === 'restart_container') {
      fields(payload, ['target'])
      if (input.kind === 'restart_service' ? !Object.hasOwn(this.policy.services, payload.target) : !this.policy.containers.includes(payload.target)) throw new Error('Target is not allowed')
      targetProof = input.kind === 'restart_service' ? this.policy.services[payload.target] : payload.target
      direct = actor.prompt.trim() === `${input.kind === 'restart_service' ? '重启服务' : '重启容器'} ${payload.target}`
    } else if (input.kind === 'wechat_send') {
      fields(payload, ['recipient', 'text'])
      if (typeof payload.text !== 'string' || !payload.text.trim() || Buffer.byteLength(payload.text) > this.policy.limits.maxTextBytes || payload.text.includes('\0')) throw new Error('Invalid or oversized message')
      const config = JSON.parse(readFileSync(this.policy.wechatConfig, 'utf8'))
      if (!config.account_id || !config.recipient_id) throw new Error('WeChat recipient binding is missing')
      if (payload.recipient !== this.policy.wechatRecipientAlias && payload.recipient !== config.recipient_query) throw new Error('Recipient is not bound')
      payload.recipient = this.policy.wechatRecipientAlias
      targetProof = digest(JSON.stringify([config.account_id, config.recipient_id]))
      recipientDisplayName = config.recipient_query
      // The owner permits sending in the requesting turn without a second confirmation.
      direct = true
    } else if (input.kind === 'set_limits') {
      fields(payload, [], ['logLines', 'previewSeconds'])
      if (!Object.keys(payload).length) throw new Error('Empty configuration change')
      validatePolicy({ ...this.policy, limits: { ...this.policy.limits, ...payload } })
      payload.previousSha256 = digest(readFileSync(this.policyPath, 'utf8'))
    } else if (input.kind === 'restore_limits') {
      fields(payload, ['operation'])
      const old = this.get(payload.operation)
      if (old.kind !== 'set_limits' || old.state !== 'completed') throw new Error('No completed configuration backup')
      payload.previousSha256 = digest(readFileSync(this.policyPath, 'utf8'))
    } else throw new Error('Unknown operation kind')
    // A duplicate model call in the same request returns the original frozen preview.
    const canonicalPayload = Object.fromEntries(Object.entries(payload).sort(([left], [right]) => left.localeCompare(right)))
    const fingerprint = digest(JSON.stringify([actor.requestId, input.kind, canonicalPayload]))
    const previous = this.db.prepare("SELECT value FROM operations WHERE json_extract(value,'$.fingerprint')=?").get(fingerprint)
    if (previous) return JSON.parse(previous.value)
    const operation = { id: randomBytes(12).toString('hex'), kind: input.kind, payload, fingerprint, state: 'prepared',
      createdAt: this.clock(), expiresAt: this.clock() + this.policy.limits.previewSeconds * 1000,
      actorRequestId: actor.requestId, direct: Boolean(direct) }
    if (targetProof !== undefined) operation.targetProof = targetProof
    if (recipientDisplayName !== undefined) operation.recipientDisplayName = recipientDisplayName
    this.save(operation)
    return operation
  }

  async run(id) {
    let operation = this.get(id)
    if (['completed', 'queued', 'needs_review', 'expired'].includes(operation.state)) return operation
    if (operation.state !== 'prepared') throw new Error('Operation has already been claimed')
    const actor = this.resolveAuthority(this.policy, this.clock())
    const confirmed = actor.prompt.trim() === `确认执行 ${id}` && actor.receivedAt >= operation.createdAt && actor.requestId !== operation.actorRequestId
    if (!(confirmed || (operation.direct && actor.requestId === operation.actorRequestId))) throw new Error(`需要本人在飞书回复：确认执行 ${id}`)
    const replacement = { ...operation, state: 'executing', confirmationRequestId: actor.requestId }
    const changed = this.db.prepare("UPDATE operations SET value=? WHERE id=? AND json_extract(value,'$.state')='prepared'").run(JSON.stringify(replacement), id)
    if (changed.changes !== 1) throw new Error('Operation concurrently claimed')
    operation = replacement
    try {
      if (operation.kind === 'set_limits' || operation.kind === 'restore_limits') {
        const original = readFileSync(this.policyPath, 'utf8')
        if (digest(original) !== operation.payload.previousSha256) throw new Error('Configuration changed after preview')
        const backup = join(this.policy.state, `${id}.backup.json`)
        atomicJson(backup, JSON.parse(original))
        const limits = operation.kind === 'set_limits' ? { ...this.policy.limits, ...operation.payload } :
          JSON.parse(readFileSync(join(this.policy.state, `${operation.payload.operation}.backup.json`), 'utf8')).limits
        const next = { ...this.policy, limits: Object.fromEntries(Object.entries(limits).filter(([key]) => key !== 'previousSha256')) }
        validatePolicy(next)
        atomicJson(this.policyPath, next)
        this.policy = next
        operation.result = { backup: id, limits: next.limits }
        operation.state = 'completed'
      } else {
        operation.result = await this.execute(operation, this.policy)
        operation.state = operation.kind === 'wechat_send' ? 'queued' : 'completed'
      }
    } catch (error) { operation.state = 'needs_review'; operation.error = String(error.message).slice(0, 500) }
    this.save(operation)
    return operation
  }

  close() { this.db.close() }
}
