/** Overlay importSample / importSpreadsheet write sqlite + manifest only. */

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { AskDataConnectionRef, type AskDataSourceId } from '@deepseek-ai/dsh-host-ask-data'
import {
  getStoredSource, importSampleSource, importSpreadsheetSource, listAllSources, putStoredSource,
  withManifestLock,
} from '../src/sources.ts'
import { SAMPLE_DISPLAY_NAME } from '../src/limits.ts'
import * as sqliteWrite from '../src/sqlite-write.ts'

describe('overlay sources', () => {
  it('copies the packaged sample without opening a session', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-sample-'))
    const ctx = new Context()
    const preview = await importSampleSource(home)
    expect(preview.source.kind).toBe('sample')
    expect(preview.source.displayName).toBe(SAMPLE_DISPLAY_NAME)
    expect(preview.source.connectionRef).toBeUndefined()
    expect(preview.tables[0]?.columns).toEqual(['日期', '渠道', '商品', '数量', '金额'])
    expect(preview.tables[0]?.rowCount).toBe(20)
    const listed = await listAllSources(ctx, home)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.missing).toBe(false)
  })

  it('imports the sample CSV with zero warnings', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-csv-'))
    const bytes = await readFile(new URL('../samples/sample-sales.csv', import.meta.url))
    const preview = await importSpreadsheetSource(home, 'dir/sample-sales.csv', bytes)
    expect(preview.warnings).toEqual([])
    expect(preview.source.kind).toBe('import')
    expect(preview.source.displayName).toBe('sample-sales.csv')
    expect(preview.source.connectionRef).toBeUndefined()
    expect(preview.tables[0]?.rowCount).toBe(20)
  })

  it('replaces an existing import and keeps connectionRef', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-replace-'))
    const bytes = await readFile(new URL('../samples/sample-sales.csv', import.meta.url))
    const first = await importSpreadsheetSource(home, 'sales.csv', bytes)
    await putStoredSource(home, {
      ...await getStoredSource(home, first.source.id),
      connectionRef: AskDataConnectionRef('ask-data:kept'),
      lastUsedAt: '2026-01-01T00:00:00.000Z',
    })
    await importSpreadsheetSource(home, 'other.csv', bytes)
    const again = await importSpreadsheetSource(home, 'sales.csv', bytes, first.source.id)
    expect(again.source.id).toBe(first.source.id)
    expect(again.source.connectionRef).toBe('ask-data:kept')
    expect(again.source.lastUsedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('rejects replace of a missing source and abort during import', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-miss-'))
    const bytes = await readFile(new URL('../samples/sample-sales.csv', import.meta.url))
    await expect(importSpreadsheetSource(
      home,
      'sales.csv',
      bytes,
      brandString<AskDataSourceId>('missing'),
    )).rejects.toMatchObject({ code: 'source-missing' })
    const ac = new AbortController()
    ac.abort()
    await expect(importSpreadsheetSource(home, 'sales.csv', bytes, undefined, ac.signal))
      .rejects.toThrow()
    await expect(getStoredSource(home, brandString<AskDataSourceId>('missing'))).rejects.toMatchObject({
      code: 'source-missing',
    })
  })

  it('replaces an existing sample and uses the known preview when sqlite3 is absent', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-sample-again-'))
    const first = await importSampleSource(home)
    await putStoredSource(home, {
      ...await getStoredSource(home, first.source.id),
      connectionRef: AskDataConnectionRef('ask-data:sample'),
      lastUsedAt: '2026-02-01T00:00:00.000Z',
    })
    await importSpreadsheetSource(
      home,
      'other.csv',
      await readFile(new URL('../samples/sample-sales.csv', import.meta.url)),
    )
    const again = await importSampleSource(home)
    expect(again.source.id).toBe(first.source.id)
    expect(again.source.connectionRef).toBe('ask-data:sample')
    const find = vi.spyOn(sqliteWrite, 'findSqlite3').mockResolvedValue(undefined)
    const preview = await importSampleSource(home)
    expect(preview.tables[0]?.name).toBe('销售明细')
    find.mockRestore()
  })

  it('fails spreadsheet import when sqlite3 is missing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-no-sqlite-'))
    const find = vi.spyOn(sqliteWrite, 'findSqlite3').mockResolvedValue(undefined)
    const bytes = await readFile(new URL('../samples/sample-sales.csv', import.meta.url))
    await expect(importSpreadsheetSource(home, 'sales.csv', bytes)).rejects.toMatchObject({
      code: 'sqlite3-missing',
    })
    find.mockRestore()
  })

  it('lists unmatched saved connections next to managed rows', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-saved-list-'))
    await importSampleSource(home)
    const ctx = new Context()
    ctx.provide('storageDomain', {
      get: () => ({
        table: (name: string) => name === 'profiles'
          ? {
            entries: () => [['extra', { database: '/b.sqlite', name: 'extra' }]][Symbol.iterator](),
            delete: async () => false,
          }
          : { entries: () => [][Symbol.iterator](), delete: async () => false },
      }),
    })
    const listed = await listAllSources(ctx, home)
    expect(listed.some(row => row.kind === 'saved')).toBe(true)
  })

  it('imports an xlsx and lists a managed row that already has a connectionRef', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-xlsx-'))
    const bytes = await readFile(new URL('../samples/sample-sales.xlsx', import.meta.url))
    const preview = await importSpreadsheetSource(home, 'dir/sales.xlsx', bytes)
    expect(preview.source.displayName).toBe('sales.xlsx')
    await putStoredSource(home, {
      ...await getStoredSource(home, preview.source.id),
      connectionRef: AskDataConnectionRef('ask-data:xlsx'),
    })
    const listed = await listAllSources(new Context(), home)
    expect(listed[0]?.connectionRef).toBe('ask-data:xlsx')
    const other = await importSpreadsheetSource(
      home,
      'other.csv',
      await readFile(new URL('../samples/sample-sales.csv', import.meta.url)),
    )
    await putStoredSource(home, {
      ...await getStoredSource(home, other.source.id),
      displayName: 'other-renamed.csv',
    })
    expect((await getStoredSource(home, other.source.id)).displayName).toBe('other-renamed.csv')
    expect((await getStoredSource(home, preview.source.id)).connectionRef).toBe('ask-data:xlsx')
  })

  it('appends a stored row that is not already in the manifest', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-data-put-'))
    await putStoredSource(home, {
      id: brandString<AskDataSourceId>('src-new'),
      displayName: 'new.csv',
      kind: 'import',
      sqlitePath: 'data.sqlite',
      sourceCopyPath: 'source.csv',
      warnings: [],
    })
    const listed = await listAllSources(new Context(), home)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe('src-new')
  })

  it('recovers the manifest lock after a failed writer', async () => {
    await expect(withManifestLock(async () => {
      throw new Error('writer failed')
    })).rejects.toThrow('writer failed')
    await expect(withManifestLock(async () => 'ok')).resolves.toBe('ok')
  })
})
