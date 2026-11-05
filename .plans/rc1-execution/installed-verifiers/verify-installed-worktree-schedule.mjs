/** Copied-installer qualification through the shipped companion and public remotes; loopback model only. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateInstalledTarget, InstalledClient, scriptedProvider } from './verify-installed-questions-and-team.mjs'
const bundle = validateInstalledTarget(process.argv[2])
const root = mkdtempSync(join(tmpdir(), 'rc1-installed-f1-s1-'))
const home = join(root, 'home'), workspace = join(root, 'project')
mkdirSync(home); mkdirSync(workspace)
const provider = scriptedProvider()
let client
let checks = 0
function check(value, label) { assert(value, label); checks++; console.log(`PASS ${label}`) }
async function until(read, accepts, label) {
  const end = Date.now() + 30000
  while (Date.now() < end) { const value = await read(); if (accepts(value)) return value; await new Promise(done => setTimeout(done, 150)) }
  throw new Error(`Timed out: ${label}`)
}
function git(...args) { return execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', ...args], { cwd: workspace, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }) }
async function page(sessionId) {
  const projection = await client.call('session/projections', { request: { sessionId } })
  return client.call('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: projection.asOfSeq } })
}
try {
  git('init', '-b', 'main'); git('config', 'user.name', 'Installed fixture'); git('config', 'user.email', 'fixture@example.invalid')
  writeFileSync(join(workspace, 'tracked.txt'), 'before\n'); git('add', 'tracked.txt'); git('commit', '-m', 'fixture')
  await provider.listen()
  client = new InstalledClient(bundle, home, workspace, `http://127.0.0.1:${provider.server.address().port}`)
  // Explicit isolated-test activation of the optional review bundle. This is not the installed default.
  client.seed(); await client.start()
  const ws = await client.call('workspace/create', { request: { path: workspace } })
  const { sessionId } = await client.call('session/create', { request: { workspaceId: ws.workspace.workspaceId, agentPreset: 'standard' } })
  const models = await client.call('session/modelCatalog')
  const route = models.groups.find(group => group.id === 'deepseek-official')
  await client.call('session/selectModel', { request: { sessionId, provider: route.id, model: route.models[0].id } })
  await client.call('forgePanel/requestWorktree', { sessionId, from: null })
  await client.call('forgePanel/cancelWorktree', { sessionId })
  check(true, 'Optional installed Changes API accepts and cancels a local request')
  writeFileSync(join(workspace, 'tracked.txt'), 'after\n')
  const diff = await client.call('forgePanel/localDiff', { sessionId, scope: { kind: 'uncommitted' } })
  check(diff.files.some(file => file.path === 'tracked.txt'), 'Bundled Git service reads actual original-checkout changes')
  await client.call('forgePanel/requestWorktree', { sessionId, from: null })
  provider.state.sequence.push([{ text: 'INSTALLED_WORKTREE_OK' }])
  await client.call('session/prompt', { request: { sessionId, requestId: 'installed-worktree', mode: 'queue', content: [{ type: 'text', text: 'Inspect this isolated checkout.' }] } })
  const transcript = await until(() => page(sessionId), value => JSON.stringify(value).includes('INSTALLED_WORKTREE_OK'), 'isolated turn')
  const allText = JSON.stringify(transcript)
  check(allText.includes('working-directory/change') || provider.state.observations.some(item => JSON.stringify(item.payload).includes('/.agents/worktrees/')), 'Actual model request receives the isolated working directory')
  check(readFileSync(join(workspace, 'tracked.txt'), 'utf8') === 'after\n', 'Original checkout remains unchanged by isolated execution')
  const task = await client.call('schedule/create', { request: { title: 'Installed schedule', prompt: 'INSTALLED_SCHEDULE_PROMPT', timing: { kind: 'every', every_seconds: 3600 } } })
  check(task.target.kind === 'new_once', 'Human task creation reserves the default new-once target')
  const reserved = task.target.sessionId
  provider.state.sequence.push([{ text: 'INSTALLED_SCHEDULE_OK' }])
  await client.call('schedule/run', { request: { id: task.id } })
  await until(() => page(reserved), value => JSON.stringify(value).includes('INSTALLED_SCHEDULE_OK'), 'manual scheduled delivery')
  const view = await client.call('schedule/view', { request: { id: task.id } })
  check(view.target.kind === 'session' && view.target.sessionId === reserved, 'Delivery adopts exactly the reserved target Session')
  const receipts = await client.call('schedule/history', { request: { id: task.id, limit: 10 } })
  check(JSON.stringify(receipts).includes(reserved), 'Task manager exposes the actual persisted delivery receipt')
  await client.stop(); await client.start()
  const restored = await client.call('schedule/view', { request: { id: task.id } })
  check(restored.target.kind === 'session' && restored.target.sessionId === reserved, 'Cold companion restart retains the adopted destination')
  const removed = await client.call('schedule/edit', { request: { id: task.id, action: 'delete', expectedUpdatedAt: restored.updatedAt } })
  check(removed.deleted === true, 'Public task manager removes the retained task with its revision token')
  console.log(JSON.stringify({ checks, paidCalls: 0, externalSends: 0, optionalReviewExplicitlyEnabled: true }))
} finally { await client?.stop(); await provider.close(); rmSync(root, { recursive: true, force: true }) }
