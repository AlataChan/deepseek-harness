// @vitest-environment jsdom
import { act } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { useDisclosure } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/use-disclosure.ts'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import * as client from '../src/client/index.ts'

it('renders the registered card through real slots, changes language, and removes it on unload', async () => {
  const runtime = await SlotTestRuntime.create()
  try {
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale',locale)
    runtime.slots.installLocale(locale)
    locale.setLocale('zh')
    const feature = await runtime.mount(client)
    await runtime.declare({ 'tool.call.toolview':{ kind:'keyed',scope:'session' } })
    const id = await runtime.sessions.add({ id:'reach-card' })
    const session = runtime.sessions.retain(id)
    await session.ready
    const args = PartialArguments.fromText('{"channel":"youtube","action":"read","backend":"yt-dlp"}')
    const block: ToolResultNode = { kind:'tool-result',seq:2,time:2,callId:'reach-1',name:'reach_query',args,
      call:{ name:'reach_query',argsRaw:'{}' },callTime:1,content:[{ type:'text',text:'Result' }],isError:false,
      meta:{ channel:'youtube',action:'read',backend:'yt-dlp',accessScope:'public',completeness:'partial',itemCount:1 },subCalls:[] }
    const owner: ToolCallOwnerProps = { phase:'result',block,toolName:'reach_query',callId:'reach-1',
      useDisclosure,openFile:vi.fn(),loadImage:vi.fn(async()=>{throw new Error('No image is expected')}) }
    const view = runtime.renderSlot('tool.call.toolview',owner,{ entryKey:'reach_query',session })
    expect(view.container.textContent).toContain('youtube / read')
    expect(view.container.textContent).toContain('yt-dlp')
    expect(view.container.textContent).not.toContain('undefined')
    const chinese = view.container.textContent
    await act(async()=>{locale.setLocale('en')})
    expect(view.container.textContent).not.toBe(chinese)
    view.update({ ...owner,toolName:'reach_setup',block:{ ...block,isError:true,error:{ name:'MissingRuntime',code:'NEED_SETUP',reason:'Missing' },meta:{ status:'declined' } } },{ entryKey:'reach_setup',session })
    expect(view.container.textContent).toContain('NEED_SETUP')
    expect(view.container.textContent).toContain('Declined')
    view.update({ phase:'preparing',block:{ phase:'preparing',args:new PartialArguments(),name:'reach_query',callId:'reach-1',turn:1,step:1,time:1,subCalls:[] },
      toolName:'reach_query',callId:'reach-1',useDisclosure:owner.useDisclosure,openFile:owner.openFile,loadImage:owner.loadImage },{ entryKey:'reach_query',session })
    expect(view.container.textContent).not.toContain('NEED_SETUP')
    for (const meta of [
      { channel:12,action:12,backend:12,accessScope:'future-scope',completeness:'future-completeness',status:'future-state',errorCode:'EXPLICIT' },
      null,[],true,
    ]) {
      view.update({ ...owner,toolName:'reach_setup',block:{ ...block,isError:true,meta } },
        { entryKey:'reach_query',session })
      expect(view.container.textContent).not.toContain('undefined')
      expect(view.container.textContent).toMatch(/EXPLICIT|ERROR/)
    }
    view.update({ ...owner,toolName:'future-tool',block:{ ...block,meta:{} } },{ entryKey:'reach_query',session })
    expect(view.container.textContent).toContain(client.en['tool.reach_query'])
    view.update({ ...owner,block:{ ...block,args:PartialArguments.EMPTY,meta:{ channel:'v2ex' } } },{ entryKey:'reach_query',session })
    expect(view.container.textContent).toContain('v2ex')
    await feature.dispose()
    expect(view.container.textContent).toBe('')
    session.release()
  } finally { await runtime.dispose() }
})
