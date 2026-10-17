import { describe, expect, it, vi } from 'vitest'
import { setupAssistantHarness, textResponse } from './harness.ts'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'

async function completed(h: Awaited<ReturnType<typeof setupAssistantHarness>>, text = 'Build a report') {
  await h.controller.prompt({ sessionId:h.lead.id,
    mode:'queue',requestId: `review-${text}` as never,content:[{ type:'text',text }] },new AbortController().signal)
  await h.lead.whenIdle()
  return h.ctx.sessions.get(h.lead.id)!.snapshotEvents().findLast(e=>e.type==='turn/end')!.seq
}

describe('Independent composer acceptance controls',()=>{
  it('rejects whitespace-only declared drafts with zero model calls',async()=>{
    const h=await setupAssistantHarness(undefined,{ enableComposerPredictions:true },{ withCatalog:true })
    try {
      const seq=await completed(h)
      const before=h.adapter.requests.length
      const result=await h.assistants.predictComposer({ sessionId:h.lead.id,asOfSeq:seq,draftText:' ' })
      expect({ result,calls:h.adapter.requests.length-before }).toEqual({ result:null,calls:0 })
    } finally {await h.dispose()}
  })
  it('keeps inference alive for a remaining signal-less subscriber',async()=>{
    const adapter=new MockAdapter([textResponse('Done'),'hang'])
    const h=await setupAssistantHarness(adapter,{ enableComposerPredictions:true },{ withCatalog:true })
    let a:Promise<unknown>|undefined,b:Promise<unknown>|undefined
    try {
      const seq=await completed(h)
      const ctrl=new AbortController()
      a=h.assistants.predictComposer({ sessionId:h.lead.id,asOfSeq:seq,draftText:'' },ctrl.signal)
      await vi.waitFor(()=>expect(adapter.requests.length).toBe(2))
      const subscribed=Promise.withResolvers<undefined>()
      const manager=h.assistants.reviewPredictions
      const original=manager.predictComposer.bind(manager)
      const subscriptionSpy=vi.spyOn(manager,'predictComposer').mockImplementationOnce((...args)=>{
        const promise=original(...args)
        subscribed.resolve(undefined)
        return promise
      })
      b=h.assistants.predictComposer({ sessionId:h.lead.id,asOfSeq:seq,draftText:'' })
      await subscribed.promise
      subscriptionSpy.mockRestore()
      ctrl.abort()
      expect(adapter.requests[1]!.signal!.aborted).toBe(false)
    } finally {
      h.assistants.reviewPredictions.cancelSession(h.lead.id)
      await Promise.allSettled([a,b])
      await h.dispose()
    }
  })
  it('rechecks committed turn after asynchronous observation before dispatch',async()=>{
    const adapter=new MockAdapter([textResponse('First complete'),textResponse('Second complete'),textResponse('Run verification next?')])
    const h=await setupAssistantHarness(adapter,{ enableComposerPredictions:true },{ withCatalog:true })
    const entered=Promise.withResolvers<undefined>(),release=Promise.withResolvers<undefined>()
    let prediction:Promise<unknown>|undefined
    let spy:ReturnType<typeof vi.spyOn>|undefined
    try {
      const seq=await completed(h,'First question')
      const original=h.ctx.sessionQuery.observeSession.bind(h.ctx.sessionQuery)
      spy=vi.spyOn(h.ctx.sessionQuery,'observeSession').mockImplementationOnce(async (...args)=>{
        const old=await original(...args)
        entered.resolve(undefined)
        await release.promise
        return old
      })
      prediction=h.assistants.predictComposer({ sessionId:h.lead.id,asOfSeq:seq,draftText:'' })
      await entered.promise
      await completed(h,'Second question')
      const before=adapter.requests.length
      release.resolve(undefined)
      const result=await prediction
      expect({ result,calls:adapter.requests.length-before }).toEqual({ result:null,calls:0 })
    } finally {
      release.resolve(undefined)
      await prediction
      spy?.mockRestore()
      await h.dispose()
    }
  })
  it('bounds the complete serialized prediction messages, including wrappers',async()=>{
    const h=await setupAssistantHarness(new MockAdapter([textResponse('答'.repeat(2000)),textResponse('Run verification next?')]),{ enableComposerPredictions:true,predictionContextMaxBytes:2048 },{ withCatalog:true })
    try {
      const seq=await completed(h,'中'.repeat(2000))
      const result=await h.assistants.predictComposer({ sessionId:h.lead.id,asOfSeq:seq,draftText:'' })
      expect(result).not.toBeNull()
      const bytes=Buffer.byteLength(JSON.stringify(h.adapter.requests.at(-1)!.messages),'utf8')
      expect(bytes).toBeLessThanOrEqual(2048)
    } finally {await h.dispose()}
  })

})
