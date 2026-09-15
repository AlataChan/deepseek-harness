// @vitest-environment jsdom
/** Commerce change cards: staged lines, export file, ledger counts, and fallbacks to logged text. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { CommerceChangeRow } from '../../src/client/CommerceChangeRow.tsx'
import { en, zh } from '../../src/client/locales.ts'
import { callSummary, commerceCardModel, ledgerCounts } from '../../src/client/models.ts'

type RowProps = Parameters<typeof CommerceChangeRow>[0]
type Block = RowProps['block']
type Settled = Extract<Block, { kind: 'tool-result' }>

const t = makeTranslate(zh, commonZh) as RowProps['t']

afterEach(cleanup)

const PRICE_CHANGE = {
  id: 'chg-0001',
  kind: 'price-change',
  summary: 'Raise tea price',
  items: [{ listingId: 'P-1', field: 'price', before: 10, after: 11 }],
  status: 'staged',
}

function settled(name: string, text: string, meta?: unknown, over: Partial<Settled> = {}): Settled {
  return {
    kind: 'tool-result',
    seq: 4,
    time: 4_000,
    callId: 'call-1',
    call: { name, argsRaw: '{"summary":"Raise tea price"}' },
    callTime: 3_000,
    content: [{ type: 'text', text }],
    isError: false,
    ...(meta === undefined ? {} : { meta }),
    subCalls: [],
    ...over,
  }
}

function running(name: string, argsRaw: string): Block {
  return { callId: 'call-1', name, argsRaw, turn: 1, step: 1, time: 3_000, subCalls: [] }
}

function projection(ledger: readonly { status: string }[] | undefined) {
  return ((_key: string, selector?: (value: unknown) => unknown) => {
    const value = ledger === undefined ? undefined : { ledger }
    return selector === undefined ? value : selector(value)
  }) as RowProps['useProjection']
}

function props(toolName: string, block: Block, over: Partial<RowProps> = {}): RowProps {
  return {
    callId: block.callId,
    toolName,
    block,
    openFile: vi.fn(),
    useProjection: projection([{ status: 'staged' }]),
    t,
    ...over,
  } as unknown as RowProps
}

function expand(): void {
  fireEvent.click(screen.getByRole('button', { expanded: false }))
}

describe('CommerceChangeRow', () => {
  it('summarizes a staged change and expands its before and after lines with the ledger counts', () => {
    const block = settled('commerce_stage_price_change', 'Staged chg-0001: Raise tea price', { listingIds: [], fullListing: false, staged: PRICE_CHANGE })
    const view = render(<CommerceChangeRow {...props('commerce_stage_price_change', block)} />)
    expect(screen.getByText('暂存改动')).toBeTruthy()
    expect(screen.getByText('chg-0001 · 调价 · Raise tea price')).toBeTruthy()
    expand()
    const table = screen.getByRole('table')
    expect([...table.querySelectorAll('td')].map(cell => cell.textContent)).toEqual(['P-1', 'price', '10', '11'])
    expect(screen.getByText('当前账本：待导出 1 · 已导出 0 · 已丢弃 0')).toBeTruthy()
    expect(view.container.querySelector('[data-state="ok"]')).not.toBeNull()
  })

  it('shows promotion dates, empty before values, and campaign-level lines', () => {
    const promotion = settled('commerce_stage_promotion', 'Staged chg-0002', {
      listingIds: [], fullListing: false,
      staged: {
        ...PRICE_CHANGE, id: 'chg-0002', kind: 'promotion', summary: 'Spring tea',
        items: [{ listingId: 'P-1', field: 'promotion_price', before: null, after: 9 }],
        window: { startsOn: '2026-10-01', endsOn: '2026-10-07' },
      },
    })
    render(<CommerceChangeRow {...props('commerce_stage_promotion', promotion)} />)
    expand()
    expect(screen.getByText('（空）')).toBeTruthy()
    expect(screen.getByText('时间：2026-10-01 至 2026-10-07')).toBeTruthy()
    cleanup()

    const campaign = settled('commerce_stage_campaign', 'Staged chg-0003', {
      listingIds: [], fullListing: false,
      staged: {
        ...PRICE_CHANGE, id: 'chg-0003', kind: 'campaign', summary: 'Autumn push',
        items: [{ listingId: null, field: 'budget', before: null, after: 500 }],
        campaign: { name: 'Autumn', listingIds: ['P-1', 'P-2'] },
      },
    })
    render(<CommerceChangeRow {...props('commerce_stage_campaign', campaign)} />)
    expand()
    expect(screen.getByText('整个活动')).toBeTruthy()
    expect(screen.getByText('活动：Autumn（2 个商品）')).toBeTruthy()
  })

  it('names the export file, opens it through the Host, and states that nothing was sent', () => {
    const openFile = vi.fn()
    const block = settled('commerce_export_changes', 'Exported 1 staged change', {
      listingIds: [], fullListing: false, exportedChangeIds: ['chg-0001'], exportPath: 'commerce-exports/0123456789abcdef.csv',
    })
    render(<CommerceChangeRow {...props('commerce_export_changes', block, { openFile, useProjection: projection([{ status: 'exported' }, { status: 'discarded' }]) })} />)
    expect(screen.getByText('导出改动')).toBeTruthy()
    expect(screen.getByText('1 条改动 · commerce-exports/0123456789abcdef.csv')).toBeTruthy()
    expand()
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect(openFile).toHaveBeenCalledWith('commerce-exports/0123456789abcdef.csv')
    expect(screen.getByText('包含改动：chg-0001')).toBeTruthy()
    expect(screen.getByText('没有发送到任何店铺，请商家自行上传这个文件。')).toBeTruthy()
    expect(screen.getByText('当前账本：待导出 0 · 已导出 1 · 已丢弃 1')).toBeTruthy()
  })

  it('summarizes a discard and omits the ledger line while the projection is absent', () => {
    const block = settled('commerce_discard_change', 'Discarded chg-0002.', { listingIds: [], fullListing: false, discardedChangeId: 'chg-0002' })
    render(<CommerceChangeRow {...props('commerce_discard_change', block, { useProjection: projection(undefined) })} />)
    expect(screen.getByText('已丢弃 chg-0002')).toBeTruthy()
    expand()
    expect(screen.getByText('Discarded chg-0002.')).toBeTruthy()
    expect(screen.queryByText(/当前账本/u)).toBeNull()
  })

  it('shows a held result by its first line without the ledger line', () => {
    const block = settled('commerce_export_changes', 'Held by the ledger gate: change ids chg-0404 were not staged in this session.\nUse change ids returned by staging tools.')
    render(<CommerceChangeRow {...props('commerce_export_changes', block)} />)
    expect(screen.getByText('Held by the ledger gate: change ids chg-0404 were not staged in this session.')).toBeTruthy()
    expand()
    expect(screen.queryByText(/当前账本/u)).toBeNull()
  })

  it('falls back to the result text when staged metadata is malformed', () => {
    const block = settled('commerce_stage_price_change', 'Staged chg-0001: Raise tea price', {
      listingIds: [], fullListing: false, staged: { ...PRICE_CHANGE, items: [{ listingId: 'P-1', field: 'price', before: { value: 10 }, after: 11 }] },
    })
    render(<CommerceChangeRow {...props('commerce_stage_price_change', block)} />)
    expect(screen.getByText('Staged chg-0001: Raise tea price')).toBeTruthy()
  })

  it('marks running, failed, and stopped calls through the row state', () => {
    const live = render(<CommerceChangeRow {...props('commerce_stage_restock', running('commerce_stage_restock', '{"summary":"Refill tea"}'))} />)
    expect(live.container.querySelector('[data-state="running"]')).not.toBeNull()
    expect(screen.getByText('Refill tea')).toBeTruthy()
    expect(screen.getByText('正在处理')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    live.unmount()

    const failed = render(<CommerceChangeRow {...props('commerce_stage_restock', settled('commerce_stage_restock', 'Tool crashed\nstack', undefined, { isError: true }))} />)
    expect(failed.container.querySelector('[data-state="error"]')).not.toBeNull()
    expect(screen.getByText('Tool crashed')).toBeTruthy()
    failed.unmount()

    const stopped = render(<CommerceChangeRow {...props('commerce_stage_restock', settled('commerce_stage_restock', '', undefined, {
      content: [], isError: true, error: { name: 'Interrupted', code: 'interrupted' },
    }))} />)
    expect(stopped.container.querySelector('[data-state="stopped"]')).not.toBeNull()
    expect(screen.getByText('已中止')).toBeTruthy()
  })

  it('offers inspection from the expanded body', () => {
    const inspect = vi.fn()
    const block = settled('commerce_discard_change', 'Discarded chg-0002.', { listingIds: [], fullListing: false, discardedChangeId: 'chg-0002' })
    render(<CommerceChangeRow {...props('commerce_discard_change', block, { inspect })} />)
    expand()
    fireEvent.click(screen.getByRole('button', { name: /查看/u }))
    expect(inspect).toHaveBeenCalledOnce()
  })
})

describe('commerce card models', () => {
  it('identifies calls from logged arguments before a result exists', () => {
    expect(callSummary(running('commerce_discard_change', '{"change_id":"chg-0002"}'))).toBe('chg-0002')
    expect(callSummary(running('commerce_export_changes', '{"change_ids":["chg-0001","chg-0002"],"platform":"sample"}'))).toBe('chg-0001, chg-0002')
    expect(callSummary(running('commerce_stage_restock', '{"summary":"Refill\\ntea"}'))).toBe('Refill')
    expect(callSummary(running('commerce_stage_restock', '{"summ'))).toBe('{"summ')
    expect(callSummary(running('commerce_stage_restock', '[]'))).toBe('[]')
    expect(callSummary(running('commerce_stage_restock', ''))).toBe('call-1')
    expect(callSummary(settled('commerce_stage_restock', 'x', undefined, { call: null }))).toBe('call-1')
  })

  it('accepts only complete metadata fields', () => {
    const model = commerceCardModel(settled('commerce_export_changes', 'x', { exportedChangeIds: ['chg-1', 2], exportPath: 7, discardedChangeId: null }))
    expect(model).toMatchObject({ staged: null, exportedChangeIds: null, exportPath: null, discardedChangeId: null })
    expect(commerceCardModel(settled('commerce_stage_campaign', 'x', {
      staged: { ...PRICE_CHANGE, kind: 'bundle' },
    })).staged).toBeNull()
    expect(commerceCardModel(settled('commerce_stage_campaign', 'x', {
      staged: { ...PRICE_CHANGE, window: { startsOn: 1 }, campaign: { name: 'A', listingIds: [1] } },
    })).staged).toMatchObject({ window: null, campaign: null })
    expect(commerceCardModel(settled('commerce_stage_campaign', 'x', ['not', 'a', 'record'])).staged).toBeNull()
    expect(commerceCardModel(settled('commerce_stage_campaign', 'x', { staged: { ...PRICE_CHANGE, items: [7] } })).staged).toBeNull()
    expect(commerceCardModel(settled('x', '', undefined, { content: [{ type: 'image', data: 'AA', mimeType: 'image/png' }] as never })).output)
      .toContain('"type": "image"')
    expect(commerceCardModel(settled('x', '', undefined, { content: [], isError: true, error: { name: 'Boom', code: 'failed' } })).output)
      .toBe('Boom: failed')
    expect(commerceCardModel(settled('x', '', undefined, { content: [] })).output).toBeNull()
  })

  it('counts ledger changes by status', () => {
    expect(ledgerCounts([{ status: 'staged' }, { status: 'exported' }, { status: 'staged' }]))
      .toEqual({ staged: 2, discarded: 0, exported: 1 })
  })

  it('keeps the English dictionary on the Chinese key set', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
