/** Failure controls for the installed context verifier. Run with node --test. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { InstalledCompanionRunner, assertSocketsLoopbackOnly } from './verify-dsh-context-installed-flows.mjs'

test('rejects WAN peers and wildcard listeners while accepting numeric loopback endpoints', () => {
  const header = 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n'
  for (const endpoint of ['127.0.0.1:123->203.0.113.1:443', '*:8080', '0.0.0.0:8080', '[::]:8080']) {
    assert.throws(() => assertSocketsLoopbackOnly(1, `${header}node 1 user TCP ${endpoint}`), /Non-loopback/)
  }
  assert.doesNotThrow(() => assertSocketsLoopbackOnly(1, `${header}node 1 user TCP 127.0.0.1:123->[::1]:456`))
})

test('spawn failure rejects and releases the runner without waiting for a nonexistent exit', { timeout: 1500 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'context-spawn-error-'))
  const runner = new InstalledCompanionRunner({ node: join(root, 'missing-node'), companion: 'unused' }, root, root)
  try {
    await assert.rejects(runner.start({ offline: false, timeout: 100 }), /ENOENT/)
    assert.equal(runner.child, null)
  } finally {
    await runner.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('startup control errors reject with their diagnostic and terminate the child', { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'context-control-error-'))
  const companion = join(root, 'failed-companion.mjs')
  writeFileSync(companion, `process.stdout.write(JSON.stringify({type:'wire/message',encoded:JSON.stringify({type:'control/error',code:'startup-denied',message:'controlled startup failure'})})+'\\n');setInterval(()=>{},1000)\n`)
  const runner = new InstalledCompanionRunner({ node: process.execPath, companion }, root, root)
  try {
    const boot = runner.start({ offline: false, timeout: 10000 })
    const pid = runner.child.pid
    await assert.rejects(boot, /startup-denied/)
    assert.equal(runner.child, null)
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  } finally {
    await runner.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('does not accept a denied socket inspection as an empty socket inventory', () => {
  const denied = () => {
    throw Object.assign(new Error('inspection failed'), { status: 1, stderr: 'permission denied' })
  }
  assert.throws(() => assertSocketsLoopbackOnly(0, null, denied), /Failed to inspect/)
})
