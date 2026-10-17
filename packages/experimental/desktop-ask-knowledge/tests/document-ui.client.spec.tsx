/** @vitest-environment jsdom */
/**
 * Tests for DocumentStatus, DocumentList, and LibrarySettingsSection (Task 9).
 * @module
 */

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentStatus, type DocumentStatusItem } from '../src/client/DocumentStatus.tsx'
import { DocumentList } from '../src/client/DocumentList.tsx'
import { LibrarySettingsSection } from '../src/client/LibrarySettingsSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
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

  it('renders retry button on failure and approve budget button on unapproved budget', () => {
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

    const approveBtn = view.getByRole('button', { name: '批准预算' })
    fireEvent.click(approveBtn)
    expect(onApprove).toHaveBeenCalledWith(item)
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
