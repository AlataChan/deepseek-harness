// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { SessionId } from '@deepseek-ai/dsh-session'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { AssistantPredictionDock, ComposerPrediction, type AssistantPredictionDockProps } from '../src/client/ComposerPrediction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const session:SessionSnapshot={ sessionId:SessionId('review-composer'),pendingSubmissions:[],running:false,subagent:null,removed:false,openState:'open',openError:null,hasMore:false,loadingOlder:false,promptError:null,blank:false,lastAgentError:null,promptAttempted:true,awaitingFirstTurn:false }
const result={ predictionId:'review-pred',sessionId:session.sessionId,asOfSeq:18,text:'Run the regression suite next?' }
const t=makeTranslate(zh)
function props(extra:Partial<AssistantPredictionDockProps>={}):AssistantPredictionDockProps {
  return { sessionId:session.sessionId,session,input:{ draft:'',draftRev:7,attachmentIds:[],phase:'plain',occurrences:[],queue:[] },getComposerContext:async()=>({ asOfSeq:18,recentTexts:['Committed history'] }),predictComposer:async()=>result,t,...extra } as AssistantPredictionDockProps
}
function renderCompleted(p: AssistantPredictionDockProps) {
  const view = render(<AssistantPredictionDock {...p} session={{ ...session, running: true }} />)
  view.rerender(<AssistantPredictionDock {...p} />)
  return view
}

describe('Independent mounted composer controls',()=>{
  it('does not infer merely when opening completed history',async()=>{
    const context=vi.fn(async()=>({ asOfSeq:18,recentTexts:['Old history'] }))
    const predict=vi.fn(async()=>result)
    render(<AssistantPredictionDock {...props({ getComposerContext:context,predictComposer:predict })}/> )
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(context).not.toHaveBeenCalled()
    await waitFor(()=>expect(predict).not.toHaveBeenCalled())
  })
  it('captures insertion revision before inference, not at adoption',async()=>{
    const capture=vi.fn(()=>({ start:0,end:0,draftRev:7 }))
    renderCompleted(props({ inputActions:{ captureInsertion:capture,insertText:()=>true } as never }))
    await screen.findByText(result.text)
    expect(capture).toHaveBeenCalledOnce()
  })
  it('does not show a suggestion for whitespace-only input',()=>{
    render(<ComposerPrediction prediction={result} currentSeq={18} draftText=" " onAdopt={()=>{}} t={t}/> )
    expect(screen.queryByText(result.text)).toBeNull()
  })
  it('preserves a current suggestion across an unrelated session snapshot update',async()=>{
    const p=props()
    const view=renderCompleted(p)
    await screen.findByText(result.text)
    view.rerender(<AssistantPredictionDock {...p} session={{ ...session,hasMore:true }}/> )
    await waitFor(()=>expect(screen.queryByText(result.text)).not.toBeNull())
  })
})
