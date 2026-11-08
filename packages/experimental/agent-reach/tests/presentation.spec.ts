import { describe, expect, it } from 'vitest'
import { queryPresentationMeta, renderQueryResult } from '../src/presentation.ts'
import type { AgentReachResult } from '../src/types.ts'

describe('Agent-Reach Presentation Logic', () => {
  it('renders successful query result with items, accessScope, and completeness', () => {
    const res: AgentReachResult = {
      ok: true,
      channel: 'youtube',
      action: 'search',
      backend: 'yt-dlp',
      items: [
        {
          title: 'DeepSeek Tutorial',
          url: 'https://youtube.com/watch?v=123',
          author: 'AI Channel',
          publishedAt: '2026-11-01',
          text: 'Introduction to deep learning',
        },
      ],
      meta: { elapsedMs: 150, attempts: ['yt-dlp'] },
      accessScope: 'public',
      completeness: 'complete',
    }

    const text = renderQueryResult(res)
    expect(text).toContain('Agent-Reach [youtube/search] returned 1 item(s) [public, complete]:')
    expect(text).toContain('Title: DeepSeek Tutorial')
    expect(text).toContain('URL: https://youtube.com/watch?v=123')
    expect(text).toContain('Author: AI Channel')

    const meta = queryPresentationMeta(res)
    expect(meta.kind).toBe('query')
    expect(meta.channel).toBe('youtube')
    expect(meta.action).toBe('search')
    expect(meta.backend).toBe('yt-dlp')
    expect(meta.itemCount).toBe(1)
    expect(meta.accessScope).toBe('public')
    expect(meta.completeness).toBe('complete')
  })

  it('renders failed query result with error code and actionable hint', () => {
    const res: AgentReachResult = {
      ok: false,
      channel: 'bilibili',
      action: 'subtitle',
      items: [],
      meta: { elapsedMs: 30, attempts: [] },
      error: {
        code: 'NEED_LOGIN',
        message: 'Bilibili is not logged in',
        hint: 'Please scan the login QR code yourself.',
      },
      accessScope: 'public',
      completeness: 'unknown',
    }

    const text = renderQueryResult(res)
    expect(text).toContain('Agent-Reach [bilibili/subtitle] failed (NEED_LOGIN): Bilibili is not logged in')
    expect(text).toContain('Hint: Please scan the login QR code yourself.')

    const meta = queryPresentationMeta(res)
    expect(meta.kind).toBe('query')
    expect(meta.errorCode).toBe('NEED_LOGIN')
    expect(meta.itemCount).toBe(0)
  })
})

it('renders empty output and missing error details without inventing content',()=>{
  const empty:AgentReachResult={ ok:true,channel:'v2ex',action:'hot',items:[],meta:{ elapsedMs:0,attempts:[] },accessScope:'public',completeness:'unknown' }
  expect(renderQueryResult(empty)).toContain('returned 0 items')
  expect(renderQueryResult({ ...empty,ok:false })).toContain('ERROR')
  expect(renderQueryResult({ ...empty,ok:false,error:{ code:'',message:'' } })).toContain('Unknown failure')
  expect(queryPresentationMeta({ ...empty,truncated:false }).truncated).toBe(false)
})
it('renders bounded partial content alongside a failure and ignores non-item JSON values',()=>{
  const value={ ok:false,channel:'web',action:'read',items:[null,12,{},
    { title:'',url:'',author:'',publishedAt:'',text:'' },{ text:'Public excerpt' }],
  meta:{ elapsedMs:1 },accessScope:'public',completeness:'partial',truncated:true,
  error:{ code:'NEED_LOGIN',message:'Further content requires login' } }
  const text=renderQueryResult(value)
  expect(text).toContain('Available partial content')
  expect(text).toContain('Public excerpt')
  expect(text).toContain('Content was truncated')
  expect(text).not.toContain('Title:')
  expect(queryPresentationMeta(value).truncated).toBe(true)
})
