/** Actual tool execution must agree with the live single-use card decision. */
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ToolCallId, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { defineTool, RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { PtcRuntime, type PtcRunRequest, type PtcRunResult, type PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'
import { TenantIpcClient, TenantIpcServer } from '../src/ipc.ts'
import { TenantInteractionHandler } from '../src/interaction-handler.ts'
import { TenantQuestionBroker, questionActionDomain } from '../src/question-broker.ts'
import { TenantApprovalBroker } from '../src/approval-broker.ts'
import { ApprovalActionStore, approvalActionDomain } from '../src/approval-actions.ts'
import { createServiceFixture } from './service-fixture.ts'
import { mintImSessionRequestId } from '../src/source.ts'

class DispatchRuntime extends PtcRuntime {
  override readonly language = 'typescript'
  override readonly isolation = 'test'
  resolve(request: PtcRunRequest): PtcRunSpec { return { ...request, cwd: '/workspace', timeoutMs: 1000 } }
  async run(request: PtcRunRequest): Promise<PtcRunResult> {
    await request.bindings[0]?.functions.mutate?.({ password: 'sensitive-value' })
    return { logs: [] }
  }
}

for (const mode of ['native', 'ptc'] as const) {
  describe.skipIf(process.platform === 'win32')(`Live ${mode} approval over POSIX AF_UNIX`, () => {
    it.each(['allow', 'reject', 'cancel', 'foreign-actor', 'revoked', 'storage-failure'] as const)('controls actual side effects for %s', async (decision) => {
      const f = await createServiceFixture(false, mode)
      let broker: TenantApprovalBroker | undefined
      let server: TenantIpcServer | undefined
      let client: TenantIpcClient | undefined
      try {
        await f.ctx.plugin(ApprovalService)
        if (mode === 'ptc') await f.ctx.plugin(DispatchRuntime)
        const key = JSON.stringify(['feishu', 'app', 'organization', 'chat', 'sender', 'event'])
        const agent = await f.provider.getOrCreateAgent('conversation', f.operatorId, new AbortController().signal)
        const receipt = await f.receipts.recordAdmitting({ deliveryKey: key, sessionId: agent.session.id,
          requestId: mintImSessionRequestId(), operatorId: f.operatorId })
        let revoked = false
        const actions = new ApprovalActionStore(await f.facility.open(approvalActionDomain), {
          maxRecords: 20, maxPending: 4, timeoutMs: 2000, maxSummaryBytes: 1024,
        })
        broker = new TenantApprovalBroker(f.ctx, { ...f.runtime.config, maxTrackedCalls: 8 }, actions,
          target => target === agent && !revoked ? receipt : undefined)
        const questions = new TenantQuestionBroker(f.ctx, await f.facility.open(questionActionDomain), {
          maxRecords: 10, maxPending: 2, timeoutMs: 2000, maxQuestionBytes: 1000, maxAnswerBytes: 500, maxItems: 2, maxOptions: 3,
        }, target => target === agent && !revoked ? receipt : undefined)
        const socketPath = join(f.directory, 'tenant.sock')
        server = new TenantIpcServer(socketPath, f.runtime.config.tenantId, new TenantInteractionHandler(f.runtime, broker, questions))
        await server.listen()
        client = new TenantIpcClient(socketPath, 'ingress', f.runtime.config.tenantId)
        await client.connect()
        let mutations = 0
        f.ctx.tools.register(defineTool({ name: 'mutate', description: 'test mutation',
          parameters: { password: { type: 'string', required: true } },
          presentCall: () => ({ card: 'generic', title: 'Mutate fixture password=sensitive-value' }),
          output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
          execute: () => { mutations++; return Promise.resolve('mutated') },
        }))
        f.ctx.on('tools/pre-execute', (execution, next) => execution.name === 'mutate'
          ? Promise.resolve({ kind: 'ask', reason: 'protected mutation' }) : next())
        agent.session.append('turn/start', { turn: 1 })
        agent.session.append('step/start', { turn: 1, step: 1 })
        const callId = ToolCallId('root-call')
        const name = mode === 'native' ? 'mutate' : RUN_CODE_NAME
        const argumentsText = JSON.stringify(mode === 'native'
          ? { password: 'sensitive-value' } : { code: 'mutate()', description: 'nested test' })
        agent.session.append('assistant/message', { turn: 1, step: 1, stream: [],
          message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' },
            content: [{ type: 'tool-call', id: callId, name, arguments: argumentsText }] }),
        }, { surfaceOp: 'append' })
        agent.session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: argumentsText })
        const controller = new AbortController()
        const work = f.ctx.tools.execute({ callId, name: mode === 'native' ? 'mutate' : RUN_CODE_NAME,
          arguments: mode === 'native' ? { password: 'sensitive-value' } : { code: 'mutate()', description: 'nested test' },
          agent, signal: controller.signal })
        // Contain the expected rejection while observing the pending live request.
        const result = work.then(value => value, (error: unknown) => error)
        await vi.waitFor(() =>{  expect(broker?.list(key, f.operatorId)).toHaveLength(1) })
        const cards = await client.listInteractions(key, f.operatorId)
        expect((await client.listInteractions(key, 'foreign-operator')).approvals).toEqual([])
        const card = cards.approvals[0]
        if (!card) throw new Error('Missing live card')
        expect(card.canAllow).toBe(true)
        expect(card.summary).toBe('Mutate fixture password=[REDACTED]')
        expect(JSON.stringify(card)).not.toContain('sensitive-value')
        const actor = { provider: 'feishu' as const, appId: 'app', tenantId: 'organization', chatId: 'chat', senderId: 'sender' }
        if (decision === 'cancel') controller.abort()
        if (decision === 'revoked') revoked = true
        if (decision === 'storage-failure') {
          const fault = vi.spyOn(actions, 'consume').mockRejectedValueOnce(new Error('disk unavailable'))
          await expect(client.answerInteraction({ deliveryKey: key, operatorId: f.operatorId,
            actionId: card.actionId, actor, response: { kind: 'approval', decision: 'allow' },
          })).rejects.toThrow('disk unavailable')
          fault.mockRestore()
          controller.abort()
          await result
          expect(mutations).toBe(0)
          return
        }
        const { accepted } = await client.answerInteraction({ deliveryKey: key, operatorId: f.operatorId,
          actionId: card.actionId, actor: decision === 'foreign-actor' ? { ...actor, senderId: 'other' } : actor,
          response: { kind: 'approval', decision: decision === 'reject' ? 'reject' : 'allow' },
        })
        expect(accepted).toBe(decision === 'allow' || decision === 'reject')
        if (!accepted) controller.abort()
        await result
        expect(mutations).toBe(decision === 'allow' ? 1 : 0)
        expect((await client.answerInteraction({ deliveryKey: key, operatorId: f.operatorId, actionId: card.actionId, actor, response: { kind: 'approval', decision: 'allow' } })).accepted).toBe(false)
      } finally { await client?.close(); await broker?.close(); await server?.close(); await f.close() }
    })
  })
}
