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
        onAdvanced={vi.fn()}
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
    expect(view.getByText('自己的表请先避开这些坑，否则很难分析')).toBeTruthy()
    expect(view.getByText(/第一行只能是列名/)).toBeTruthy()
    expect(view.getByText('下载填写模板')).toBeTruthy()
    expect(view.getByText('连接已有数据库')).toBeTruthy()
    expect(view.getByText(/已经有现成数据库时用这个/)).toBeTruthy()
    expect(view.queryByText('开始提问')).toBeNull()
  })

  it('copies the fill-in template and says so', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const view = render(
      <DataSourcePage
        listSources={async () => ({ ok: true, value: [] })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={vi.fn()}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        onAdvanced={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(view.getByText('下载填写模板'))
    await waitFor(() => {
      expect(view.getByText(/模板已复制/)).toBeTruthy()
    })
    expect(writeText).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('reports a saved template file', async () => {
    vi.stubGlobal('showSaveFilePicker', async () => ({
      createWritable: async () => ({
        write: async () => undefined,
        close: async () => undefined,
      }),
    }))
    const view = render(
      <DataSourcePage
        listSources={async () => ({ ok: true, value: [] })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={vi.fn()}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        onAdvanced={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(view.getByText('下载填写模板'))
    await waitFor(() => {
      expect(view.getByText(/模板已保存/)).toBeTruthy()
    })
    vi.unstubAllGlobals()
  })

  it('shows the template text when the clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: async () => { throw new Error('denied') } },
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => false,
    })
    const view = render(
      <DataSourcePage
        listSources={async () => ({ ok: true, value: [] })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={vi.fn()}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        onAdvanced={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(view.getByText('下载填写模板'))
    await waitFor(() => {
      expect(view.getByText(/请全选并复制/)).toBeTruthy()
    })
    expect(view.getByRole('textbox')).toBeTruthy()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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
        onAdvanced={vi.fn()}
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
        onAdvanced={vi.fn()}
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
        onAdvanced={vi.fn()}
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
        onAdvanced={vi.fn()}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('最近使用')).toBeTruthy()
      expect(view.getByText(/找不到这份表/)).toBeTruthy()
    })
    expect(view.getAllByText('sales.csv')).toHaveLength(1)
    expect(view.getByText('全部数据源')).toBeTruthy()
    expect(view.queryByText('开始提问')).toBeNull()
    fireEvent.click(view.getByText('sales.csv'))
    expect(view.getAllByText('开始提问')).toHaveLength(1)
    fireEvent.click(view.getByText('开始提问'))
    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'src-1' }))
      expect(onCommitted).toHaveBeenCalledWith('s-pick')
    })
  })

  it('starts and reselects from 全部数据源', async () => {
    const commit = vi.fn(async () => ({ ok: true as const, value: { sessionId: 's-rest' } }))
    const onCommitted = vi.fn()
    const view = render(
      <DataSourcePage
        listSources={async () => ({
          ok: true,
          value: [
            { id: 'src-rest', displayName: 'archive.csv', kind: 'import', missing: false, warnings: [] },
            { id: 'src-miss', displayName: 'gone.csv', kind: 'import', missing: true, warnings: [] },
          ],
        })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={commit}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={onCommitted}
        onAdvanced={vi.fn()}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('全部数据源')).toBeTruthy()
    })
    expect(view.queryByText('开始提问')).toBeNull()
    fireEvent.click(view.getByText('archive.csv'))
    fireEvent.click(view.getByText('开始提问'))
    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'src-rest' }))
      expect(onCommitted).toHaveBeenCalledWith('s-rest')
    })
    fireEvent.click(view.getByText('重新选文件'))
  })

  it('does not repeat a recently used source under 全部数据源', async () => {
    const commit = vi.fn(async () => ({ ok: true as const, value: { sessionId: 's-2' } }))
    const onCommitted = vi.fn()
    const view = render(
      <DataSourcePage
        listSources={async () => ({
          ok: true,
          value: [
            {
              id: 'src-s',
              displayName: '示例：销售明细',
              kind: 'sample',
              lastUsedAt: '2026-01-02T00:00:00.000Z',
              missing: false,
              warnings: [],
            },
            { id: 'src-2', displayName: 'other.csv', kind: 'import', missing: false, warnings: [] },
          ],
        })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={commit}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={onCommitted}
        onAdvanced={vi.fn()}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('最近使用')).toBeTruthy()
      expect(view.getByText('全部数据源')).toBeTruthy()
    })
    expect(view.getAllByText('示例：销售明细')).toHaveLength(1)
    expect(view.getAllByText('other.csv')).toHaveLength(1)
    expect(view.queryByText('开始提问')).toBeNull()
    expect(view.getByText(/点名单选一份/)).toBeTruthy()
    fireEvent.click(view.getByText('other.csv'))
    expect(view.getAllByText('开始提问')).toHaveLength(1)
    fireEvent.click(view.getByText('开始提问'))
    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'src-2' }))
      expect(onCommitted).toHaveBeenCalledWith('s-2')
    })
  })

  it('hides 全部数据源 when every listed source is already recent', async () => {
    const view = render(
      <DataSourcePage
        listSources={async () => ({
          ok: true,
          value: [{
            id: 'src-s',
            displayName: '示例：销售明细',
            kind: 'sample',
            lastUsedAt: '2026-01-02T00:00:00.000Z',
            missing: false,
            warnings: [],
          }],
        })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={vi.fn()}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        onAdvanced={vi.fn()}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('最近使用')).toBeTruthy()
    })
    expect(view.queryByText('全部数据源')).toBeNull()
    expect(view.getAllByText('示例：销售明细')).toHaveLength(1)
    expect(view.queryByText('开始提问')).toBeNull()
    fireEvent.click(view.getByText('示例：销售明细'))
    expect(view.getAllByText('开始提问')).toHaveLength(1)
  })

  it('keeps one 开始提问 when preview and the source list name the same sample', async () => {
    const sample = {
      id: 'src-s',
      displayName: '示例：销售明细',
      kind: 'sample' as const,
      lastUsedAt: '2026-01-02T00:00:00.000Z',
      missing: false,
      warnings: [] as string[],
    }
    const view = render(
      <DataSourcePage
        listSources={async () => ({ ok: true, value: [sample] })}
        importSpreadsheet={vi.fn()}
        importSample={async () => ({
          ok: true as const,
          value: {
            source: sample,
            tables: [{ name: '销售明细', rowCount: 20, columns: ['日期'] }],
            warnings: [],
          },
        })}
        commit={vi.fn()}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        onAdvanced={vi.fn()}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('示例：销售明细')).toBeTruthy()
    })
    expect(view.queryByText('开始提问')).toBeNull()
    fireEvent.click(view.getByText('先用示例试一次'))
    await waitFor(() => {
      expect(view.getAllByText('开始提问')).toHaveLength(1)
    })
    expect(view.queryByText('最近使用')).toBeNull()
    expect(view.queryByText('全部数据源')).toBeNull()
  })

  it('reopens the current session when the picked source is already bound', async () => {
    const commit = vi.fn()
    const onCommitted = vi.fn()
    const view = render(
      <DataSourcePage
        listSources={async () => ({
          ok: true,
          value: [{
            id: 'src-s',
            displayName: '示例：销售明细',
            kind: 'sample',
            lastUsedAt: '2026-01-02T00:00:00.000Z',
            missing: false,
            warnings: [],
          }],
        })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={commit}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={onCommitted}
        onAdvanced={vi.fn()}
        currentBound={{ sessionId: 's-bound', sourceId: 'src-s' }}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('示例：销售明细')).toBeTruthy()
    })
    expect(view.queryByText('开始提问')).toBeNull()
    fireEvent.click(view.getByText('示例：销售明细'))
    fireEvent.click(view.getByText('开始提问'))
    await waitFor(() => {
      expect(onCommitted).toHaveBeenCalledWith('s-bound')
    })
    expect(commit).not.toHaveBeenCalled()
  })

  it('commits a different source without the already-bound session id', async () => {
    const commit = vi.fn(async () => ({ ok: true as const, value: { sessionId: 's-new' } }))
    const onCommitted = vi.fn()
    const view = render(
      <DataSourcePage
        listSources={async () => ({
          ok: true,
          value: [
            {
              id: 'src-s',
              displayName: '示例：销售明细',
              kind: 'sample',
              lastUsedAt: '2026-01-02T00:00:00.000Z',
              missing: false,
              warnings: [],
            },
            {
              id: 'src-csv',
              displayName: 'other.csv',
              kind: 'import',
              lastUsedAt: '2026-01-01T00:00:00.000Z',
              missing: false,
              warnings: [],
            },
          ],
        })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={commit}
        createAdvanced={vi.fn()}
        cancel={async () => undefined}
        onCommitted={onCommitted}
        onAdvanced={vi.fn()}
        currentBound={{ sessionId: 's-bound', sourceId: 'src-s' }}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(view.getByText('other.csv')).toBeTruthy()
    })
    expect(view.queryByText('开始提问')).toBeNull()
    fireEvent.click(view.getByText('other.csv'))
    expect(view.getAllByText('开始提问')).toHaveLength(1)
    fireEvent.click(view.getByText('开始提问'))
    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith({ sourceId: 'src-csv' })
      expect(onCommitted).toHaveBeenCalledWith('s-new')
    })
  })

  it('opens an advanced session without committing', async () => {
    const createAdvanced = vi.fn(async () => ({ ok: true as const, value: { sessionId: 's-adv' } }))
    const onAdvanced = vi.fn()
    const view = render(
      <DataSourcePage
        listSources={async () => ({ ok: true, value: [] })}
        importSpreadsheet={vi.fn()}
        importSample={vi.fn()}
        commit={vi.fn()}
        createAdvanced={createAdvanced}
        cancel={async () => undefined}
        onCommitted={vi.fn()}
        onAdvanced={onAdvanced}
        workspaceId="ws-1"
        t={t}
      />,
    )
    fireEvent.click(view.getByText('连接已有数据库'))
    await waitFor(() => {
      expect(createAdvanced).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
      expect(onAdvanced).toHaveBeenCalledWith('s-adv')
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
        onAdvanced={vi.fn()}
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
        onAdvanced={vi.fn()}
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
        onAdvanced={vi.fn()}
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
      expect(view.getByText(/merged-cells/)).toBeTruthy()
      expect(view.getAllByText('开始提问')).toHaveLength(1)
    })
    fireEvent.click(view.getByText('开始提问'))
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
        onAdvanced={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(view.getByText('连接已有数据库'))
    await waitFor(() => {
      expect(view.getByText(/no workspace/)).toBeTruthy()
    })
    fireEvent.click(view.getByText('先用示例试一次'))
    await waitFor(() => {
      expect(view.getByText('开始提问')).toBeTruthy()
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
        onAdvanced={vi.fn()}
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
        onAdvanced={vi.fn()}
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
  it('renders warning ids without a start control', () => {
    const view = render(
      <PreviewPanel
        tables={[{ name: 'sheet', rowCount: 1, columns: ['a'] }]}
        warnings={['merged-cells']}
        t={t}
        warningText={id => id}
      />,
    )
    expect(view.getByText('merged-cells')).toBeTruthy()
    expect(view.queryByText('开始提问')).toBeNull()
  })
})
