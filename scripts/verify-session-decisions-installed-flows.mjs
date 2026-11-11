#!/usr/bin/env node
/** Exercise the packaged question tool, queued answer and cold dedup through public remotes. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateInstalledTarget } from './verify-composer-predictions-installed-flows.mjs'
import { InstalledCompanionRunner } from './verify-dsh-context-installed-flows.mjs'

async function until(read, matches, label) {
  const deadline = Date.now() + 15000
  do {
    const value = await read()
    if (matches(value)) return value
    await new Promise(done => setTimeout(done, 30))
  } while (Date.now() < deadline)
  throw new Error(`Installed question deadline exceeded: ${label}`)
}

/**
 * Run against an explicit packaged target with isolated state and loopback-only model traffic.
 * @param target - Installed application or resources directory.
 * @returns Completion after the companion, provider and temporary state are closed.
 */
export async function verifyInstalledQuestions(target) {
  const bundle = validateInstalledTarget(target)
  assert(bundle.plugins.some(plugin => plugin.manifest.name === '@deepseek-ai/dsh-experimental-session-decisions'),
    'Installed session-decisions profile layer is required')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'installed-questions-')))
  const home = join(root, 'home'), workspace = join(root, 'workspace')
  mkdirSync(home); mkdirSync(workspace)
  const runner = new InstalledCompanionRunner(bundle, home, workspace)
  let calls = 0
  const providerFailures = []
  const server = createServer(async (request, response) => {
    try {
      assert(request.url?.endsWith('/messages'), 'Only the loopback Messages route is expected')
      let body = ''
      for await (const chunk of request) {
        body += chunk
        assert(Buffer.byteLength(body) < 2000000, 'Installed model request exceeds the fixture bound')
      }
      const payload = JSON.parse(body)
      calls += 1
      assert(calls <= 2, 'Duplicate admission dispatched an extra model request')
      const asking = calls === 1
      const content = asking
        ? { type: 'tool_use', id: 'installed-question', name: 'request_persistent_question', input: {} }
        : { type: 'text', text: '' }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const event = data => response.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`)
      event({ type: 'message_start', message: { id: `installed-${calls}`, type: 'message', role: 'assistant',
        model: payload.model, content: [], usage: { input_tokens: 10, output_tokens: 0 } } })
      event({ type: 'content_block_start', index: 0, content_block: content })
      event({ type: 'content_block_delta', index: 0, delta: asking
        ? { type: 'input_json_delta', partial_json: JSON.stringify({ question: 'Deploy the installed build?',
          choices: ['/deploy-production', 'Keep staging'] }) }
        : { type: 'text_delta', text: 'The saved answer has been received.' } })
      event({ type: 'content_block_stop', index: 0 })
      event({ type: 'message_delta', delta: { stop_reason: asking ? 'tool_use' : 'end_turn', stop_sequence: null },
        usage: { output_tokens: 10 } })
      event({ type: 'message_stop' })
      response.end()
    } catch (error) {
      providerFailures.push(error)
      if (!response.headersSent) response.writeHead(500)
      response.end()
    }
  })
  try {
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const profile = join(home, '.dsh', 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-desktop-app']
    const dependencies = {}
    for (const { path, manifest } of bundle.plugins) {
      const destination = join(profile, 'node_modules', ...manifest.name.split('/'))
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(path, destination, { recursive: true })
      bundles.push(manifest.name)
      dependencies[manifest.name] = manifest.version
    }
    writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'installed-question-profile', private: true,
      dependencies, dsh: { profile: { bundles } } }) + '\n')
    writeFileSync(join(profile, 'cordis.patch.yml'), [
      '- id: llm-deepseek', '  config:', `    baseURL: http://127.0.0.1:${server.address().port}`,
      '    thinking: disabled', '    retryPolicy:', '      mode: normal', '      maxRetries: 0',
      '- id: session-title-llm', '  disabled: true', '- id: session-log-deepseek', '  disabled: true',
      '- id: assistant-registry', '  config:', '    enableMemoryReview: false',
    ].join('\n') + '\n')
    await runner.start()
    const selectedWorkspace = await runner.call('workspace/create', { request: { path: workspace } })
    const { sessionId } = await runner.call('session/create', { request: {
      workspaceId: selectedWorkspace.workspace.workspaceId, agentPreset: 'persistent-questions',
    } })
    const catalog = await runner.call('session/modelCatalog')
    const provider = catalog.groups.find(group => group.id === 'deepseek-official')
    assert(provider?.models.length, 'Installed model catalog has no test route')
    await runner.call('session/selectModel', { request: { sessionId, provider: provider.id, model: provider.models[0].id } })
    await runner.call('session/prompt', { request: { sessionId, requestId: 'installed-question-start', mode: 'queue',
      content: [{ type: 'text', text: 'Ask me whether to deploy.' }] } })
    const question = await until(() => runner.call('sessionDecisions/catalog', { sessionId }),
      rows => rows.length === 1, 'question production')
    const view = question[0]
    const args = { decisionId: view.decisionId, expectedRevision: view.revision,
      requestId: view.requestId, payload: { choiceOrdinal: 2 } }
    const admitted = await runner.call('sessionDecisions/submit', args)
    assert.equal(admitted.outcome, 'accepted')
    const settled = await until(() => runner.call('sessionDecisions/get', { decisionId: view.decisionId }),
      record => record.lifecycle === 'answered' && record.answerIndex === 'admitted', 'durable answer entry')
    assert.equal((await runner.call('sessionDecisions/submit', args)).outcome, 'admitted')
    assert.equal((await runner.call('sessionDecisions/submit', { ...args, payload: { choiceOrdinal: 1 } })).outcome, 'rejected')
    assert.equal(calls, 2)
    await runner.stop()
    await runner.start()
    assert.equal((await runner.call('sessionDecisions/get', { decisionId: view.decisionId })).answerIndex, 'admitted')
    assert.equal((await runner.call('sessionDecisions/submit', { ...args, expectedRevision: settled.revision })).outcome, 'admitted')
    await runner.call('session/prompt', { request: { sessionId, requestId: view.requestId, mode: 'queue',
      content: [{ type: 'text', text: 'This duplicate request must not enter the conversation.' }] } })
    const projection = await runner.call('session/projections', { request: { sessionId } })
    const page = await runner.call('session/page', { request: { address: { kind: 'session', sessionId }, throughSeq: projection.asOfSeq } })
    const messages = page.records.filter(row => row.event?.type === 'user/message').map(row => row.event.data)
    const answers = messages.filter(message => message.source.kind === 'user' && message.source.rpcId === view.requestId)
    assert.equal(answers.length, 1)
    assert.equal(answers[0].content[0].text, `Answer to question ${view.decisionId}: option 2`)
    assert.equal(calls, 2)
    assert.deepEqual(providerFailures, [])
    console.log('READY: installed question tool, queued answer, conflict rejection, durable entry and cold request dedup passed')
  } finally {
    try { await runner.stop() } finally {
      server.closeAllConnections()
      await new Promise(done => server.close(done))
      rmSync(root, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyInstalledQuestions(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1 })
}
