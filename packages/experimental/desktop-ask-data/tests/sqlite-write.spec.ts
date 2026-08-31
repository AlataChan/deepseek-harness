/** sqlite3 argv writer and preview reader. */

import { chmod, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findSqlite3, quoteIdent, quoteValue, readSqlitePreview, writeSqliteFile } from '../src/sqlite-write.ts'

const originalPath = process.env.PATH

afterEach(() => {
  process.env.PATH = originalPath
})

async function withPath(dir: string, task: () => Promise<void>): Promise<void> {
  process.env.PATH = dir
  await task()
}

async function isolateFakeSqlite3(
  dir: string,
  sqlite3Body: string,
  task: () => Promise<void>,
): Promise<void> {
  const sqlite3 = join(dir, 'sqlite3')
  await writeFile(join(dir, 'which'), `#!/bin/sh\nif [ "$1" = "sqlite3" ]; then echo "${sqlite3}"; exit 0; fi\nexit 1\n`)
  await chmod(join(dir, 'which'), 0o755)
  await writeFile(sqlite3, sqlite3Body)
  await chmod(sqlite3, 0o755)
  await withPath(dir, task)
}

describe('sqlite-write', () => {
  it('quotes identifiers and values', () => {
    expect(quoteIdent('a"b')).toBe('"a""b"')
    expect(quoteValue("it's")).toBe("'it''s'")
    expect(quoteValue(null)).toBe('NULL')
    expect(quoteValue(Number.NaN)).toBe('NULL')
    expect(quoteValue(Number.POSITIVE_INFINITY)).toBe('NULL')
    expect(quoteValue(3)).toBe('3')
  })

  it('writes a table and reads the preview', async () => {
    const sqlite3 = await findSqlite3()
    if (sqlite3 === undefined) return
    const dir = await mkdtemp(join(tmpdir(), 'ask-data-sqlite-'))
    const path = join(dir, 'data.sqlite')
    await writeSqliteFile(path, [{
      name: '销售明细',
      columns: ['日期', '渠道'],
      rows: [['2026-01-02', "it's"]],
    }])
    const tables = await readSqlitePreview(path)
    expect(tables).toEqual([{ name: '销售明细', rowCount: 1, columns: ['日期', '渠道'] }])
  })

  it('skips the readonly probe when there are no tables', async () => {
    const sqlite3 = await findSqlite3()
    if (sqlite3 === undefined) return
    const dir = await mkdtemp(join(tmpdir(), 'ask-data-sqlite-empty-'))
    const path = join(dir, 'data.sqlite')
    await writeSqliteFile(path, [])
    await expect(readSqlitePreview(path)).resolves.toEqual([])
  })

  it('treats empty which output as sqlite3 missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ask-data-empty-which-'))
    await writeFile(join(dir, 'which'), '#!/bin/sh\nexit 0\n')
    await chmod(join(dir, 'which'), 0o755)
    await withPath(dir, async () => {
      await expect(findSqlite3()).resolves.toBeUndefined()
    })
  })

  it('reports sqlite3 missing when PATH has no sqlite3', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ask-data-no-sqlite-'))
    await withPath(dir, async () => {
      await expect(findSqlite3()).resolves.toBeUndefined()
      await expect(writeSqliteFile(join(dir, 'x.sqlite'), [{
        name: 't', columns: ['c'], rows: [],
      }])).rejects.toMatchObject({ code: 'sqlite3-missing' })
      await expect(readSqlitePreview(join(dir, 'x.sqlite'))).rejects.toMatchObject({
        code: 'sqlite3-missing',
      })
    })
  })

  it('rejects when the sqlite3 on PATH exits non-zero', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'ask-data-sqlite-fail-empty-'))
    await isolateFakeSqlite3(empty, '#!/bin/sh\nexit 1\n', async () => {
      await expect(writeSqliteFile(join(empty, 'y.sqlite'), [{
        name: 't', columns: ['c'], rows: [['1']],
      }])).rejects.toBeDefined()
      await writeFile(join(empty, 'z.sqlite'), '')
      await expect(readSqlitePreview(join(empty, 'z.sqlite'))).rejects.toBeDefined()
    })
    const dir = await mkdtemp(join(tmpdir(), 'ask-data-sqlite-fail-'))
    await isolateFakeSqlite3(dir, '#!/bin/sh\necho boom >&2\nexit 1\n', async () => {
      await expect(writeSqliteFile(join(dir, 'y.sqlite'), [{
        name: 't', columns: ['c'], rows: [['1']],
      }])).rejects.toBeDefined()
      await writeFile(join(dir, 'z.sqlite'), '')
      await expect(readSqlitePreview(join(dir, 'z.sqlite'))).rejects.toBeDefined()
    })
  })

  it('rejects when sqlite3 on PATH cannot be spawned', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ask-data-sqlite-dir-'))
    const sqlite3 = join(dir, 'sqlite3')
    await writeFile(join(dir, 'which'), `#!/bin/sh\necho "${sqlite3}"\n`)
    await chmod(join(dir, 'which'), 0o755)
    await symlink('/no/such/ask-data-sqlite3', sqlite3)
    await withPath(dir, async () => {
      await expect(writeSqliteFile(join(dir, 'x.sqlite'), [{
        name: 't', columns: ['c'], rows: [['1']],
      }])).rejects.toBeDefined()
      await expect(readSqlitePreview(join(dir, 'x.sqlite'))).rejects.toBeDefined()
    })
  })

  it('rejects write and preview when the caller already aborted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ask-data-sqlite-aborted-'))
    await isolateFakeSqlite3(dir, '#!/bin/sh\nexec /bin/sleep 30\n', async () => {
      const ac = new AbortController()
      ac.abort()
      await expect(writeSqliteFile(join(dir, 'x.sqlite'), [{
        name: 't', columns: ['c'], rows: [['1']],
      }], ac.signal)).rejects.toBeDefined()
      await writeFile(join(dir, 'z.sqlite'), '')
      await expect(readSqlitePreview(join(dir, 'z.sqlite'), ac.signal)).rejects.toBeDefined()
    })
  })

  it('kills sqlite3 when the caller aborts write or preview', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ask-data-sqlite-abort-'))
    await isolateFakeSqlite3(dir, '#!/bin/sh\nexec /bin/sleep 30\n', async () => {
      const writeAbort = new AbortController()
      const writePending = writeSqliteFile(join(dir, 'x.sqlite'), [{
        name: 't', columns: ['c'], rows: [['1']],
      }], writeAbort.signal)
      await new Promise((resolve) => { setTimeout(resolve, 200) })
      writeAbort.abort()
      await expect(writePending).rejects.toBeDefined()
      await writeFile(join(dir, 'z.sqlite'), '')
      const previewAbort = new AbortController()
      const previewPending = readSqlitePreview(join(dir, 'z.sqlite'), previewAbort.signal)
      await new Promise((resolve) => { setTimeout(resolve, 200) })
      previewAbort.abort()
      await expect(previewPending).rejects.toBeDefined()
    })
  })
})
