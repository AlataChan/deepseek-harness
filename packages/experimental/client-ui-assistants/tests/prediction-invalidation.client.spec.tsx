// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { AssistantPredictionDock, type AssistantPredictionDockProps } from '../src/client/ComposerPrediction.tsx'
import { zh } from '../src/client/locales.ts'
import { ComposerPrediction } from '../src/client/ComposerPrediction.tsx'

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
describe('Astra composition lifecycle probes',()=>{
  it('invalidates a visible suggestion on IME start even before draft text commits',async()=>{
    renderCompleted(props())
    await screen.findByText(result.text)
    const editor=screen.getByLabelText('editor')
    editor.setAttribute('data-composer-composing','')
    fireEvent.compositionStart(editor)
    expect(screen.queryByText(result.text)).toBeNull()
  })
  it('releases pending inference on IME start before draft commit',async()=>{
    const pending=Promise.withResolvers<typeof result|null>()
    const predict=vi.fn((_request:unknown,_signal?:AbortSignal)=>pending.promise)
    const view=renderCompleted(props({ predictComposer:predict }))
    try {
      await waitFor(()=>expect(predict).toHaveBeenCalledOnce())
      const editor=screen.getByLabelText('editor')
      editor.setAttribute('data-composer-composing','')
      fireEvent.compositionStart(editor)
      expect(predict.mock.calls[0]![1]!.aborted).toBe(true)
    } finally {view.unmount();pending.resolve(null)}
  })
  it('rejects a delayed result after composition starts and ends empty',async()=>{
    const pending=Promise.withResolvers<typeof result|null>()
    const predict=vi.fn(()=>pending.promise)
    renderCompleted(props({ predictComposer:predict }))
    await waitFor(()=>expect(predict).toHaveBeenCalledOnce())
    const editor=screen.getByLabelText('editor')
    fireEvent.compositionStart(editor)
    fireEvent.compositionEnd(editor)
    await act(async()=>{pending.resolve(result);await pending.promise})
    expect(screen.queryByText(result.text)).toBeNull()
    expect(predict).toHaveBeenCalledOnce()
  })
  it('does not adopt by pointer while the editor is composing',async()=>{
    const adopt=vi.fn()
    render(<div data-composer-card><div data-composer-input data-composer-composing="" />
      <ComposerPrediction prediction={result} currentSeq={18} onAdopt={adopt} t={makeTranslate(zh)} />
    </div>)
    fireEvent.click(screen.getByRole('button',{ name:zh.predictionAdoptTab }))
    expect(adopt).not.toHaveBeenCalled()
  })
  it('ignores composition in another input',async()=>{
    renderCompleted(props())
    await screen.findByText(result.text)
    const other=document.createElement('input')
    document.body.append(other)
    try {fireEvent.compositionStart(other);expect(screen.queryByText(result.text)).not.toBeNull()}
    finally {other.remove()}
  })
})

function routeProps(predict: NonNullable<AssistantPredictionDockProps['predictComposer']>=vi.fn(async()=>result)) {
  let identity='provider:model-a:high'
  const listeners=new Set<()=>void>()
  const p=Object.assign(props({ predictComposer:predict }),{
    getPredictionRouteIdentity:()=>identity,
    subscribePredictionRoute:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}},
  })
  return { p,predict,change:(next:string)=>act(()=>{identity=next;for(const listener of listeners)listener()}),listeners }
}
describe('Prediction model selection ownership',()=>{
  it('discards a displayed suggestion when model selection changes without repeating inference',async()=>{
    const f=routeProps()
    renderCompleted(f.p)
    await screen.findByText(result.text)
    f.change('provider:model-b:high')
    expect(screen.queryByText(result.text)).toBeNull()
    expect(f.predict).toHaveBeenCalledOnce()
  })
  it('rejects delayed transport results even if the route changes back',async()=>{
    const pending=Promise.withResolvers<typeof result|null>()
    const predict=vi.fn((_request:unknown,_signal?:AbortSignal)=>pending.promise)
    const f=routeProps(predict)
    renderCompleted(f.p)
    await waitFor(()=>expect(predict).toHaveBeenCalledOnce())
    f.change('provider:model-b:high')
    expect(predict.mock.calls[0]![1]!.aborted).toBe(true)
    f.change('provider:model-a:high')
    await act(async()=>{pending.resolve(result);await pending.promise})
    expect(screen.queryByText(result.text)).toBeNull()
    expect(predict).toHaveBeenCalledOnce()
  })
  it('preserves the suggestion for unrelated projection notifications and unsubscribes on unmount',async()=>{
    const f=routeProps()
    const view=renderCompleted(f.p)
    await screen.findByText(result.text)
    f.change('provider:model-a:high')
    expect(screen.queryByText(result.text)).not.toBeNull()
    view.unmount()
    expect(f.listeners.size).toBe(0)
  })
})
