// @vitest-environment jsdom
/** Commerce source gate: sample first, per-kind upload, and one start action. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { CommerceChip } from '../../src/client/CommerceChip.tsx'
import { CommercePage, type CommercePageProps } from '../../src/client/CommercePage.tsx'
import { zh } from '../../src/client/locales.ts'

const t: CommercePageProps['t'] = (key, params) => {
  const template = zh[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const SAMPLE = {
  source: { id: 'src-sample', displayName: '示例茶铺', kinds: ['orders', 'products', 'inventory'] },
  tables: [{ kind: 'products', rowCount: 2, columns: ['listing_id'] }],
  warnings: [],
} as const

function page(over: Partial<CommercePageProps> = {}) {
  const props: CommercePageProps = {
    listSources: async () => ({ ok: true, value: [] }),
    listPlatforms: async () => ({ ok: true, value: ['sample', 'taobao'] }),
    importSpreadsheet: vi.fn(async () => ({ ok: true as const, value: SAMPLE })),
    importSample: vi.fn(async () => ({ ok: true as const, value: SAMPLE })),
    commit: vi.fn(async () => ({ ok: true as const, value: { sessionId: 's-commerce' } })),
    cancel: vi.fn(async () => undefined),
    onCommitted: vi.fn(),
    t,
    ...over,
  }
  return { props, view: render(<CommercePage {...props} />) }
}

afterEach(cleanup)

describe('CommercePage', () => {
  it('leads with the sample and keeps 开始提问 disabled until a source exists', async () => {
    const { props } = page()
    await waitFor(() => { expect(screen.getByText('选一份店铺数据')).toBeTruthy() })
    expect(screen.getByText('还没有数据源。')).toBeTruthy()
    const start = screen.getByRole('button', { name: '开始提问' })
    expect(start.hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '先用示例试一次' }))
    await waitFor(() => { expect(screen.getByRole('button', { name: '开始提问' }).hasAttribute('disabled')).toBe(false) })
    expect(props.importSample).toHaveBeenCalledOnce()
    expect(screen.getByText('已导入 示例茶铺：商品 2 行')).toBeTruthy()
    expect(screen.getByText('示例茶铺')).toBeTruthy()
  })

  it('uploads one table with its family and platform, then commits the bound session', async () => {
    const { props } = page({ currentBlankSessionId: 's-blank', workspaceId: 'w-1' })
    await waitFor(() => { expect(screen.getByLabelText('平台')).toBeTruthy() })
    fireEvent.change(screen.getByLabelText('表类型'), { target: { value: 'products' } })
    fireEvent.change(screen.getByLabelText('平台'), { target: { value: 'taobao' } })
    const file = new File(['listing,title\nP-1,Tea\n'], 'products.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('上传导出表'), { target: { files: [file] } })

    await waitFor(() => { expect(props.importSpreadsheet).toHaveBeenCalledOnce() })
    expect(vi.mocked(props.importSpreadsheet).mock.calls[0]?.[0]).toMatchObject({
      filename: 'products.csv', kind: 'products', platform: 'taobao',
    })
    expect(vi.mocked(props.importSpreadsheet).mock.calls[0]?.[0].bytes).toMatch(/^[A-Za-z0-9+/]+=*$/u)

    fireEvent.click(screen.getByRole('button', { name: '开始提问' }))
    await waitFor(() => { expect(props.onCommitted).toHaveBeenCalledWith('s-commerce') })
    expect(props.commit).toHaveBeenCalledWith({
      sourceId: 'src-sample', sessionId: 's-blank', workspaceId: 'w-1',
    })
  })

  it('reports an import failure and a refused commit without leaving the gate', async () => {
    page({
      importSample: vi.fn(async () => ({
        ok: false as const,
        error: new RemoteError('session/commerce-failed', '缺少表头', { code: 'import-invalid' }),
      })),
    })
    await waitFor(() => { expect(screen.getByRole('button', { name: '先用示例试一次' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '先用示例试一次' }))
    await waitFor(() => { expect(screen.getByText('导入失败：缺少表头')).toBeTruthy() })
    expect(screen.getByRole('button', { name: '开始提问' }).hasAttribute('disabled')).toBe(true)

    cleanup()
    const refused = page({
      listSources: async () => ({ ok: true, value: [{ id: 'src-1', displayName: '淘宝导出', kinds: ['orders'] }] }),
      commit: vi.fn(async () => ({
        ok: false as const,
        error: new RemoteError('session/commerce-preset-unavailable', '缺少 commerce preset', { preset: 'commerce' }),
      })),
    })
    await waitFor(() => { expect(screen.getByText('淘宝导出')).toBeTruthy() })
    fireEvent.click(screen.getByText('淘宝导出'))
    fireEvent.click(screen.getByRole('button', { name: '开始提问' }))
    await waitFor(() => { expect(screen.getByText('无法开始：缺少 commerce preset')).toBeTruthy() })
    expect(refused.props.onCommitted).not.toHaveBeenCalled()
  })

  it('cancels back to the composer', async () => {
    const { props } = page()
    await waitFor(() => { expect(screen.getByRole('button', { name: '取消' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(props.cancel).toHaveBeenCalledOnce()
  })
})

describe('CommerceChip', () => {
  it('opens the gate from the hero row', () => {
    const openGate = vi.fn()
    render(<CommerceChip openGate={openGate} t={key => zh[key]} />)
    fireEvent.click(screen.getByRole('button', { name: '电商助手' }))
    expect(openGate).toHaveBeenCalledOnce()
  })
})
