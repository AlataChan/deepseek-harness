/** Question publication and answers remain authorized by the original project. */
import type {} from '@deepseek-ai/dsh-working-directory-testkit'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { CardConsumers, OwnedCardChannel, parseCardGeneration } from '@deepseek-ai/dsh-experimental-im-feishu/card-channel'
import type { CardChannelBinding, NormalizedFeishuCardAction } from '@deepseek-ai/dsh-experimental-im-feishu/desktop'
import { admissionHarness, ReplyAdapter, SESSION } from './admission-world.ts'
import { publicationSchema } from '../src/feishu/index.ts'

describe('Feishu original-directory identity', () => {
  it.each(['/workspace', '/worktree'])('uses header.cwd for channel workspace %s after execution moves', async (workspace) => {
    const consumers = new CardConsumers()
    const binding: CardChannelBinding = {
      appId: 'app', tenantId: 'tenant', chatId: 'chat', operatorId: 'operator', workspace,
      generation: parseCardGeneration(randomUUID()),
    }
    const send = vi.fn(async () => ({ messageId: 'local-fixture-message' }))
    const owned = new OwnedCardChannel(binding, consumers, send, 100_000)
    const h = await admissionHarness({ feishuEnabled: true }, { persistent: true, model: new ReplyAdapter(), beforeService(ctx, agent) {
      agent.session.append('working-directory/change', { cwd: '/worktree' })
      ctx.provide('desktopIm', { cardChannel: () => owned, registerCardConsumer: consumers.register.bind(consumers) } as never)
    } })
    const q = await h.service.create({ sessionId: SESSION, question: 'Choose a source', choices: ['SQLite', 'Postgres'] })
    await h.service.notifyQuestion(q.decisionId)
    if (workspace === '/worktree') {
      expect(send).not.toHaveBeenCalled()
      expect(await h.service.notification(q.decisionId)).toBeUndefined()
      return
    }
    expect(send).toHaveBeenCalledOnce()
    const publication = publicationSchema.parse(await h.service.notification(q.decisionId))
    const action: NormalizedFeishuCardAction = {
      provider: 'feishu', appId: binding.appId, tenantKey: binding.tenantId, chatId: binding.chatId,
      operatorId: binding.operatorId, openId: binding.operatorId, openMessageId: 'local-fixture-message',
      actionTag: 'button', token: 'local-fixture', actionValue: {
        kind: 'session-question', publicationId: publication.publicationId, decisionId: q.decisionId,
        revision: q.revision, choiceOrdinal: 1,
      },
    }
    expect((await owned.handleCardAction(action)).success).toBe(true)
    expect(h.followup).toHaveBeenCalledOnce()
  })
})
