/** @vitest-environment jsdom */
/**
 * Tests for DocumentStatus, DocumentList, and LibrarySettingsSection (Task 9).
 * @module
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentStatus, type DocumentStatusItem } from '../src/client/DocumentStatus.tsx'
import { DocumentList } from '../src/client/DocumentList.tsx'
import { LibrarySettingsSection } from '../src/client/LibrarySettingsSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = (key: keyof typeof zh) => zh[key]

describe('DocumentStatus client component', () => {
  it('requires a separate paid replay decision for an uncertain attempt', () => {
    const item: DocumentStatusItem = { id: 'uncertain', filename: 'policy.pdf', originalAvailable: true,
      searchable: true, status: 'paused', stage: 'uncertain', planHash: 'plan', estimatedTokens: 50000, budgetApproved: true }
    const onResume = vi.fn()
    const view = render(<DocumentStatus item={item} t={t} onResume={onResume} />)
    expect(onResume).not.toHaveBeenCalled()
    expect(view.queryByRole('button', { name: zh['docs.resumeExtraction'] })).toBeNull()
    expect(view.getByRole('alert').textContent).toContain('可能已消耗额度')
    fireEvent.click(view.getByRole('button', { name: zh['docs.replayUncertain'] }))
    expect(onResume).toHaveBeenCalledExactlyOnceWith({ ...item, uncertainOutcome: 'replay' })
  })

  it('renders retained original and searchability with extraction progress', () => {
    const item: DocumentStatusItem = {
      id: 'doc-1',
      filename: 'guidelines.pdf',
      originalAvailable: true,
      searchable: true,
      status: 'active',
      totalChunks: 24,
      completedChunks: 18,
    }

    const onOpen = vi.fn()
    const onCancel = vi.fn()

    const view = render(
      <DocumentStatus
        item={item}
        t={t}
        onOpenOriginal={onOpen}
        onCancel={onCancel}
      />,
    )

    expect(view.getByText('guidelines.pdf')).toBeTruthy()
    expect(view.getByText('原始文件已保存')).toBeTruthy()
    expect(view.getByText('文本可检索；知识提取 18/24 块')).toBeTruthy()

    const openBtn = view.getByRole('button', { name: '打开原始文件' })
    fireEvent.click(openBtn)
    expect(onOpen).toHaveBeenCalledWith(item)

    const cancelBtn = view.getByRole('button', { name: '取消处理' })
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalledWith(item)
  })

  it('renders original unavailable and OCR warning when page needs OCR', () => {
    const item: DocumentStatusItem = {
      id: 'doc-2',
      filename: 'scanned-notice.pdf',
      originalAvailable: false,
      searchable: true,
      status: 'paused',
      needsOcrPage: 7,
      budgetApproved: true,
    }

    const onResume = vi.fn()

    const view = render(
      <DocumentStatus
        item={item}
        t={t}
        onResume={onResume}
      />,
    )

    expect(view.getByText('原始文件不可用')).toBeTruthy()
    expect(view.getByText('部分文本：第 7 页需要 OCR')).toBeTruthy()
    expect(view.getByText('提取已暂停')).toBeTruthy()

    const resumeBtn = view.getByRole('button', { name: '继续提取' })
    fireEvent.click(resumeBtn)
    expect(onResume).toHaveBeenCalledWith(item)
  })

  it('offers retry and withholds approval for a failed document', () => {
    const item: DocumentStatusItem = {
      id: 'doc-3',
      filename: 'annual-report.docx',
      originalAvailable: true,
      searchable: false,
      status: 'failed',
      estimatedTokens: 12000,
      planHash: 'approved-fixture-plan',
      budgetApproved: false,
    }

    const onRetry = vi.fn()
    const onApprove = vi.fn()

    const view = render(
      <DocumentStatus
        item={item}
        t={t}
        onRetry={onRetry}
        onApproveBudget={onApprove}
      />,
    )

    expect(view.getByText('处理失败')).toBeTruthy()

    const retryBtn = view.getByRole('button', { name: '重试失败步骤' })
    fireEvent.click(retryBtn)
    expect(onRetry).toHaveBeenCalledWith(item)

    expect(view.queryByRole('button', { name: '批准预算' })).toBeNull()
    expect(onApprove).not.toHaveBeenCalled()
  })
})

describe('DocumentList client component', () => {
  it('renders empty message when no documents exist', () => {
    const view = render(<DocumentList items={[]} t={t} />)
    expect(view.getByText('该知识库暂无文档')).toBeTruthy()
  })

  it('renders list of documents when items are present', () => {
    const items: DocumentStatusItem[] = [
      {
        id: 'doc-a',
        filename: 'manual.pdf',
        originalAvailable: true,
        searchable: true,
        status: 'completed',
      },
    ]

    const view = render(<DocumentList items={items} t={t} />)
    expect(view.getByText('manual.pdf')).toBeTruthy()
    expect(view.getByText('提取完成')).toBeTruthy()
  })
})

describe('LibrarySettingsSection with DocumentList expansion', () => {
  it('expands library and fetches documents when listDocuments is provided', async () => {
    const listLibraries = vi.fn().mockResolvedValue({
      ok: true,
      value: [{ id: 'lib-1', displayName: '机构规范库', documentCount: 2 }],
    })
    const removeLibrary = vi.fn().mockResolvedValue({ ok: true })
    const listDocuments = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        {
          id: 'doc-x',
          filename: 'charter.md',
          originalAvailable: true,
          searchable: true,
          status: 'completed',
        },
      ],
    })

    const view = render(
      <LibrarySettingsSection
        listLibraries={listLibraries}
        removeLibrary={removeLibrary}
        listDocuments={listDocuments}
        t={t}
      />,
    )

    expect(await view.findByText('机构规范库')).toBeTruthy()

    // Click toggle button to expand documents
    const toggle = view.getByRole('button', { expanded: false })
    fireEvent.click(toggle)

    expect(listDocuments).toHaveBeenCalledWith('lib-1')
    expect(await view.findByText('charter.md')).toBeTruthy()
  })
})

it('shows incomplete conversion even when a mixed PDF has no wholly scanned page number', () => {
  const item = { id: 'mixed', filename: 'mixed.pdf', originalAvailable: true, searchable: true,
    status: 'paused' as const, conversionStatus: 'partial' }
  const view = render(<DocumentStatus item={item} t={t} />)
  expect(view.getByText('部分文本；原件可能还有未提取内容')).toBeTruthy()
})

it('A15: normal UI flow contains no technical retrieval controls (chunking, FTS, overlap, top-k)', () => {
  const item: DocumentStatusItem = {
    id: 'doc-norm',
    filename: 'handbook.pdf',
    originalAvailable: true,
    searchable: true,
    status: 'completed',
  }
  const view = render(<DocumentStatus item={item} t={t} />)
  const container = view.container.textContent ?? ''
  expect(container).not.toMatch(/chunk|overlap|top-k|fts|bm25/i)
})

it('keeps document loading and request failures distinct from a successfully empty library', async () => {
  const pending = Promise.withResolvers<{ ok: boolean }>()
  const listDocuments = vi.fn(() => pending.promise)
  const view = render(<LibrarySettingsSection
    listLibraries={async () => ({ ok: true, value: [{ id: 'pending', displayName: '待处理知识库' }] })}
    removeLibrary={async () => ({ ok: true })}
    listDocuments={listDocuments}
    t={t}
  />)
  fireEvent.click(await view.findByRole('button', { name: /待处理知识库/ }))
  expect(view.queryByText('该知识库暂无文档')).toBeNull()
  pending.resolve({ ok: false })
  expect(await view.findByRole('alert')).toBeTruthy()
  expect(view.queryByText('该知识库暂无文档')).toBeNull()
})


it('does not offer extracted text before conversion produced any text', () => {
  const view = render(<DocumentStatus item={{ id: 'no-text', filename: 'scan.pdf', originalAvailable: true,
    searchable: false, status: 'failed', stage: 'conversion' }} t={t} onViewText={vi.fn()} />)
  expect(view.queryByRole('button', { name: zh['docs.viewExtracted'] })).toBeNull()
})

it('offers a fresh plan for an approved paused failure while retaining resume', () => {
  const view = render(<DocumentStatus item={{ id: 'paused-error', filename: 'policy.pdf', originalAvailable: true,
    searchable: true, status: 'paused', stage: 'paused', error: 'Model route changed', budgetApproved: true,
    planHash: 'old-plan' }} t={t} onRetry={vi.fn()} onResume={vi.fn()} />)
  expect(view.getByRole('button', { name: zh['docs.retryStage'] })).toBeTruthy()
  expect(view.getByRole('button', { name: zh['docs.resumeExtraction'] })).toBeTruthy()
})

it('prevents repeated approval clicks while allowing cancellation', async () => {
  const pending = Promise.withResolvers<undefined>()
  const approve = vi.fn(() => pending.promise)
  const cancel = vi.fn()
  const view = render(<DocumentStatus item={{ id: 'pending-action', filename: 'policy.pdf', originalAvailable: true,
    searchable: true, status: 'paused', stage: 'awaiting_approval', planHash: 'plan', estimatedTokens: 500 }}
  t={t} onApproveBudget={approve} onCancel={cancel} />)
  const button = view.getByRole('button', { name: zh['docs.approveBudget'] })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(approve).toHaveBeenCalledTimes(1)
  fireEvent.click(view.getByRole('button', { name: zh['docs.cancelProcessing'] }))
  expect(cancel).toHaveBeenCalledTimes(1)
  pending.resolve(undefined)
})


it('keeps a newer document poll when an older request settles last', async () => {
  const old = Promise.withResolvers<{ ok: boolean; value: readonly DocumentStatusItem[] }>()
  const recent = Promise.withResolvers<{ ok: boolean; value: readonly DocumentStatusItem[] }>()
  const listDocuments = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise)
  const view = render(<LibrarySettingsSection t={t}
    listLibraries={async () => ({ ok: true, value: [{ id: 'poll', displayName: '状态轮询' }] })}
    removeLibrary={async () => ({ ok: true })} listDocuments={listDocuments} />)
  const toggle = await view.findByRole('button', { name: /状态轮询/ })
  vi.useFakeTimers()
  fireEvent.click(toggle)
  await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
  const item: DocumentStatusItem = { id: 'poll-doc', filename: 'New completed state', status: 'completed', originalAvailable: true, searchable: true }
  await act(async () => { recent.resolve({ ok: true, value: [item] }) })
  expect(view.getByText('New completed state')).toBeTruthy()
  await act(async () => { old.resolve({ ok: true, value: [{ ...item, filename: 'Stale active state', status: 'active' }] }) })
  expect(view.queryByText('Stale active state')).toBeNull()
  expect(view.getByText('New completed state')).toBeTruthy()
})


it('records document action availability for every processing state', () => {
  const actions = { onOpenOriginal: vi.fn(), onViewText: vi.fn(), onViewSources: vi.fn(), onRetry: vi.fn(),
    onResume: vi.fn(), onCancel: vi.fn(), onApproveBudget: vi.fn() }
  const base: DocumentStatusItem = { id: 'availability', filename: 'policy.pdf', originalAvailable: true,
    searchable: true, status: 'paused', stage: 'awaiting_approval', planHash: 'plan', estimatedTokens: 1000 }
  const states: Record<string, DocumentStatusItem> = {
    conversionFailure: { ...base, status: 'failed', stage: 'conversion', searchable: false, textAvailable: false },
    awaitingApproval: base,
    pausedError: { ...base, stage: 'paused', budgetApproved: true, error: 'Recoverable failure' },
    uncertain: { ...base, stage: 'uncertain', budgetApproved: true },
    running: { ...base, status: 'active', stage: 'running', budgetApproved: true },
    completed: { ...base, status: 'completed', stage: 'completed', budgetApproved: true },
    cancelled: { ...base, status: 'cancelled', stage: 'cancelled' },
  }
  const available = Object.fromEntries(Object.entries(states).map(([state, item]) => {
    const view = render(<DocumentStatus {...actions} item={item} t={t} />)
    const buttons = view.getAllByRole('button').map(button => button.textContent)
    view.unmount()
    return [state, buttons]
  }))
  expect(available).toMatchInlineSnapshot(`
    {
      "awaitingApproval": [
        "打开原始文件",
        "查看提取文本",
        "查看来源",
        "取消处理",
        "批准预算",
      ],
      "cancelled": [
        "打开原始文件",
        "查看提取文本",
        "查看来源",
      ],
      "completed": [
        "打开原始文件",
        "查看提取文本",
        "查看来源",
      ],
      "conversionFailure": [
        "打开原始文件",
        "查看来源",
        "重试失败步骤",
      ],
      "pausedError": [
        "打开原始文件",
        "查看提取文本",
        "查看来源",
        "重试失败步骤",
        "继续提取",
        "取消处理",
      ],
      "running": [
        "打开原始文件",
        "查看提取文本",
        "查看来源",
        "取消处理",
      ],
      "uncertain": [
        "打开原始文件",
        "查看提取文本",
        "查看来源",
        "确认重新调用模型（使用额度）",
        "取消处理",
      ],
    }
  `)
})
