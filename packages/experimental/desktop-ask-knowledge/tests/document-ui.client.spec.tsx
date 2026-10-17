/** @vitest-environment jsdom */
/**
 * Tests for DocumentStatus, DocumentList, and LibrarySettingsSection (Task 9).
 * @module
 */

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
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
  it('shows the approval ceiling, formatted actual usage and missing-page coverage separately', () => {
    const view = render(<DocumentStatus t={t} item={{ id: 'coverage', filename: 'source.md', originalAvailable: true,
      searchable: true, status: 'completed', estimatedTokens: 786509, budgetApproved: true, tokensUsed: 138360,
      usageKnown: true, chunksWithoutPages: 11, wikiReady: false }} />)
    expect(view.getByText(/786,509/).textContent).toContain('保守估算')
    expect(view.getByText(/138,360/).textContent).toContain('实际用量')
    expect(view.getByText(/11 段未产生知识页/)).toBeTruthy()
    expect(view.queryByText(zh['docs.statusCompleted'])).toBeNull()
    view.rerender(<DocumentStatus t={t} item={{ id: 'legacy-completed', filename: 'old.md', originalAvailable: false,
      searchable: true, status: 'completed' }} />)
    expect(view.getByText(zh['docs.statusWikiIncomplete'])).toBeTruthy()
  })

  it('labels fresh approval correctly and refuses a Resume loop for invalid saved replies', () => {
    const item: DocumentStatusItem = { id: 'fresh', filename: 'source.md', originalAvailable: true,
      searchable: true, status: 'paused', stage: 'awaiting_approval', estimatedTokens: 5000, planHash: 'plan' }
    const view = render(<DocumentStatus t={t} item={item} onApproveBudget={() => {}} />)
    expect(view.getByText(zh['docs.statusAwaitingApproval'])).toBeTruthy()
    expect(view.queryByText(zh['docs.statusPaused'])).toBeNull()
    view.rerender(<DocumentStatus t={t} item={{ ...item, stage: 'paused', budgetApproved: true,
      retryRequired: true, error: 'invalid saved reply' }} onResume={() => {}} onRetry={() => {}} />)
    expect(view.queryByRole('button', { name: zh['docs.resumeExtraction'] })).toBeNull()
    expect(view.getByRole('button', { name: zh['docs.retryStage'] })).toBeTruthy()
  })

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
        wikiReady: true,
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


it('shows a separate migration warning while keeping document controls usable', async () => {
  const approve = vi.fn(async () => {})
  const item: DocumentStatusItem = { id: 'usable', libraryId: 'warning', filename: 'Still usable.md', originalAvailable: true,
    searchable: true, status: 'paused', stage: 'awaiting_approval', estimatedTokens: 1000, planHash: 'plan' }
  const view = render(<LibrarySettingsSection t={t}
    listLibraries={async () => ({ ok: true, value: [{ id: 'warning', displayName: 'Migration warning library' }] })}
    removeLibrary={async () => ({ ok: true })} approveBudget={approve}
    listDocuments={async () => ({ ok: true, value: [item], warning: 'Legacy migration blocked by backup' })} />)
  fireEvent.click(await view.findByRole('button', { name: /Migration warning library/ }))
  expect((await view.findByRole('alert')).textContent).toContain('Legacy migration blocked by backup')
  expect(view.getByRole('alert').textContent).toContain('已登记文档仍可使用')
  expect(view.getByRole('alert').textContent).toContain('本次启动不再自动重试')
  expect(view.getByText('Still usable.md')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: zh['docs.approveBudget'] }))
  await waitFor(() => expect(approve).toHaveBeenCalledWith(item))
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
    invalidSavedReply: { ...base, stage: 'paused', budgetApproved: true, retryRequired: true, error: 'Invalid reply' },
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
      "invalidSavedReply": [
        "打开原始文件",
        "查看提取文本",
        "查看来源",
        "重试失败步骤",
        "取消处理",
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


it('reports a viewer failure and enables another attempt without leaving the button stuck', async () => {
  const viewSources = vi.fn().mockRejectedValueOnce(new Error('VIEWER_UNAVAILABLE_4471')).mockResolvedValue(undefined)
  const view = render(<DocumentStatus item={{ id: 'viewer-failure', filename: 'policy.pdf', originalAvailable: true,
    searchable: true, status: 'completed' }} t={t} onViewSources={viewSources} />)
  const button = view.getByRole('button', { name: zh['docs.viewSources'] })
  fireEvent.click(button)
  expect((await view.findByRole('alert')).textContent).toBe('VIEWER_UNAVAILABLE_4471')
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
  fireEvent.click(button)
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
  expect(viewSources).toHaveBeenCalledTimes(2)
  expect(view.queryByRole('alert')).toBeNull()
})

it('adds several files into the selected library, retains failures, and refreshes counts and documents', async () => {
  const addDocument = vi.fn().mockRejectedValueOnce(new Error('refused file')).mockResolvedValue(undefined)
  const listLibraries = vi.fn().mockResolvedValue({ ok: true, value: [{ id: 'library-a', displayName: 'Training', documentCount: 1 }] })
  const listDocuments = vi.fn().mockResolvedValue({ ok: true, value: [] })
  const view = render(<LibrarySettingsSection t={t} listLibraries={listLibraries}
    listDocuments={listDocuments} removeLibrary={vi.fn()} addDocument={addDocument} />)
  const input = await view.findByLabelText('添加文档: Training')
  const first = new File(['first'], 'first.md')
  const second = new File(['second'], 'second.pdf')
  fireEvent.change(input, { target: { files: [first, second] } })
  await waitFor(() => expect(addDocument).toHaveBeenCalledTimes(2))
  expect(addDocument).toHaveBeenNthCalledWith(1, 'library-a', first)
  expect(addDocument).toHaveBeenNthCalledWith(2, 'library-a', second)
  await waitFor(() => expect(view.getByRole('status').textContent).toContain('已添加 1 份文档'))
  expect(view.getByRole('alert').textContent).toContain('first.md: refused file')
  expect(listLibraries).toHaveBeenCalledTimes(2)
  expect(listDocuments).toHaveBeenCalledWith('library-a')
  expect(view.getByText('Training')).toBeTruthy()
})

it('prevents duplicate upload gestures while an addition is still pending', async () => {
  const wait = Promise.withResolvers<undefined>()
  const addDocument = vi.fn(() => wait.promise)
  const view = render(<LibrarySettingsSection t={t}
    listLibraries={async () => ({ ok: true, value: [{ id: 'a', displayName: 'Training' }] })}
    removeLibrary={vi.fn()} addDocument={addDocument} />)
  const input = await view.findByLabelText('添加文档: Training')
  const file = new File(['text'], 'source.md')
  fireEvent.change(input, { target: { files: [file] } })
  fireEvent.change(input, { target: { files: [file] } })
  expect(addDocument).toHaveBeenCalledTimes(1)
  expect(input.hasAttribute('disabled')).toBe(true)
  expect(view.getByRole('button', { name: zh['settings.remove'] }).hasAttribute('disabled')).toBe(true)
  await act(async () => { wait.resolve(undefined); await wait.promise })
  await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false))
})
