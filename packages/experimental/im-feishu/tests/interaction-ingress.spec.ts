/** Real tenant RPC, durable publication journal, current binding and tool side effects. */
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { ToolCallId, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { TenantApprovalBroker } from '../src/approval-broker.ts'
import { ApprovalActionStore, approvalActionDomain } from '../src/approval-actions.ts'
import { TenantQuestionBroker, questionActionDomain } from '../src/question-broker.ts'
import { TenantInteractionHandler } from '../src/interaction-handler.ts'
import { InteractionIngress, publishedInteractionDomain, type VerifiedInteractionCallback } from '../src/interaction-ingress.ts'
import { TenantIpcServer, TenantIpcClient } from '../src/ipc.ts'
import { IngressService } from '../src/ingress.ts'
import { encodeOperatorBindingKey } from '../src/storage.ts'
import { createServiceFixture } from './service-fixture.ts'

const controls = ['allow', 'reject', 'foreign-message', 'foreign-actor', 'revoked', 'ambiguous-publication', 'storage-failure'] as const
const cases = (['approval', 'question'] as const).flatMap(kind => controls.filter(control => kind === 'approval' || control !== 'reject')
  .map(control => ({ kind, control })))
it.skipIf(process.platform === 'win32').each(cases)(
  'routes published $kind through its bound platform identity: $control', async ({ kind, control }) => {
    const f = await createServiceFixture()
    let client: TenantIpcClient | undefined
    let server: TenantIpcServer | undefined
    let interactions: InteractionIngress | undefined
    let ingress: IngressService | undefined
    const abort = new AbortController()
    try {
      await f.ctx.plugin(ApprovalService)
      await f.ctx.plugin(UserQuestions)
      const agent = await f.provider.getOrCreateAgent('conversation', f.operatorId, abort.signal)
      const key = JSON.stringify(['feishu', 'app', 'org', 'chat', 'sender', 'event'])
      const bindingKey = encodeOperatorBindingKey('feishu', 'app', 'org', 'chat', 'sender')
      await f.ingress.putBinding({ bindingKey, operatorId: f.operatorId, targetTenantId: f.runtime.config.tenantId,
        provider: 'feishu', appId: 'app', tenantId: 'org', chatId: 'chat', senderId: 'sender', authorizedAt: new Date().toISOString(), revokedAt: null })
      const delivery = await f.ingress.recordDeliveryReceived({ deliveryKey: key, operatorId: f.operatorId,
        targetTenantId: f.runtime.config.tenantId, prompt: 'fixture' })
      await f.ingress.updateDeliveryStatus(key, 'in_flight', agent.session.id)
      const receipt = await f.receipts.recordAdmitting({ deliveryKey: key, sessionId: agent.session.id,
        operatorId: f.operatorId, requestId: delivery.requestId })
      const owner = (target: typeof agent) => target === agent ? receipt : undefined
      const approvals = new TenantApprovalBroker(f.ctx, { ...f.runtime.config, maxTrackedCalls: 4 },
        new ApprovalActionStore(await f.facility.open(approvalActionDomain), {
          maxRecords: 10, maxPending: 2, timeoutMs: 2000, maxSummaryBytes: 1024,
        }), owner)
      const questions = new TenantQuestionBroker(f.ctx, await f.facility.open(questionActionDomain), {
        maxRecords: 10, maxPending: 2, timeoutMs: 2000, maxQuestionBytes: 1000, maxAnswerBytes: 500, maxItems: 2, maxOptions: 2,
      }, owner)
      const socketPath = join(f.directory, 'tenant.sock')
      server = new TenantIpcServer(socketPath, f.runtime.config.tenantId, new TenantInteractionHandler(f.runtime, approvals, questions))
      await server.listen()
      client = new TenantIpcClient(socketPath, 'ingress', f.runtime.config.tenantId)
      await client.connect()
      const connected = client
      ingress = new IngressService({ maxStoredDeliveries: 10, maxPendingAdmissions: 8, maxPromptBytes: 1024,
        maxReplyBytes: 1024, maxEventAgeMs: 1000, maxFutureSkewMs: 100, maxOutboxAttempts: 1 }, f.ingress,
      { getClient: () => Promise.resolve(connected) }, { sendReply: () => Promise.reject(new Error('unused')) })
      const publish = vi.fn(async () => {
        if (control === 'ambiguous-publication') throw new Error('Acknowledgement lost')
        return { messageId: 'actual-platform-card-id' }
      })
      const publicationDomain = await f.facility.open(publishedInteractionDomain)
      interactions = new InteractionIngress(publicationDomain, {
        maxRecords: 10, maxPendingCallbacks: 8, maxCardBytes: 8192, locale: 'en',
      }, f.ingress, ingress, () => Promise.resolve(connected), publish)
      let writes = 0
      f.ctx.tools.register(defineTool({ name: 'mutate', description: 'fixture', parameters: {},
        presentCall: () => ({ card: 'generic', title: 'Change fixture' }),
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
        execute: async () => {
          if (kind === 'question') await f.ctx.userQuestions.ask({ agent, signal: abort.signal,
            questions: [{ id: 'q', question: 'Choose fixture', options: [{ label: 'A' }, { label: 'B' }] }] })
          writes++
          return 'changed'
        },
      }))
      if (kind === 'approval') f.ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'ask', reason: 'protected operation' }))
      agent.session.append('turn/start', { turn: 1 })
      agent.session.append('step/start', { turn: 1, step: 1 })
      const callId = ToolCallId('native-call')
      agent.session.append('assistant/message', { turn: 1, step: 1, stream: [],
        message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' },
          content: [{ type: 'tool-call', id: callId, name: 'mutate', arguments: '{}' }] }),
      }, { surfaceOp: 'append' })
      agent.session.append('tool/call', { turn: 1, step: 1, callId, name: 'mutate', arguments: '{}' })
      const work = f.ctx.tools.execute({ agent, callId, name: 'mutate', arguments: {}, signal: abort.signal })
        .then(value => value, (error: unknown) => error)
      const currentCards = () => kind === 'approval' ? approvals.list(key, f.operatorId) : questions.list(key, f.operatorId)
      await vi.waitFor(() => { expect(currentCards()).toHaveLength(1) })
      const card = currentCards()[0]
      if (!card) throw new Error('Missing pending approval')
      await interactions.pollPending()
      await interactions.pollPending()
      expect(publish).toHaveBeenCalledTimes(1)
      const action: VerifiedInteractionCallback = { provider: 'feishu', appId: 'app', tenantKey: 'org', chatId: 'chat',
        operatorId: control === 'foreign-actor' ? 'other' : 'sender',
        openMessageId: control === 'foreign-message' ? 'other-card' : 'actual-platform-card-id', actionTag: 'button',
        actionValue: kind === 'approval' ? { actionId: card.actionId, kind: 'approval', decision: control === 'reject' ? 'reject' : 'allow' } : {},
        ...(kind === 'question' ? { actionName: `question_${card.actionId}`, formValue: { s0: 'o0', c0: '' } } : {}) }
      if (control === 'revoked') await ingress.revokeBinding(bindingKey)
      if (control === 'storage-failure') {
        const fault = vi.spyOn(publicationDomain.table('cards'), 'update').mockRejectedValueOnce(new Error('card journal unavailable'))
        await expect(interactions.handleCardAction(action)).rejects.toThrow('card journal unavailable')
        fault.mockRestore()
        abort.abort()
        await work
        expect(writes).toBe(0)
        return
      }
      const coordinator = interactions
      const results = await Promise.all(Array.from({ length: 4 }, () => coordinator.handleCardAction(action)))
      expect(results.filter(result => result.success)).toHaveLength(control === 'allow' || control === 'reject' ? 1 : 0)
      if (!results.some(result => result.success)) abort.abort()
      await work
      expect(writes).toBe(control === 'allow' ? 1 : 0)
      expect((await interactions.handleCardAction(action)).success).toBe(false)
    } finally {
      abort.abort()
      await interactions?.close()
      await ingress?.close()
      await client?.close()
      await server?.close()
      await f.close()
    }
  })
