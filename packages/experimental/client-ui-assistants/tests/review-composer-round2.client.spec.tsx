// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { AssistantPredictionDock, type AssistantPredictionDockProps } from '../src/client/ComposerPrediction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const session:SessionSnapshot={ sessionId:SessionId('round2-composer'),pendingSubmissions:[],running:false,subagent:null,removed:false,openState:'open',openError:null,hasMore:false,loadingOlder:false,promptError:null,blank:false,lastAgentError:null,promptAttempted:true,awaitingFirstTurn:false }
const result={ predictionId:'round2-pred',sessionId:session.sessionId,asOfSeq:18,text:'Run the regression suite next?' }
function props(extra:Partial<AssistantPredictionDockProps>={}):AssistantPredictionDockProps {
  return { sessionId:session.sessionId,session,input:{ draft:'',draftRev:7,attachmentIds:[],phase:'plain',occurrences:[],queue:[] },getComposerContext:async()=>({ asOfSeq:18,recentTexts:['User: 请继续核验报表结果'] }),predictComposer:async()=>result,t:makeTranslate(zh),...extra }
}
function renderCompleted(p: AssistantPredictionDockProps) {
  const view = render(<div data-composer-card><div contentEditable tabIndex={0} data-composer-input role="textbox" aria-label="editor" /><AssistantPredictionDock {...p} session={{ ...session,running:true }} /></div>)
  view.rerender(<div data-composer-card><div contentEditable tabIndex={0} data-composer-input role="textbox" aria-label="editor" /><AssistantPredictionDock {...p} /></div>)
  return view
}
describe('Round 2 independent composer lifecycle controls',()=>{
  it.each(['请检查文档中的统计结论', 'An ordinary historical discussion',
    'Old history is our new document title'])('does not infer on opening history: %s',async(text)=>{
    const predict=vi.fn(async()=>result)
    render(<AssistantPredictionDock {...props({
      getComposerContext: async () => ({ asOfSeq: 18, recentTexts: [text] }), predictComposer: predict,
    })} />)
    await act(async()=>{await new Promise(resolve => setTimeout(resolve, 0));await Promise.resolve()})
    expect(predict).not.toHaveBeenCalled()
  })
  it('does not resurrect a late response after opt-out',async()=>{
    let enabled=true
    let notify:()=>void=()=>{}
    const pending=Promise.withResolvers<typeof result|null>()
    const predict=vi.fn(()=>pending.promise)
    renderCompleted(props({ isPredictionEnabled: () => enabled,
      subscribePredictionEnabled: (listener) => { notify = listener; return () => {} }, predictComposer: predict }))
    await waitFor(()=>expect(predict).toHaveBeenCalledOnce())
    act(()=>{enabled=false;notify()})
    await act(async()=>{pending.resolve(result);await pending.promise})
    expect(screen.queryByText(result.text)).toBeNull()
  })
  it('aborts its remote subscription immediately when setting is disabled',async()=>{
    let enabled=true
    let notify:()=>void=()=>{}
    const pending=Promise.withResolvers<typeof result|null>()
    const predict=vi.fn((_request:unknown,_signal?:AbortSignal)=>pending.promise)
    const view=renderCompleted(props({ isPredictionEnabled: () => enabled,
      subscribePredictionEnabled: (listener) => { notify = listener; return () => {} }, predictComposer: predict }))
    try {
      await waitFor(()=>expect(predict).toHaveBeenCalledOnce())
      const signal=predict.mock.calls[0]![1]!
      act(()=>{enabled=false;notify()})
      expect(signal.aborted).toBe(true)
    } finally {view.unmount();pending.resolve(null)}
  })
  it('rejects a delayed result across a rapid disable-enable cycle without repeating inference',async()=>{
    let enabled=true
    let notify:()=>void=()=>{}
    const pending=Promise.withResolvers<typeof result|null>()
    const predict=vi.fn(()=>pending.promise)
    renderCompleted(props({ isPredictionEnabled: () => enabled,
      subscribePredictionEnabled: (listener) => { notify = listener; return () => {} }, predictComposer: predict }))
    await waitFor(()=>expect(predict).toHaveBeenCalledOnce())
    act(()=>{enabled=false;notify();enabled=true;notify()})
    await act(async()=>{pending.resolve(result);await pending.promise})
    expect(predict).toHaveBeenCalledOnce()
    expect(screen.queryByText(result.text)).toBeNull()
  })
  it('waits for a staggered completed snapshot before requesting once',async()=>{
    const predict=vi.fn(async()=>result)
    const p=props({ predictComposer:predict })
    const view=render(<AssistantPredictionDock {...p} session={{ ...session,running:true,awaitingFirstTurn:true }} />)
    view.rerender(<AssistantPredictionDock {...p} session={{ ...session,running:false,awaitingFirstTurn:true }} />)
    await act(async()=>{await Promise.resolve()})
    expect(predict).not.toHaveBeenCalled()
    view.rerender(<AssistantPredictionDock {...p} />)
    await waitFor(()=>expect(predict).toHaveBeenCalledOnce())
    view.rerender(<AssistantPredictionDock {...p} session={{ ...session,hasMore:true }} />)
    expect(predict).toHaveBeenCalledOnce()
  })
  it('allows an actual foreground completion whose text contains Old history',async()=>{
    const predict=vi.fn(async()=>result)
    renderCompleted(props({ getComposerContext:async()=>({ asOfSeq:18,recentTexts:['Old history is our new document title'] }),predictComposer:predict }))
    await screen.findByText(result.text)
    expect(predict).toHaveBeenCalledOnce()
  })
  it('keeps the suggestion retryable after insertion refuses its old revision',async()=>{
    const insert=vi.fn(()=>false)
    renderCompleted(props({ inputActions:{ captureInsertion:()=>({ start:0,end:0,draftRev:7 }),insertText:insert } as never }))
    await screen.findByText(result.text)
    fireEvent.click(screen.getByRole('button',{ name:zh.predictionAdoptTab }))
    expect(insert).toHaveBeenCalledOnce()
    expect(screen.queryByText(result.text)).not.toBeNull()
    const editor=screen.getByLabelText('editor')
    editor.focus()
    expect(document.activeElement).toBe(editor)
    fireEvent.keyDown(editor,{ key:'Tab' })
    expect(insert).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(result.text)).not.toBeNull()
  })
})
