/** Root-only, isolated authority/database and disposable service acceptance; never sends WeChat. */
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Operations } from '../operations.mjs'
import { perform } from '../broker.mjs'

if (process.getuid() !== 0) throw new Error('This gate requires the target Linux administrator')
const root = mkdtempSync(join(tmpdir(), 'octopus-installed-ops-'))
const probeUnit = `octopus-ops-probe-${process.pid}`
const policyPath = join(root, 'policy.json')
const bindingKey = JSON.stringify(['feishu', 'fixture-app', 'fixture-org', 'fixture-chat', 'fixture-owner'])
const policy = { socket: join(root, 'unused.sock'), state: join(root, 'journal'), ingressDatabase: join(root, 'ingress.sqlite'),
  bindingKey, operatorId: 'owner', tenantId: 'octopus', services: { probe: `${probeUnit}.service` }, containers: [],
  wechatRoot: join(root, 'wechat'), wechatConfig: join(root, 'wechat.json'), wechatRecipientAlias: 'fixture-recipient',
  limits: { logLines: 50, previewSeconds: 600, workerPollSeconds: 2, maxTextBytes: 1000, commandSeconds: 30 } }
mkdirSync(policy.wechatRoot)
writeFileSync(policy.wechatConfig, JSON.stringify({ enabled: true, direct_enabled: true, account_id: 'fixture-account', recipient_id: 'fixture-recipient-id' }))
writeFileSync(policyPath, JSON.stringify(policy))
const ingress = new DatabaseSync(policy.ingressDatabase)
ingress.exec('CREATE TABLE u_im_ingress_operators(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE u_im_ingress_deliveries(key TEXT PRIMARY KEY,value TEXT)')
ingress.prepare('INSERT INTO u_im_ingress_operators VALUES(?,?)').run(bindingKey, JSON.stringify({ operatorId: 'owner', targetTenantId: 'octopus', revokedAt: null }))
let request = 0
function human(prompt) {
  ingress.prepare('DELETE FROM u_im_ingress_deliveries').run()
  const row = { status: 'in_flight', operatorId: 'owner', targetTenantId: 'octopus', requestId: `fixture-${++request}`,
    prompt, receivedAt: new Date().toISOString(), deliveryKey: JSON.stringify(['feishu', 'fixture-app', 'fixture-org', 'fixture-chat', 'fixture-owner', `fixture-${request}`]) }
  ingress.prepare('INSERT INTO u_im_ingress_deliveries VALUES(?,?)').run('current', JSON.stringify(row))
}
let journal
let started = false
try {
  execFileSync('/usr/bin/systemd-run', ['--unit', probeUnit, '--property=User=nobody', '--property=MemoryMax=32M', '--property=TasksMax=8', '/usr/bin/sleep', '180'])
  started = true
  const pid = () => execFileSync('/usr/bin/systemctl', ['show', `${probeUnit}.service`, '-p', 'MainPID', '--value'], { encoding: 'utf8' }).trim()
  const before = pid()
  journal = new Operations(policy, policyPath, perform)
  human('重启服务 probe')
  const restart = journal.prepare({ kind: 'restart_service', payload: { target: 'probe' } })
  assert.equal((await journal.run(restart.id)).state, 'completed')
  const after = pid()
  assert.notEqual(after, before)
  await journal.run(restart.id)
  assert.equal(pid(), after)
  journal.close()
  journal = new Operations(policy, policyPath, perform)
  await journal.run(restart.id)
  assert.equal(pid(), after)
  console.log('REAL_DISPOSABLE_SERVICE_RESTART_AND_COLD_DEDUP_OK')
  human('prepare limits')
  const change = journal.prepare({ kind: 'set_limits', payload: { logLines: 70 } })
  await assert.rejects(journal.run(change.id), /本人/)
  human(`确认执行 ${change.id}`)
  assert.equal((await journal.run(change.id)).state, 'completed')
  assert.equal(JSON.parse(readFileSync(policyPath)).limits.logLines, 70)
  const restore = journal.prepare({ kind: 'restore_limits', payload: { operation: change.id } })
  human(`确认执行 ${restore.id}`)
  assert.equal((await journal.run(restore.id)).state, 'completed')
  assert.equal(JSON.parse(readFileSync(policyPath)).limits.logLines, 50)
  console.log('AUTHENTICATED_CONFIRMATION_CONFIG_BACKUP_AND_RESTORE_OK')
  human('prepare message')
  const message = journal.prepare({ kind: 'wechat_send', payload: { recipient: 'fixture-recipient', text: 'Isolated outbox only; no desktop consumer exists here.' } })
  await assert.rejects(journal.run(message.id), /本人/)
  human(`确认执行 ${message.id}`)
  assert.equal((await journal.run(message.id)).state, 'queued')
  const jobs = readdirSync(join(policy.wechatRoot, 'adhoc', 'outbox')).filter(name => name.endsWith('.json'))
  assert.equal(jobs.length, 1)
  assert.equal(JSON.parse(readFileSync(join(policy.wechatRoot, 'adhoc', 'outbox', jobs[0]))).recipient_id, 'fixture-recipient-id')
  await journal.run(message.id)
  assert.equal(readdirSync(join(policy.wechatRoot, 'adhoc', 'outbox')).filter(name => name.endsWith('.json')).length, 1)
  console.log('ISOLATED_FROZEN_WECHAT_QUEUE_ONCE_NO_REAL_MESSAGE_OK')
} finally {
  journal?.close()
  ingress.close()
  if (started) {
    execFileSync('/usr/bin/systemctl', ['stop', `${probeUnit}.service`])
  }
  rmSync(root, { recursive: true, force: true })
}
