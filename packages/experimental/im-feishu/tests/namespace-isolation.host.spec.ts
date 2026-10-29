import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalAttachments from '@deepseek-ai/dsh-attachment-local'
import FileUploads from '@deepseek-ai/dsh-client-file-upload'
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import { ApiSessionAgentController } from '@deepseek-ai/dsh-api-session-controller/src/agent.ts'
import { SessionCommandController } from '@deepseek-ai/dsh-api-session-controller/src/commands.ts'
import { installModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/src/model-selection-projection.ts'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/src/types.ts'
import { installSessionReadTestServices } from '../../../api/session-controller/tests/test-remote.ts'
import { mintImSessionRequestId, createImPromptSource } from '../src/source.ts'

async function createHostFixture() {
  const tmpDir = await mkdtemp(join(tmpdir(), 'dsh-im-feishu-host-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try {
      await ctx.fiber.dispose()
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  })

  await mountAgentLoopTestDependencies(ctx)
  const harness = await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(LocalAttachments, { dshHome: tmpDir })
  await ctx.plugin(CommandRuntime)
  installSessionReadTestServices(ctx)
  installModelSelectionProjection(ctx)

  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => dispose },
    contexts: { configureHost: () => dispose },
  } as never)

  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: () => Promise.resolve(),
  } as never)

  ctx.provide('connection', {
    fetch: { register: () => () => {} },
  } as never)

  const uploads = new FileUploads(ctx)

  const agents = new ApiSessionAgentController(ctx)
  const controller = new SessionCommandController(ctx, agents, tmpDir)

  return { ctx, harness, uploads, agents, controller, tmpDir }
}

describe('Host Face: IM SessionRequestId Production Owner Isolation Tests', () => {
  it('1. SessionController duplicate prompt admission: same minted ID twice yields exactly 1 admitted prompt, distinct ID admits new prompt', async () => {
    const { harness, controller, tmpDir } = await createHostFixture()
    const sessionId = SessionId('dedupe-test-session')
    const agent = await harness.create(sessionId, {}, { cwd: tmpDir })

    // Maintenance holds model execution while the production followup still records inbox input.
    const releaseMaintenance = Promise.withResolvers<undefined>()
    onTestFinished(() => {
      releaseMaintenance.resolve(undefined)
    })
    void agent.runMaintenance(() => releaseMaintenance.promise)

    const imRequestId = mintImSessionRequestId()

    // First delivery of IM prompt: should be admitted and queued into inbox.nextTurn
    const res1 = await controller.prompt({
      sessionId,
      requestId: imRequestId,
      content: [{ type: 'text', text: 'First Feishu webhook delivery' }],
      mode: 'queue',
    })
    expect(res1).toEqual({ accepted: true })
    expect(agent.inbox.nextTurn).toHaveLength(1)
    expect(agent.inbox.nextTurn[0]?.source).toMatchObject({ kind: 'user', rpcId: imRequestId })

    // Duplicate delivery with the SAME minted ID (e.g. network retry): must be accepted without creating duplicate turn
    const res2 = await controller.prompt({
      sessionId,
      requestId: imRequestId,
      content: [{ type: 'text', text: 'Duplicate Feishu webhook delivery (retry)' }],
      mode: 'queue',
    })
    expect(res2).toEqual({ accepted: true })
    expect(agent.inbox.nextTurn).toHaveLength(1)

    // Control test: distinct minted ID must be admitted as a new turn
    const imRequestId2 = mintImSessionRequestId()
    const res3 = await controller.prompt({
      sessionId,
      requestId: imRequestId2,
      content: [{ type: 'text', text: 'Second distinct Feishu webhook delivery' }],
      mode: 'queue',
    })
    expect(res3).toEqual({ accepted: true })
    expect(agent.inbox.nextTurn).toHaveLength(2)
    expect(agent.inbox.nextTurn[1]?.source).toMatchObject({ kind: 'user', rpcId: imRequestId2 })
  })

  it('2. Staged upload retirement isolation: IM SessionRequestId does not retire browser upload; matching browser ID does retire it', async () => {
    const { harness, uploads, tmpDir } = await createHostFixture()
    const sessionId = SessionId('upload-isolation-session')
    const agent = await harness.create(sessionId, {}, { cwd: tmpDir })

    // 1. Stage a file upload for the browser
    const staged = await uploads.upload(
      agent,
      { data: Buffer.from('Test File Content').toString('base64'), name: 'spec.txt' },
      new AbortController().signal,
    )
    const receiptId = staged.receiptId
    expect(uploads.resolve(agent, receiptId)).toEqual(staged.file)

    // 2. Bind staged file to an optimistic browser prompt SessionRequestId
    const browserRequestId = brandString<SessionRequestId>('browser-prompt-req-1')
    using binding = uploads.bindPrompt(agent, [receiptId], browserRequestId)
    binding.commit()
    expect(uploads.resolve(agent, receiptId)).toEqual(staged.file)

    // 3. IM message arrives with an independent minted SessionRequestId
    const imRequestId = mintImSessionRequestId()
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Incoming Feishu prompt' }],
      source: createImPromptSource(imRequestId),
    }), { surfaceOp: 'append' })

    // PROOF OF ISOLATION: Staged browser upload remains intact!
    expect(uploads.resolve(agent, receiptId)).toEqual(staged.file)

    // 4. Control test: Matching browser prompt arrives with browserRequestId
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Admitted browser prompt' }],
      source: { kind: 'user', rpcId: browserRequestId },
    }), { surfaceOp: 'append' })

    // PROOF OF MATCHING RETIREMENT: Staged browser upload is now retired!
    expect(uploads.resolve(agent, receiptId)).toBeUndefined()
    expect(() => uploads.bindPrompt(agent, [receiptId], browserRequestId)).toThrow()
  })
})
