/** Keyless JSON-RPC app-server peer; no Codex executable, credentials, or network. */
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { isAbsolute, join } from 'node:path'

const home = process.env.CODEX_FIXTURE_HOME
if (home === undefined || !isAbsolute(home) || process.env.HOME !== home
  || process.env.USERPROFILE !== home || process.env.CODEX_HOME !== join(home, '.codex')
  || Object.keys(process.env).some(key => /^(?:OPENAI_(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN)|CODEX_(?:API_KEY|ACCESS_TOKEN)|CHATGPT_(?:ACCESS_TOKEN|AUTH_TOKEN))$/i.test(key))) {
  process.stderr.write('codex-partial-answer: private credential-free fixture environment required\n')
  process.exit(1)
}

const threadId = 'fixture-thread'
const turnId = 'fixture-turn'
let model
const emit = (frame) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n')
const answer = (text, phase) => emit({
  method: 'item/completed',
  params: { threadId, turnId, item: { type: 'agentMessage', text, phase } },
})
const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  const frame = JSON.parse(line)
  if (frame.method === 'initialize') {
    emit({ id: frame.id, result: { userAgent: 'codex-partial-answer-fixture' } })
  } else if (frame.method === 'initialized') {
    // Notification has no response.
  } else if (frame.method === 'thread/start') {
    if (frame.params.ephemeral !== true || frame.params.approvalPolicy !== 'never') {
      throw new Error('codex-partial-answer: unexpected thread policy')
    }
    model = frame.params.model
    emit({ id: frame.id, result: { thread: { id: threadId, ephemeral: true } } })
  } else if (frame.method === 'turn/start') {
    const final = model === 'codex-secondary-model'
    if (!final && model !== 'codex-primary-model') throw new Error('unexpected model')
    appendFileSync('codex-probe.jsonl', JSON.stringify({ model, ephemeral: true, approvalPolicy: 'never' }) + '\n')
    emit({ id: frame.id, result: { turn: { id: turnId } } })
    answer('unphased before partial', null)
    answer('first partial', 'partial_answer')
    answer('PARTIAL_SELECTED', 'partial_answer')
    if (final) answer('FINAL_SELECTED', 'final_answer')
    answer('commentary must stay hidden', 'commentary')
    answer('unphased after partial must lose', null)
    if (final) answer('later partial must lose to final', 'partial_answer')
    const prompt = frame.params.input.map(item => item.text).join('\n')
    if (prompt === 'Hold after partial.') return
    const status = prompt === 'Fail after partial.' ? 'failed' : 'completed'
    emit({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status, error: null } } })
  } else if (frame.method === 'turn/interrupt') {
    emit({ id: frame.id, result: {} })
    emit({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'interrupted', error: null } } })
  } else {
    throw new Error('codex-partial-answer: unexpected protocol method')
  }
})
