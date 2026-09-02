/** @vitest-environment jsdom */
/** Chip copy, picker leads, create-opens-upload, and chip geometry. */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { AskKnowledgeChip } from '../src/client/AskKnowledgeChip.tsx'
import { encodeAskKnowledgeBytes } from '../src/client/bytes.ts'
import {
  encodeIngestChunks,
  ingestFilenameExtension,
  ingestFilenameStem,
  isDefaultLibraryName,
  MAX_INGEST_CHUNK_BYTES,
  unusedLibraryName,
} from '../src/client/ingest-file.ts'
import { ingestFinishError, LibraryPicker, type LibraryPickerProps } from '../src/client/LibraryPicker.tsx'
import { LibrarySettingsSection } from '../src/client/LibrarySettingsSection.tsx'
import { en, zh } from '../src/client/locales.ts'
const t = (key: keyof typeof zh) => zh[key]

afterEach(() => {
  cleanup()
})

function ingestRemotes() {
  return {
    beginIngest: vi.fn(async () => ({ ok: true as const, value: 'h1' })),
    appendIngestChunk: vi.fn(async () => ({ ok: true as const })),
    finishIngest: vi.fn(async () => ({ ok: true as const, value: { status: 'applied' as const } })),
  }
}

function renderPicker(overrides: Partial<LibraryPickerProps> = {}) {
  const remotes = ingestRemotes()
  const view = render(
    <LibraryPicker
      listLibraries={async () => ({ ok: true, value: [{ id: '1', displayName: '制度 A' }] })}
      createLibrary={async () => ({ ok: true, value: { id: '2', displayName: '新' } })}
      renameLibrary={async () => ({ ok: true })}
      removeLibrary={async () => ({ ok: true })}
      attach={async () => ({ ok: true })}
      close={() => {}}
      t={t}
      {...remotes}
      {...overrides}
    />,
  )
  return { view, remotes }
}

function fileInput(view: ReturnType<typeof render>) {
  return view.container.querySelector('input[type="file"]') as HTMLInputElement
}

async function changeFile(view: ReturnType<typeof render>, file: File | undefined) {
  await waitFor(() => {
    expect(fileInput(view)).toBeTruthy()
  })
  fireEvent.change(fileInput(view), { target: { files: file === undefined ? [] : [file] } })
}

describe('ask-knowledge picker', () => {
  it('keeps English ingest copy next to the Chinese dictionary', () => {
    expect(en['chip.unbound']).toBe('Knowledge')
    expect(en['picker.uploadTitle']).toBe('Upload a local document')
    expect(en['picker.chooseFile']).toBe('Choose a local document')
    expect(en['picker.skipEmpty']).toBe('Skip and ask with an empty library')
    expect(en['error.unsupportedType']).toBe('This file type cannot be ingested. Use .md, .txt, .html, .pdf, .docx, .csv, .json, or .xlsx.')
    expect(en['error.emptyPick']).toBe('The chosen file did not arrive. Choose it again.')
    expect(en['picker.uploadLead']).toContain('Spreadsheets fit ask-data better.')
    expect(en['ingest.converting']).toBe('Converting the document')
    expect(en['ingest.proposing']).toBe('Organizing entries')
    expect(en['ingest.applying']).toBe('Writing the knowledge library. This can take a few minutes.')
    expect(en['ingest.timeout']).toBe('Organizing this document took longer than the wait. Try again.')
    expect(en['ingest.deferred']).toBe('N items were not ingested.')
    expect(en['ingest.failed']).toBe('The document was not written into the knowledge library.')
    expect(en['picker.emptyCreate']).toBe('+ New knowledge library')
    expect(en['picker.addDocument']).toBe('Add document')
    expect(en['picker.remove']).toBe('Delete')
    expect(en['settings.removeFailed']).toBe('Could not remove the library from the list.')
    expect(en['picker.leadThicken']).toBe('Click a name to hang it. Add a document to put more material into that library. Delete removes it from the list.')
    expect(en['picker.leadDataMode']).toContain('data mode')
    expect(zh['picker.leadDataMode']).toContain('数据模式')
    expect(en['picker.create']).toBe('Untitled knowledge library')
    expect(isDefaultLibraryName('未命名知识库', '未命名知识库')).toBe(true)
    expect(isDefaultLibraryName('未命名知识库 4', '未命名知识库')).toBe(true)
    expect(isDefaultLibraryName('新建知识库', '未命名知识库')).toBe(true)
    expect(isDefaultLibraryName('新建知识库 2', '未命名知识库')).toBe(true)
    expect(isDefaultLibraryName('制度 A', '未命名知识库')).toBe(false)
    expect(ingestFinishError({ ok: true, value: { status: 'applied' } }, '失败', '超时')).toBe('失败')
    expect(ingestFinishError({ ok: true, value: { status: 'failed', error: '  ' } }, '失败', '超时')).toBe('失败')
    expect(ingestFinishError({ ok: true, value: { status: 'failed', error: 'sidecar timed out' } }, '失败', '超时')).toBe('超时')
    expect(en['error.terms']).toBe('Use 1 to 6 names, not a full sentence.')
    expect(unusedLibraryName(['未命名知识库'], '未命名知识库')).toBe('未命名知识库 2')
    expect(unusedLibraryName(['制度', '制度 2'], '制度')).toBe('制度 3')
    expect(unusedLibraryName(['制度'], '制度')).toBe('制度 2')
    expect(unusedLibraryName([], '制度')).toBe('制度')
    expect(ingestFilenameStem('制度.md')).toBe('制度')
    expect(ingestFilenameStem('notes')).toBe('notes')
    expect(ingestFilenameStem('.md')).toBe('')
    expect(ingestFilenameExtension('notes.MD')).toBe('.md')
    expect(ingestFilenameExtension('notes')).toBe('')
    expect(encodeIngestChunks(new Uint8Array())).toEqual([encodeAskKnowledgeBytes(new Uint8Array())])
    const wide = new Uint8Array(0x8001)
    wide.fill(65)
    expect(encodeAskKnowledgeBytes(wide).length).toBeGreaterThan(0)
  })

  it('shows 知识库 when unbound and the library name when bound', () => {
    const unbound = render(<AskKnowledgeChip openPicker={() => {}} t={t} />)
    expect(unbound.getByRole('button').textContent).toBe('知识库')
    unbound.unmount()
    const bound = render(<AskKnowledgeChip openPicker={() => {}} boundName="制度 A" t={t} />)
    expect(bound.getByRole('button').textContent).toBe('制度 A')
    bound.unmount()
  })

  it('keeps chip geometry at 28px height and 16px radius', () => {
    const view = render(<AskKnowledgeChip openPicker={() => {}} t={t} />)
    const button = view.getByRole('button')
    expect(button.className).toMatch(/chip/)
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/client/AskKnowledgeChip.module.css'),
      'utf8',
    )
    expect(source).toContain('min-height: 28px')
    expect(source).toContain('border-radius: 16px')
  })

  it('opens on the upload panel when the plus menu asks for a file', () => {
    const { view } = renderPicker({ initialPhase: 'upload' })
    expect(view.getByText('上传本地文档')).toBeTruthy()
    const choose = view.getByText('选择本地文档')
    expect(choose.closest('[data-file-pick="library"]')?.contains(fileInput(view))).toBe(true)
    expect(getComputedStyle(fileInput(view)).display).not.toBe('none')
    expect(fileInput(view).hasAttribute('accept')).toBe(false)
  })

  it('toasts when the upload picker closes without a File', async () => {
    const { view } = renderPicker({ initialPhase: 'upload' })
    fireEvent.change(fileInput(view), { target: { files: [] } })
    await waitFor(() => {
      expect(view.getByText('没有读到所选文件，请再选一次。')).toBeTruthy()
    })
  })

  it('does not toast emptyPick after a File arrives and the input clears', async () => {
    const beginIngest = vi.fn(async () => ({ ok: true as const, value: 'h1' }))
    const { view } = renderPicker({
      initialPhase: 'upload',
      beginIngest,
    })
    await waitFor(() => {
      expect(fileInput(view)).toBeTruthy()
    })
    const input = fileInput(view)
    const file = new File([new Uint8Array([97])], '测试文档.docx')
    fireEvent.input(input, { target: { files: [file] } })
    await Promise.resolve()
    fireEvent.change(input, { target: { files: [] } })
    await waitFor(() => {
      expect(beginIngest).toHaveBeenCalledWith('2', '测试文档.docx')
    })
    expect(view.queryByText('没有读到所选文件，请再选一次。')).toBeNull()
  })

  it('prints the three locked lead sentences', async () => {
    const listLibraries = vi.fn(async () => ({ ok: true as const, value: [{ id: '1', displayName: '制度 A' }] }))
    const { view } = renderPicker({ listLibraries })
    await waitFor(() => {
      expect(view.getByText('问数是这一次问一张表，问完锁在这个会话。')).toBeTruthy()
    })
    expect(view.getByText('知识库是问一套会变厚的材料，换会话还能用。')).toBeTruthy()
    expect(view.getByText('挂上库不是换成另一种助理，默认仍是标准模式，只是多了检索工具。')).toBeTruthy()
    expect(view.getByText('点库名挂到这个会话。点添加文档，往这个库再放一份材料。点删除，从名单去掉。')).toBeTruthy()
    expect(view.getAllByText('制度 A').length).toBeGreaterThan(0)
  })

  it('keeps same-named libraries distinct from the create control', async () => {
    const { view } = renderPicker({
      listLibraries: async () => ({
        ok: true,
        value: [
          { id: 'a', displayName: '新建知识库' },
          { id: 'b', displayName: '新建知识库' },
          { id: 'c', displayName: '新建知识库' },
        ],
      }),
    })
    await waitFor(() => {
      expect(view.getAllByRole('button', { name: '新建知识库' })).toHaveLength(3)
    })
    expect(view.getByRole('button', { name: '+ 新建知识库' })).toBeTruthy()
  })

  it('lists libraries on the settings page and can remove one', async () => {
    const removeLibrary = vi.fn(async () => ({ ok: true as const }))
    const view = render(
      <LibrarySettingsSection
        listLibraries={async () => ({ ok: true, value: [{ id: '1', displayName: '制度 A' }] })}
        removeLibrary={removeLibrary}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('我的知识库')).toBeTruthy()
    })
    view.getByRole('button', { name: '从名单移除' }).click()
    await waitFor(() => {
      expect(removeLibrary).toHaveBeenCalledWith('1')
    })
  })

  it('shows list and attach errors without hanging a created library', async () => {
    const attach = vi.fn(async () => ({ ok: false as const, error: { message: '挂不上' } }))
    const listed = renderPicker({
      listLibraries: async () => ({ ok: false, error: {} }),
      createLibrary: async () => ({ ok: false, error: {} }),
      attach,
    })
    await waitFor(() => {
      expect(listed.view.getByText('还没有 API Key')).toBeTruthy()
    })
    listed.view.unmount()
    const close = vi.fn()
    let resolveList: ((value: { ok: true; value: { id: string; displayName: string }[] }) => void) | undefined
    const hanging = renderPicker({
      listLibraries: () => new Promise((resolve) => { resolveList = resolve }),
      close,
    })
    hanging.view.unmount()
    resolveList?.({ ok: true, value: [{ id: '1', displayName: '迟到' }] })
    const view = renderPicker({ attach, close }).view
    await waitFor(() => {
      expect(view.getByText('制度 A')).toBeTruthy()
    })
    view.getByText('制度 A').click()
    await waitFor(() => {
      expect(view.getByText('挂不上')).toBeTruthy()
    })
    view.getByRole('button', { name: '+ 新建知识库' }).click()
    await waitFor(() => {
      expect(view.getByText('上传本地文档')).toBeTruthy()
      expect(view.getByText('选一份文档写进这个知识库。可以用 .md、.txt、.html、.pdf、.docx、.csv、.json、.xlsx。表格更适合走问数。')).toBeTruthy()
    })
    const choose = view.getByText('选择本地文档')
    expect(choose.closest('[data-file-pick="library"]')?.contains(fileInput(view))).toBe(true)
    expect(attach).not.toHaveBeenCalledWith('2')
    expect(close).not.toHaveBeenCalled()
    view.unmount()
    const createLibrary = vi.fn(async () => ({ ok: false as const, error: { message: '建不了' } }))
    const createFail = renderPicker({
      listLibraries: async () => ({ ok: true, value: [] }),
      createLibrary,
      attach: async () => ({ ok: false }),
    }).view
    await waitFor(() => {
      expect(createFail.getByRole('button', { name: '+ 新建知识库' })).toBeTruthy()
    })
    createFail.getByRole('button', { name: '+ 新建知识库' }).click()
    await waitFor(() => {
      expect(createFail.getByRole('button', { name: '先空着，直接提问' })).toBeTruthy()
    })
    expect(createLibrary).not.toHaveBeenCalled()
    createFail.getByRole('button', { name: '先空着，直接提问' }).click()
    await waitFor(() => {
      expect(createFail.getByText('建不了')).toBeTruthy()
      expect(createFail.getByRole('button', { name: '+ 新建知识库' })).toBeTruthy()
    })
    createFail.unmount()
    const createEmpty = renderPicker({
      createLibrary: async () => ({ ok: true }),
      attach: async () => ({ ok: false }),
    }).view
    await waitFor(() => {
      expect(createEmpty.getByText('制度 A')).toBeTruthy()
    })
    createEmpty.getByRole('button', { name: '+ 新建知识库' }).click()
    await waitFor(() => {
      expect(createEmpty.getByRole('button', { name: '先空着，直接提问' })).toBeTruthy()
    })
    createEmpty.getByRole('button', { name: '先空着，直接提问' }).click()
    await waitFor(() => {
      expect(createEmpty.getByText('还没有 API Key')).toBeTruthy()
    })
    createEmpty.getByText('制度 A').click()
    await waitFor(() => {
      expect(createEmpty.getByText('先在上方挂上一个知识库。')).toBeTruthy()
    })
  })

  it('opens the file dialog on create and hangs only after ingest', async () => {
    const close = vi.fn()
    const attach = vi.fn(async () => ({ ok: true as const }))
    const createLibrary = vi.fn(async () => ({ ok: true as const, value: { id: '2', displayName: '未命名知识库' } }))
    const renameLibrary = vi.fn(async () => ({ ok: true as const }))
    let resolveBegin: ((value: { ok: true; value: string }) => void) | undefined
    const beginIngest = vi.fn(() => new Promise<{ ok: true; value: string }>((resolve) => { resolveBegin = resolve }))
    const appendIngestChunk = vi.fn(async () => ({ ok: true as const }))
    const finishIngest = vi.fn(async () => ({ ok: true as const, value: { status: 'applied' as const } }))
    const { view } = renderPicker({
      attach,
      close,
      createLibrary,
      renameLibrary,
      beginIngest,
      appendIngestChunk,
      finishIngest,
    })
    await waitFor(() => {
      expect(view.getByText('制度 A')).toBeTruthy()
    })
    view.getByRole('button', { name: '+ 新建知识库' }).click()
    expect(createLibrary).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(view.getByText('选择本地文档')).toBeTruthy()
    })
    await changeFile(view, undefined)
    expect(beginIngest).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    const body = new Uint8Array(MAX_INGEST_CHUNK_BYTES + 5)
    body.fill(65)
    await changeFile(view, new File([body], '制度.md', { type: 'text/markdown' }))
    await waitFor(() => {
      expect(view.getByText('正在写入知识库，可能需要几分钟。')).toBeTruthy()
      expect(fileInput(view).disabled).toBe(true)
    })
    resolveBegin?.({ ok: true, value: 'h1' })
    await waitFor(() => {
      expect(beginIngest).toHaveBeenCalledWith('2', '制度.md')
      expect(appendIngestChunk).toHaveBeenCalledTimes(2)
      expect(finishIngest).toHaveBeenCalledWith('h1')
      expect(createLibrary).toHaveBeenCalledWith('未命名知识库')
      expect(renameLibrary).toHaveBeenCalledWith('2', '制度')
      expect(attach).toHaveBeenCalledWith('2')
      expect(close).toHaveBeenCalled()
    })
    view.unmount()
    const stemlessRename = vi.fn(async () => ({ ok: true as const }))
    const stemless = renderPicker({
      attach: async () => ({ ok: true }),
      close: () => {},
      renameLibrary: stemlessRename,
    }).view
    await waitFor(() => {
      expect(stemless.getByText('制度 A')).toBeTruthy()
    })
    stemless.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(stemless, new File([new Uint8Array([97])], '.md', { type: 'text/markdown' }))
    await waitFor(() => {
      expect(stemlessRename).toHaveBeenCalledWith('2', '未命名知识库')
    })
  })

  it('maps a desktop finish timeout to the ingest timeout copy', async () => {
    const finishIngest = vi.fn(async () => ({
      ok: false as const,
      error: { message: 'desktop API request session/finishAskKnowledgeIngest timed out' },
    }))
    const { view } = renderPicker({ finishIngest })
    await waitFor(() => {
      expect(view.getByText('制度 A')).toBeTruthy()
    })
    view.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(view, new File([new Uint8Array([97])], '意见.pdf', { type: 'application/pdf' }))
    await waitFor(() => {
      expect(finishIngest).toHaveBeenCalled()
      expect(view.getByText('整理这份文档超过了等待时间。请再试一次。')).toBeTruthy()
    })
  })

  it('waits for create before ingesting a file chosen during the dialog', async () => {
    let resolveCreate: ((value: { ok: true; value: { id: string; displayName: string } }) => void) | undefined
    const createLibrary = vi.fn(() => new Promise<{
      ok: true
      value: { id: string; displayName: string }
    }>((resolve) => {
      resolveCreate = resolve
    }))
    const { view, remotes } = renderPicker({ createLibrary })
    await waitFor(() => {
      expect(view.getByText('制度 A')).toBeTruthy()
    })
    view.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(view, new File([new Uint8Array([97])], 'a.md', { type: 'text/markdown' }))
    await changeFile(view, new File([new Uint8Array([98])], 'b.md', { type: 'text/markdown' }))
    expect(createLibrary).toHaveBeenCalledTimes(1)
    expect(remotes.beginIngest).not.toHaveBeenCalled()
    resolveCreate?.({ ok: true, value: { id: '2', displayName: '新' } })
    await waitFor(() => {
      expect(remotes.beginIngest).toHaveBeenCalledWith('2', 'a.md')
      expect(remotes.beginIngest).toHaveBeenCalledWith('2', 'b.md')
    })
    expect(createLibrary).toHaveBeenCalledTimes(1)
  })

  it('reuses a created draft when skip attach fails then a file is chosen', async () => {
    const createLibrary = vi.fn(async () => ({ ok: true as const, value: { id: '2', displayName: '未命名知识库' } }))
    const attach = vi.fn(async () => ({ ok: false as const, error: { message: '挂不上' } }))
    const { view, remotes } = renderPicker({ createLibrary, attach })
    await waitFor(() => {
      expect(view.getByText('制度 A')).toBeTruthy()
    })
    view.getByRole('button', { name: '+ 新建知识库' }).click()
    await waitFor(() => {
      expect(view.getByRole('button', { name: '先空着，直接提问' })).toBeTruthy()
    })
    view.getByRole('button', { name: '先空着，直接提问' }).click()
    await waitFor(() => {
      expect(view.getByText('挂不上')).toBeTruthy()
    })
    expect(createLibrary).toHaveBeenCalledTimes(1)
    await changeFile(view, new File([new Uint8Array([97])], 'notes.md', { type: 'text/markdown' }))
    await waitFor(() => {
      expect(remotes.beginIngest).toHaveBeenCalledWith('2', 'notes.md')
    })
    expect(createLibrary).toHaveBeenCalledTimes(1)
  })

  it('reopens the file dialog from the upload panel and skips an empty library', async () => {
    const close = vi.fn()
    const attach = vi.fn(async () => ({ ok: true as const }))
    const createLibrary = vi.fn(async () => ({ ok: true as const, value: { id: '2', displayName: '未命名知识库' } }))
    const { view, remotes } = renderPicker({ attach, close, createLibrary })
    await waitFor(() => {
      expect(view.getByText('制度 A')).toBeTruthy()
    })
    view.getByRole('button', { name: '+ 新建知识库' }).click()
    await waitFor(() => {
      expect(view.getByRole('button', { name: '先空着，直接提问' })).toBeTruthy()
    })
    const choose = view.getByText('选择本地文档')
    expect(choose.closest('[data-file-pick="library"]')?.contains(fileInput(view))).toBe(true)
    view.getByRole('button', { name: '先空着，直接提问' }).click()
    await waitFor(() => {
      expect(createLibrary).toHaveBeenCalledWith('未命名知识库')
      expect(attach).toHaveBeenCalledWith('2')
      expect(close).toHaveBeenCalled()
      expect(remotes.beginIngest).not.toHaveBeenCalled()
    })
    view.unmount()
    const skipAttach = vi.fn(async () => ({ ok: true as const }))
    let resolveCreate: ((value: { ok: false; error: { message: string } }) => void) | undefined
    const skipped = renderPicker({
      attach: skipAttach,
      createLibrary: () => new Promise((resolve) => { resolveCreate = resolve }),
    }).view
    await waitFor(() => {
      expect(skipped.getByText('制度 A')).toBeTruthy()
    })
    skipped.getByRole('button', { name: '+ 新建知识库' }).click()
    await waitFor(() => {
      expect(skipped.getByRole('button', { name: '先空着，直接提问' })).toBeTruthy()
    })
    skipped.getByRole('button', { name: '先空着，直接提问' }).click()
    resolveCreate?.({ ok: false, error: { message: '建不了' } })
    await waitFor(() => {
      expect(skipped.getByText('建不了')).toBeTruthy()
    })
    expect(skipAttach).not.toHaveBeenCalled()
  })

  it('rejects an unsupported type and surfaces ingest failures without closing', async () => {
    const close = vi.fn()
    const createLibrary = vi.fn(async () => ({ ok: true as const, value: { id: '2', displayName: '未命名知识库' } }))
    const { view, remotes } = renderPicker({
      close,
      createLibrary,
      beginIngest: vi.fn(async () => ({ ok: false as const, error: {} })),
    })
    await waitFor(() => {
      expect(view.getByText('制度 A')).toBeTruthy()
    })
    view.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(view, new File([new Uint8Array([97])], 'notes.pptx'))
    await waitFor(() => {
      expect(view.getByText('这种文件还不能入库。请用 .md、.txt、.html、.pdf、.docx、.csv、.json 或 .xlsx。')).toBeTruthy()
    })
    expect(createLibrary).not.toHaveBeenCalled()
    expect(remotes.beginIngest).not.toHaveBeenCalled()
    view.unmount()
    const beginNamed = renderPicker({
      close,
      beginIngest: async () => ({ ok: false, error: { message: '打不开' } }),
    }).view
    await waitFor(() => {
      expect(beginNamed.getByText('制度 A')).toBeTruthy()
    })
    beginNamed.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(beginNamed, new File([new Uint8Array([97])], 'notes.md'))
    await waitFor(() => {
      expect(beginNamed.getByText('打不开')).toBeTruthy()
    })
    beginNamed.unmount()
    const beginFalse = renderPicker({
      close,
      beginIngest: vi.fn(async () => ({ ok: false as const, error: {} })),
    }).view
    await waitFor(() => {
      expect(beginFalse.getByText('制度 A')).toBeTruthy()
    })
    beginFalse.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(beginFalse, new File([new Uint8Array([97])], 'notes.md'))
    await waitFor(() => {
      expect(beginFalse.getByText('文档没有写进知识库。')).toBeTruthy()
    })
    beginFalse.unmount()
    const beginEmpty = renderPicker({
      close,
      beginIngest: async () => ({ ok: true }),
    }).view
    await waitFor(() => {
      expect(beginEmpty.getByText('制度 A')).toBeTruthy()
    })
    beginEmpty.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(beginEmpty, new File([new Uint8Array([97])], 'notes.md'))
    await waitFor(() => {
      expect(beginEmpty.getByText('文档没有写进知识库。')).toBeTruthy()
    })
    beginEmpty.unmount()
    const appendFail = renderPicker({
      close,
      appendIngestChunk: async () => ({ ok: false, error: { message: '块失败' } }),
    }).view
    await waitFor(() => {
      expect(appendFail.getByText('制度 A')).toBeTruthy()
    })
    appendFail.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(appendFail, new File([new Uint8Array([97])], 'notes.md'))
    await waitFor(() => {
      expect(appendFail.getByText('块失败')).toBeTruthy()
    })
    appendFail.unmount()
    const appendEmpty = renderPicker({
      close,
      appendIngestChunk: async () => ({ ok: false }),
    }).view
    await waitFor(() => {
      expect(appendEmpty.getByText('制度 A')).toBeTruthy()
    })
    appendEmpty.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(appendEmpty, new File([new Uint8Array([97])], 'notes.md'))
    await waitFor(() => {
      expect(appendEmpty.getByText('文档没有写进知识库。')).toBeTruthy()
    })
    appendEmpty.unmount()
    const finishFail = renderPicker({
      close,
      finishIngest: async () => ({ ok: false, error: { message: '写失败' } }),
    }).view
    await waitFor(() => {
      expect(finishFail.getByText('制度 A')).toBeTruthy()
    })
    finishFail.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(finishFail, new File([new Uint8Array([97])], 'notes.md'))
    await waitFor(() => {
      expect(finishFail.getByText('写失败')).toBeTruthy()
    })
    finishFail.unmount()
    const finishEmpty = renderPicker({
      close,
      finishIngest: async () => ({ ok: true }),
    }).view
    await waitFor(() => {
      expect(finishEmpty.getByText('制度 A')).toBeTruthy()
    })
    finishEmpty.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(finishEmpty, new File([new Uint8Array([97])], 'notes.md'))
    await waitFor(() => {
      expect(finishEmpty.getByText('文档没有写进知识库。')).toBeTruthy()
    })
    finishEmpty.unmount()
    const finishStatus = renderPicker({
      close,
      finishIngest: async () => ({ ok: true, value: { status: 'failed' as const } }),
    }).view
    await waitFor(() => {
      expect(finishStatus.getByText('制度 A')).toBeTruthy()
    })
    finishStatus.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(finishStatus, new File([new Uint8Array([97])], 'notes.md'))
    await waitFor(() => {
      expect(finishStatus.getByText('文档没有写进知识库。')).toBeTruthy()
    })
    finishStatus.unmount()
    const finishDetail = renderPicker({
      close,
      finishIngest: async () => ({
        ok: true,
        value: { status: 'failed' as const, error: '模型给出的词条格式不对，请再试一次。' },
      }),
    }).view
    await waitFor(() => {
      expect(finishDetail.getByText('制度 A')).toBeTruthy()
    })
    finishDetail.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(finishDetail, new File([new Uint8Array([97])], 'notes.md'))
    await waitFor(() => {
      expect(finishDetail.getByText('模型给出的词条格式不对，请再试一次。')).toBeTruthy()
    })
    expect(close).not.toHaveBeenCalled()
  })

  it('adds a document to an existing library without creating or renaming', async () => {
    const close = vi.fn()
    const attach = vi.fn(async () => ({ ok: true as const }))
    const createLibrary = vi.fn(async () => ({ ok: true as const, value: { id: '2', displayName: '未命名知识库' } }))
    const renameLibrary = vi.fn(async () => ({ ok: true as const }))
    const { view, remotes } = renderPicker({ attach, close, createLibrary, renameLibrary })
    await waitFor(() => {
      expect(view.getByText('制度 A')).toBeTruthy()
    })
    view.getByRole('button', { name: '添加文档' }).click()
    await waitFor(() => {
      expect(view.getByText('上传本地文档')).toBeTruthy()
    })
    expect(createLibrary).not.toHaveBeenCalled()
    await changeFile(view, new File([new Uint8Array([97])], 'notes.md', { type: 'text/markdown' }))
    await waitFor(() => {
      expect(remotes.beginIngest).toHaveBeenCalledWith('1', 'notes.md')
      expect(attach).toHaveBeenCalledWith('1')
      expect(close).toHaveBeenCalled()
    })
    expect(createLibrary).not.toHaveBeenCalled()
    expect(renameLibrary).not.toHaveBeenCalled()
  })

  it('renames an untitled library after a successful add and hangs skip on that row', async () => {
    const close = vi.fn()
    const attach = vi.fn(async () => ({ ok: true as const }))
    const createLibrary = vi.fn(async () => ({ ok: true as const, value: { id: '9', displayName: '不该建' } }))
    const renameLibrary = vi.fn(async () => ({ ok: true as const }))
    const { view, remotes } = renderPicker({
      attach,
      close,
      createLibrary,
      renameLibrary,
      listLibraries: async () => ({ ok: true, value: [{ id: '4', displayName: '未命名知识库 4' }] }),
    })
    await waitFor(() => {
      expect(view.getByText('未命名知识库 4')).toBeTruthy()
    })
    view.getByRole('button', { name: '添加文档' }).click()
    await changeFile(view, new File([new Uint8Array([97])], '意见.pdf', { type: 'application/pdf' }))
    await waitFor(() => {
      expect(remotes.beginIngest).toHaveBeenCalledWith('4', '意见.pdf')
      expect(renameLibrary).toHaveBeenCalledWith('4', '意见')
      expect(attach).toHaveBeenCalledWith('4')
    })
    expect(createLibrary).not.toHaveBeenCalled()
    view.unmount()
    const skipAttach = vi.fn(async () => ({ ok: true as const }))
    const skipped = renderPicker({
      attach: skipAttach,
      close,
      createLibrary,
      listLibraries: async () => ({ ok: true, value: [{ id: '1', displayName: '制度 A' }] }),
    }).view
    await waitFor(() => {
      expect(skipped.getByText('制度 A')).toBeTruthy()
    })
    skipped.getByRole('button', { name: '添加文档' }).click()
    await waitFor(() => {
      expect(skipped.getByRole('button', { name: '先空着，直接提问' })).toBeTruthy()
    })
    skipped.getByRole('button', { name: '先空着，直接提问' }).click()
    await waitFor(() => {
      expect(skipAttach).toHaveBeenCalledWith('1')
    })
    expect(createLibrary).not.toHaveBeenCalled()
  })

  it('hangs a deferred ingest and ignores a file after create fails', async () => {
    const close = vi.fn()
    const attach = vi.fn(async () => ({ ok: true as const }))
    const { view } = renderPicker({
      attach,
      close,
      finishIngest: async () => ({ ok: true, value: { status: 'deferred' as const, deferredCount: 1 } }),
    })
    await waitFor(() => {
      expect(view.getByText('制度 A')).toBeTruthy()
    })
    view.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(view, new File([new Uint8Array([97])], 'notes.md'))
    await waitFor(() => {
      expect(attach).toHaveBeenCalledWith('2')
      expect(close).toHaveBeenCalled()
    })
    const beginIngest = vi.fn(async () => ({ ok: true as const, value: 'h1' }))
    const failed = renderPicker({
      createLibrary: async () => ({ ok: false, error: { message: '建不了' } }),
      beginIngest,
    }).view
    await waitFor(() => {
      expect(failed.getByText('制度 A')).toBeTruthy()
    })
    failed.getByRole('button', { name: '+ 新建知识库' }).click()
    await changeFile(failed, new File([new Uint8Array([97])], 'notes.md'))
    await waitFor(() => {
      expect(failed.getByText('建不了')).toBeTruthy()
    })
    expect(beginIngest).not.toHaveBeenCalled()
  })

  it('leaves a settings row in place when remove fails and ignores a failed list', async () => {
    const view = render(
      <LibrarySettingsSection
        listLibraries={async () => ({ ok: false })}
        removeLibrary={async () => ({ ok: false })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('我的知识库')).toBeTruthy()
    })
    expect(view.queryByText('制度 A')).toBeNull()
    const populated = render(
      <LibrarySettingsSection
        listLibraries={async () => ({ ok: true, value: [{ id: '1', displayName: '制度 A' }] })}
        removeLibrary={async () => ({ ok: false })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(populated.getByText('制度 A')).toBeTruthy()
    })
    populated.getByRole('button', { name: '从名单移除' }).click()
    await waitFor(() => {
      expect(populated.getByText('制度 A')).toBeTruthy()
      expect(populated.getByText('没能从名单移除。')).toBeTruthy()
    })
    populated.unmount()
    const named = render(
      <LibrarySettingsSection
        listLibraries={async () => ({ ok: true, value: [{ id: '1', displayName: '制度 A' }] })}
        removeLibrary={async () => ({ ok: false, error: { message: '库正忙' } })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(named.getByText('制度 A')).toBeTruthy()
    })
    named.getByRole('button', { name: '从名单移除' }).click()
    await waitFor(() => {
      expect(named.getByText('库正忙')).toBeTruthy()
    })
  })

  it('deletes a picker row without hanging and shows a remove failure', async () => {
    const attach = vi.fn(async () => ({ ok: true as const }))
    const removeLibrary = vi.fn(async () => ({ ok: true as const }))
    const { view } = renderPicker({ attach, removeLibrary })
    await waitFor(() => {
      expect(view.getByText('制度 A')).toBeTruthy()
    })
    view.getByRole('button', { name: '删除' }).click()
    await waitFor(() => {
      expect(removeLibrary).toHaveBeenCalledWith('1')
      expect(view.queryByText('制度 A')).toBeNull()
    })
    expect(attach).not.toHaveBeenCalled()
    view.unmount()
    const failed = renderPicker({
      attach,
      removeLibrary: async () => ({ ok: false }),
    }).view
    await waitFor(() => {
      expect(failed.getByText('制度 A')).toBeTruthy()
    })
    failed.getByRole('button', { name: '删除' }).click()
    await waitFor(() => {
      expect(failed.getByText('制度 A')).toBeTruthy()
      expect(failed.getByText('没能从名单移除。')).toBeTruthy()
    })
    expect(attach).not.toHaveBeenCalled()
    failed.unmount()
    const named = renderPicker({
      attach,
      removeLibrary: async () => ({ ok: false, error: { message: '库正忙' } }),
    }).view
    await waitFor(() => {
      expect(named.getByText('制度 A')).toBeTruthy()
    })
    named.getByRole('button', { name: '删除' }).click()
    await waitFor(() => {
      expect(named.getByText('库正忙')).toBeTruthy()
    })
    expect(attach).not.toHaveBeenCalled()
  })
})
