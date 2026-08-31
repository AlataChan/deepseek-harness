/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { DataSourcePage } from '../src/client/DataSourcePage.tsx'
import { AskDataChip } from '../src/client/AskDataChip.tsx'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { zh } from '../src/client/locales.ts'
import { ASK_DATA_RULE_IDS } from '../src/limits.ts'
import { encodeAskDataBytes, readFileBytes } from '../src/client/bytes.ts'
import { PreviewPanel } from '../src/client/PreviewPanel.tsx'

const t = (key: keyof typeof zh): string => zh[key]

afterEach(() => {
  cleanup()
})

describe('DataSourcePage', () => {
  it('shows the sample-first empty state and the upload helper', async () => {
    const view = render(
      <DataSourcePage
        listSources={async () => ({ ok: true, value: [] })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={vi.fn()}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        openSession={vi.fn()}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('先用示例试一次')).toBeTruthy()
    })
    expect(view.getByText('选一份要问的数据')).toBeTruthy()
    const helper = view.getByText(/上传前请确认/)
    expect(helper.textContent).toContain('表头')
    expect(helper.textContent).toContain('.xlsx')
    expect(helper.textContent).toContain('50MB')
    expect(helper.textContent).toContain('20')
    expect(view.container.textContent).not.toMatch(/SQLite/)
    for (const id of ASK_DATA_RULE_IDS) {
      expect(view.container.textContent).toContain(id)
    }
  })

  it('imports the sample and commits from preview', async () => {
    const importSample = vi.fn(async () => ({
      ok: true as const,
      value: {
        source: { id: 'src-s', displayName: '示例：销售明细', kind: 'sample' as const, missing: false, warnings: [] },
        tables: [{ name: '销售明细', rowCount: 20, columns: ['日期', '渠道'] }],
        warnings: [] as string[],
      },
    }))
    const commit = vi.fn(async () => ({ ok: true as const, value: { sessionId: 's-new' } }))
    const onCommitted = vi.fn()
    const view = render(
      <DataSourcePage
        listSources={async () => ({ ok: true, value: [] })}
        importSpreadsheet={vi.fn()}
        importSample={importSample}
        commit={commit}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={onCommitted}
        openSession={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(view.getByText('先用示例试一次'))
    await waitFor(() => {
      expect(view.getByText('开始提问')).toBeTruthy()
    })
    fireEvent.click(view.getByText('开始提问'))
    await waitFor(() => {
      expect(commit).toHaveBeenCalled()
      expect(onCommitted).toHaveBeenCalledWith('s-new')
    })
  })

  it('disables upload when sqlite3 is missing and keeps the sample', async () => {
    const view = render(
      <DataSourcePage
        listSources={async () => ({ ok: true, value: [] })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={vi.fn()}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        openSession={vi.fn()}
        sqlite3Missing
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText(/sqlite3-missing/)).toBeTruthy()
    })
    expect((view.getByText('上传表格') as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByText('先用示例试一次') as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows failure recovery that names the rule and offers the sample', async () => {
    const view = render(
      <DataSourcePage
        listSources={async () => ({ ok: true, value: [] })}
        importSpreadsheet={vi.fn()}
        importSample={async () => ({
          ok: false as const,
          error: new RemoteError('session/ask-data-failed', 'csv-encoding', { code: 'csv-encoding' }),
        })}
        commit={vi.fn()}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        openSession={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(view.getByText('先用示例试一次'))
    await waitFor(() => {
      expect(view.getByText('改用示例')).toBeTruthy()
    })
    expect(view.container.textContent).toContain('csv-encoding')
    for (const id of ASK_DATA_RULE_IDS) {
      expect(view.container.textContent).toContain(id)
    }
  })

  it('lists recent and missing sources and commits the picked row', async () => {
    const commit = vi.fn(async () => ({ ok: true as const, value: { sessionId: 's-pick' } }))
    const onCommitted = vi.fn()
    const view = render(
      <DataSourcePage
        listSources={async () => ({
          ok: true,
          value: [
            { id: 'src-1', displayName: 'sales.csv', kind: 'import', lastUsedAt: '2026-01-02T00:00:00.000Z', missing: false, warnings: [] },
            { id: 'src-miss', displayName: 'gone.csv', kind: 'import', missing: true, warnings: [] },
          ],
        })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={commit}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={onCommitted}
        openSession={vi.fn()}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('最近使用')).toBeTruthy()
      expect(view.getByText(/找不到这份表/)).toBeTruthy()
    })
    for (const button of view.getAllByText('开始提问')) {
      fireEvent.click(button)
    }
    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'src-1' }))
      expect(onCommitted).toHaveBeenCalledWith('s-pick')
    })
  })

  it('opens an advanced session without committing', async () => {
    const createAdvanced = vi.fn(async () => ({ ok: true as const, value: { sessionId: 's-adv' } }))
    const openSession = vi.fn()
    const view = render(
      <DataSourcePage
        listSources={async () => ({ ok: true, value: [] })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={vi.fn()}
        createAdvanced={createAdvanced}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        openSession={openSession}
        workspaceId="ws-1"
        t={t}
      />,
    )
    fireEvent.click(view.getByText('高级连接'))
    await waitFor(() => {
      expect(createAdvanced).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
      expect(openSession).toHaveBeenCalledWith('s-adv')
    })
  })

  it('uploads a file and commits with the blank session and workspace', async () => {
    const importSpreadsheet = vi.fn(async () => ({
      ok: true as const,
      value: {
        source: { id: 'src-up', displayName: 'a.csv', kind: 'import' as const, missing: false, warnings: [] },
        tables: [{ name: 'sheet', rowCount: 1, columns: ['a'] }],
        warnings: [] as string[],
      },
    }))
    const commit = vi.fn(async () => ({ ok: true as const, value: { sessionId: 's-up' } }))
    const onCommitted = vi.fn()
    const view = render(
      <DataSourcePage
        listSources={async () => ({ ok: true, value: [] })}
        importSpreadsheet={importSpreadsheet}
        importSample={vi.fn()}
        commit={commit}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={onCommitted}
        openSession={vi.fn()}
        currentBlankSessionId="s-blank"
        workspaceId="ws-1"
        t={t}
      />,
    )
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([97])], 'a.csv', { type: 'text/csv' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect(importSpreadsheet).toHaveBeenCalled()
    })
    fireEvent.click(view.getByText('开始提问'))
    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith({
        sourceId: 'src-up',
        sessionId: 's-blank',
        workspaceId: 'ws-1',
      })
      expect(onCommitted).toHaveBeenCalledWith('s-up')
    })
  })

  it('ignores an empty file change and recovers from a failed commit', async () => {
    const view = render(
      <DataSourcePage
        listSources={async () => ({ ok: true, value: [] })}
        importSpreadsheet={vi.fn()}
        importSample={async () => ({
          ok: true as const,
          value: {
            source: { id: 'src-s', displayName: '示例：销售明细', kind: 'sample' as const, missing: false, warnings: [] },
            tables: [{ name: '销售明细', rowCount: 1, columns: ['日期'] }],
            warnings: [] as string[],
          },
        })}
        commit={async () => ({
          ok: false as const,
          error: new RemoteError('session/ask-data-failed', 'bind-failed', { code: 'bind-failed' }),
        })}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        openSession={vi.fn()}
        t={t}
      />,
    )
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [] } })
    fireEvent.click(view.getByText('先用示例试一次'))
    await waitFor(() => {
      expect(view.getByText('开始提问')).toBeTruthy()
    })
    fireEvent.click(view.getByText('开始提问'))
    await waitFor(() => {
      expect(view.getByText(/bind-failed/)).toBeTruthy()
    })
    fireEvent.click(view.getByText('改用示例'))
    await waitFor(() => {
      expect(view.getAllByText('开始提问').length).toBeGreaterThan(0)
    })
  })

  it('imports anyway from a warning preview and reselects a missing source', async () => {
    const importSpreadsheet = vi.fn(async () => ({
      ok: true as const,
      value: {
        source: { id: 'src-1', displayName: 'sales.csv', kind: 'import' as const, missing: false, warnings: [] },
        tables: [{ name: 'sheet', rowCount: 1, columns: ['a'] }],
        warnings: ['merged-cells'] as string[],
      },
    }))
    const commit = vi.fn(async () => ({ ok: true as const, value: { sessionId: 's-w' } }))
    const view = render(
      <DataSourcePage
        listSources={async () => ({
          ok: true,
          value: [
            { id: 'src-1', displayName: 'sales.csv', kind: 'import', lastUsedAt: '2026-01-02T00:00:00.000Z', missing: false, warnings: [] },
            { id: 'src-miss', displayName: 'gone.csv', kind: 'import', lastUsedAt: '2026-01-01T00:00:00.000Z', missing: true, warnings: [] },
          ],
        })}
        importSpreadsheet={importSpreadsheet}
        importSample={vi.fn()}
        commit={commit}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        openSession={vi.fn()}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getAllByText('重新选文件').length).toBeGreaterThan(0)
    })
    for (const button of view.getAllByText('重新选文件')) {
      fireEvent.click(button)
    }
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([97])], 'b.csv', { type: 'text/csv' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect(importSpreadsheet).toHaveBeenCalledWith(expect.objectContaining({
        filename: 'b.csv',
        replaceSourceId: 'src-miss',
      }))
      expect(view.getByText('仍要导入')).toBeTruthy()
    })
    fireEvent.click(view.getByText('仍要导入'))
    await waitFor(() => {
      expect(commit).toHaveBeenCalled()
    })
  })

  it('shows a failed advanced create and unknown warning ids', async () => {
    const view = render(
      <DataSourcePage
        listSources={async (signal) => {
          if (signal?.aborted === true) {
            return { ok: false as const, error: new RemoteError('gateway/cancelled', 'aborted', {}) }
          }
          return { ok: false as const, error: new RemoteError('gateway/internal', 'list failed', {}) }
        }}
        importSpreadsheet={vi.fn()}
        importSample={async () => ({
          ok: true as const,
          value: {
            source: { id: 'src-s', displayName: '示例：销售明细', kind: 'sample' as const, missing: false, warnings: [] },
            tables: [{ name: '销售明细', rowCount: 1, columns: ['日期'] }],
            warnings: ['unknown-warning'] as string[],
          },
        })}
        commit={vi.fn()}
        createAdvanced={async () => ({
          ok: false as const,
          error: new RemoteError('gateway/internal', 'no workspace', {}),
        })}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        openSession={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(view.getByText('高级连接'))
    await waitFor(() => {
      expect(view.getByText(/no workspace/)).toBeTruthy()
    })
    fireEvent.click(view.getByText('先用示例试一次'))
    await waitFor(() => {
      expect(view.getByText('仍要导入')).toBeTruthy()
    })
  })

  it('ignores a listSources result after unmount', async () => {
    let finish!: (value: { ok: true; value: [] }) => void
    const held = new Promise<{ ok: true; value: [] }>((resolve) => { finish = resolve })
    const view = render(
      <DataSourcePage
        listSources={async () => held}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={vi.fn()}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        openSession={vi.fn()}
        t={t}
      />,
    )
    view.unmount()
    finish({ ok: true, value: [] })
    await new Promise((resolve) => { setTimeout(resolve, 20) })
  })

  it('cancels without committing', async () => {
    const cancel = vi.fn(async () => undefined)
    const view = render(
      <DataSourcePage
        listSources={async () => ({ ok: true, value: [] })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={vi.fn()}
        createAdvanced={vi.fn()}
        cancel={cancel}
        onCommitted={vi.fn()}
        openSession={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(view.getByText('上传表格'))
    fireEvent.click(view.getByText('取消'))
    await waitFor(() => {
      expect(cancel).toHaveBeenCalled()
    })
  })
})

describe('AskDataChip', () => {
  it('opens the gate', () => {
    const openGate = vi.fn()
    const view = render(<AskDataChip openGate={openGate} t={t} />)
    fireEvent.click(view.getByText('问数'))
    expect(openGate).toHaveBeenCalled()
  })
})

describe('encodeAskDataBytes', () => {
  it('encodes a known vector as canonical base64', () => {
    expect(encodeAskDataBytes(new Uint8Array([104, 105]))).toBe('aGk=')
  })

  it('chunks a payload larger than 32KiB', () => {
    const bytes = new Uint8Array(0x8000 + 3)
    bytes.set([1, 2, 3], 0x8000)
    expect(encodeAskDataBytes(bytes).length).toBeGreaterThan(0)
  })

  it('reads a File as Uint8Array', async () => {
    const file = new File([new Uint8Array([9, 8, 7])], 'a.csv')
    await expect(readFileBytes(file)).resolves.toEqual(new Uint8Array([9, 8, 7]))
  })
})

describe('PreviewPanel', () => {
  it('renders warning ids and the import-anyway action', () => {
    const onStart = vi.fn()
    const onImportAnyway = vi.fn()
    const view = render(
      <PreviewPanel
        tables={[{ name: 'sheet', rowCount: 1, columns: ['a'] }]}
        warnings={['merged-cells']}
        t={t}
        warningText={id => id}
        onStart={onStart}
        onImportAnyway={onImportAnyway}
      />,
    )
    fireEvent.click(view.getByText('仍要导入'))
    expect(onImportAnyway).toHaveBeenCalled()
  })
})
