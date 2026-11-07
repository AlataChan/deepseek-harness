/** Authorization and crash controls use private SQLite state and never contact production services. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { Operations, authority } from '../operations.mjs'
import { validatePolicy } from '../policy.mjs'
import { dispatch, redact, perform } from '../broker.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'octopus-ops-'))
  const policyPath = join(root, 'policy.json')
  const bindingKey = JSON.stringify(['feishu', 'app', 'org', 'chat', 'owner'])
  const policy = { socket: join(root, 'broker.sock'), state: join(root, 'state'), ingressDatabase: join(root, 'ingress.sqlite'),
    bindingKey, operatorId: 'owner', tenantId: 'octopus', services: { probe: 'octopus-probe.service' }, containers: ['probe'],
    wechatRoot: root, wechatConfig: join(root, 'wechat.json'), wechatRecipientAlias: '默认联系人',
    limits: { logLines: 50, previewSeconds: 600, workerPollSeconds: 2, maxTextBytes: 1000, commandSeconds: 10 } }
  writeFileSync(policyPath, JSON.stringify(policy))
  writeFileSync(policy.wechatConfig, JSON.stringify({ account_id: 'own-wechat', recipient_id: 'friend', recipient_query: 'fixture', enabled: true, direct_enabled: true }))
  let now = 100000
  let actor = { requestId: 'human-1', prompt: '请准备操作', receivedAt: now }
  let executions = 0
  let journal = new Operations(policy, policyPath, async () => { executions++; return { ok: true } }, () => now, () => actor)
  t.after(() => { journal.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, policy, policyPath, get journal() { return journal }, get executions() { return executions },
    actor: value => { actor = value }, time: value => { now = value },
    reopen: () => { journal.close(); journal = new Operations(policy, policyPath, async () => { executions++ }, () => now, () => actor) } }
}

test('strict targets and fields reject command and path injection', t => {
  const f = fixture(t)
  for (const payload of [{ target: 'probe; reboot' }, { target: '../../etc/shadow' }, { target: 'probe', command: 'id' }]) {
    assert.throws(() => f.journal.prepare({ kind: 'restart_service', payload }))
  }
  assert.throws(() => f.journal.prepare({ kind: 'shell', payload: {} }))
  assert.throws(() => f.journal.prepare({ kind: 'wechat_send', payload: { recipient: 'stranger', text: 'hello' } }))
  assert.throws(() => validatePolicy({ ...f.policy, limits: { ...f.policy.limits, commandSeconds: Infinity } }))
})

test('symlinked release entry executes startup validation instead of silently exiting', t => {
  const f = fixture(t)
  const link = join(f.root, 'broker-link.mjs')
  symlinkSync(fileURLToPath(new URL('../broker.mjs', import.meta.url)), link)
  const result = spawnSync(process.execPath, [link, join(f.root, 'missing-policy.json')], { encoding: 'utf8', timeout: 5000 })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /missing-policy/)
})

test('service changes still require exact human confirmation and keep frozen arguments', async t => {
  const f = fixture(t)
  const input = { kind: 'restart_service', payload: { target: 'probe' } }
  const op = f.journal.prepare(input)
  input.payload.target = 'modified'
  assert.equal(f.journal.get(op.id).payload.target, 'probe')
  await assert.rejects(f.journal.run(op.id), /本人/)
  f.actor({ requestId: 'human-2', prompt: `确认执行 ${op.id}`, receivedAt: 99999 })
  await assert.rejects(f.journal.run(op.id), /本人/)
  f.actor({ requestId: 'human-2', prompt: `确认执行 ${op.id}`, receivedAt: 100001 })
  assert.equal((await f.journal.run(op.id)).state, 'completed')
  await f.journal.run(op.id)
  assert.equal(f.executions, 1)
})

test('exact structured human instructions authorize only their current request', async t => {
  const f = fixture(t)
  f.actor({ requestId: 'human-1', prompt: '重启服务 probe', receivedAt: 100000 })
  const op = f.journal.prepare({ kind: 'restart_service', payload: { target: 'probe' } })
  assert.equal(op.id, f.journal.prepare({ kind: 'restart_service', payload: { target: 'probe' } }).id)
  assert.equal((await f.journal.run(op.id)).state, 'completed')
  assert.equal(f.executions, 1)
})

test('reordered arguments cannot produce a second direct send for one human request', async t => {
  const f = fixture(t)
  f.actor({ requestId: 'human-1', prompt: '微信发送 默认联系人\n正文', receivedAt: 100000 })
  const first = f.journal.prepare({ kind: 'wechat_send', payload: { recipient: '默认联系人', text: '正文' } })
  const second = f.journal.prepare({ kind: 'wechat_send', payload: { text: '正文', recipient: '默认联系人' } })
  assert.equal(first.id, second.id)
  await f.journal.run(first.id)
  await f.journal.run(second.id)
  assert.equal(f.executions, 1)
})

test('administrator recipient changes cannot redirect a previously frozen message', async t => {
  const f = fixture(t)
  f.actor({ requestId: 'human-1', prompt: '微信发送 默认联系人\n正文', receivedAt: 100000 })
  const operation = f.journal.prepare({ kind: 'wechat_send', payload: { recipient: '默认联系人', text: '正文' } })
  writeFileSync(f.policy.wechatConfig, JSON.stringify({ account_id: 'own-wechat', recipient_id: 'different-person', enabled: true, direct_enabled: true }))
  f.journal.execute = perform
  const result = await f.journal.run(operation.id)
  assert.equal(result.state, 'needs_review')
  assert.match(result.error, /binding changed/)
})

test('expiry and crash recovery never replay a claimed action', async t => {
  const f = fixture(t)
  const expired = f.journal.prepare({ kind: 'restart_service', payload: { target: 'probe' } })
  f.time(800000)
  assert.equal((await f.journal.run(expired.id)).state, 'expired')
  f.actor({ requestId: 'human-3', prompt: 'prepare', receivedAt: 800000 })
  const crash = f.journal.prepare({ kind: 'restart_service', payload: { target: 'probe' } })
  f.journal.save({ ...crash, state: 'executing' })
  f.reopen()
  assert.equal((await f.journal.run(crash.id)).state, 'needs_review')
  assert.equal(f.executions, 0)
})

test('limits are backed up and restored; stale configuration preview refuses changes', async t => {
  const f = fixture(t)
  const op = f.journal.prepare({ kind: 'set_limits', payload: { logLines: 80 } })
  f.actor({ requestId: 'human-2', prompt: `确认执行 ${op.id}`, receivedAt: 100001 })
  assert.equal((await f.journal.run(op.id)).state, 'completed')
  assert.equal(JSON.parse(readFileSync(f.policyPath)).limits.logLines, 80)
  const restore = f.journal.prepare({ kind: 'restore_limits', payload: { operation: op.id } })
  f.actor({ requestId: 'human-3', prompt: `确认执行 ${restore.id}`, receivedAt: 100002 })
  assert.equal((await f.journal.run(restore.id)).state, 'completed')
  assert.equal(JSON.parse(readFileSync(f.policyPath)).limits.logLines, 50)
  const stale = f.journal.prepare({ kind: 'set_limits', payload: { logLines: 90 } })
  writeFileSync(f.policyPath, JSON.stringify({ ...f.policy, limits: { ...f.policy.limits, logLines: 70 } }))
  f.actor({ requestId: 'human-4', prompt: `确认执行 ${stale.id}`, receivedAt: 100003 })
  assert.equal((await f.journal.run(stale.id)).state, 'needs_review')
  assert.equal(JSON.parse(readFileSync(f.policyPath)).limits.logLines, 70)
})

test('confirmation authority comes from a current non-revoked matching ingress binding', t => {
  const f = fixture(t)
  const db = new DatabaseSync(f.policy.ingressDatabase)
  t.after(() => db.close())
  db.exec('CREATE TABLE u_im_ingress_operators(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE u_im_ingress_deliveries(key TEXT PRIMARY KEY,value TEXT)')
  const binding = { revokedAt: null, operatorId: 'owner', targetTenantId: 'octopus' }
  db.prepare('INSERT INTO u_im_ingress_operators VALUES(?,?)').run(f.policy.bindingKey, JSON.stringify(binding))
  const row = { status: 'in_flight', operatorId: 'owner', targetTenantId: 'octopus', requestId: 'request', prompt: 'authentic',
    receivedAt: new Date(100000).toISOString(), deliveryKey: JSON.stringify(['feishu', 'app', 'org', 'chat', 'owner', 'event']) }
  db.prepare('INSERT INTO u_im_ingress_deliveries VALUES(?,?)').run('one', JSON.stringify(row))
  assert.equal(authority(f.policy, 100001).prompt, 'authentic')
  assert.throws(() => authority(f.policy, 900000))
  db.prepare('UPDATE u_im_ingress_operators SET value=?').run(JSON.stringify({ ...binding, revokedAt: 'now' }))
  assert.throws(() => authority(f.policy, 100001), /revoked/)
  db.prepare('UPDATE u_im_ingress_operators SET value=?').run(JSON.stringify(binding))
  db.prepare('UPDATE u_im_ingress_deliveries SET value=?').run(JSON.stringify({ ...row,
    deliveryKey: JSON.stringify(['feishu', 'app', 'org', 'other-chat', 'owner', 'event']) }))
  assert.throws(() => authority(f.policy, 100001), /Exactly one/)
  db.prepare('UPDATE u_im_ingress_deliveries SET value=?').run(JSON.stringify(row))
  db.prepare('INSERT INTO u_im_ingress_deliveries VALUES(?,?)').run('second', JSON.stringify({ ...row, requestId: 'overlapping' }))
  assert.throws(() => authority(f.policy, 100001), /Exactly one/)
})

test('broker rejects extra request arguments and redacts credential assignments', async t => {
  const f = fixture(t)
  await assert.rejects(dispatch({ action: 'service_logs', params: { target: 'probe', command: 'cat /etc/shadow' } }, f.journal))
  await assert.rejects(dispatch({ action: 'unknown', params: {} }, f.journal))
  assert(!redact('API_KEY=secret Authorization: Bearer abc.xyz').includes('secret'))
  assert(!redact('API_KEY=secret Authorization: Bearer abc.xyz').includes('abc.xyz'))
})

test('natural-language WeChat instructions execute in their authenticated turn without confirmation', async t => {
  const f = fixture(t)
  f.actor({ requestId: 'human-1', prompt: '给 fixture 发微信：微信调通了', receivedAt: 100000 })
  const input = { kind: 'wechat_send', payload: { recipient: 'fixture', text: '微信调通了' } }
  const op = f.journal.prepare(input)
  assert.equal(op.direct, true)
  assert.equal(op.payload.recipient, '默认联系人')
  assert.equal(f.journal.prepare({ kind: 'wechat_send', payload: { recipient: '默认联系人', text: '微信调通了' } }).id, op.id)
  input.payload.text = 'changed after preparation'
  f.actor({ requestId: 'human-2', prompt: '检查服务器状态', receivedAt: 100001 })
  await assert.rejects(f.journal.run(op.id), /本人/)
  f.actor({ requestId: 'human-1', prompt: '给 fixture 发微信：微信调通了', receivedAt: 100000 })
  assert.equal((await f.journal.run(op.id)).state, 'queued')
  assert.equal(f.journal.get(op.id).payload.text, '微信调通了')
  await f.journal.run(op.id)
  assert.equal(f.executions, 1)
})
