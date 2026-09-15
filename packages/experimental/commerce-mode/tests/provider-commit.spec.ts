/** Source commits keep the previous database and manifest on caught failures and keep the store owner-only. */

import { readFileSync } from 'node:fs'
import { chmod, mkdtemp, readdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { writeSqliteFile } from '@deepseek-ai/dsh-experimental-desktop-ask-data/spreadsheet'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { CommerceImportPreview, CommerceSourceId } from '@deepseek-ai/dsh-host-commerce'
import CommerceMode from '@deepseek-ai/dsh-experimental-commerce-mode'
import { writeCommerceManifest } from '../src/provider/manifest.ts'

vi.mock(import('node:fs/promises'), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, rename: vi.fn(actual.rename), unlink: vi.fn(actual.unlink) }
})
vi.mock(import('@deepseek-ai/dsh-experimental-desktop-ask-data/spreadsheet'), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, writeSqliteFile: vi.fn(actual.writeSqliteFile) }
})
vi.mock(import('../src/provider/manifest.ts'), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, writeCommerceManifest: vi.fn(actual.writeCommerceManifest) }
})

const roots: string[] = []
const fibers: Array<ReturnType<Context['plugin']>> = []

afterEach(async () => {
  for (const mock of [vi.mocked(rename), vi.mocked(unlink), vi.mocked(writeSqliteFile), vi.mocked(writeCommerceManifest)]) {
    mock.mockReset()
  }
  await Promise.allSettled(fibers.splice(0).map(fiber => fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const platforms = {
  taobao: {
    orders: { order_id: '订单编号', listing_id: '商品ID', quantity: '数量', gross_sales: '实付金额', currency: '币种', ordered_at: '下单时间' },
    products: { listing_id: '商品ID', title: '商品标题', sku: '商家编码', status: '状态', parent_id: '父商品ID' },
    inventory: { listing_id: '商品ID', available: '可用库存', low_stock_threshold: '低库存阈值' },
  },
  sample: {
    orders: { order_id: 'order', listing_id: 'listing', quantity: 'quantity', gross_sales: 'sales', currency: 'currency', ordered_at: 'date' },
    products: { listing_id: 'listing', title: 'title', sku: 'sku', status: 'status', parent_id: 'parent' },
    inventory: { listing_id: 'listing', available: 'available', low_stock_threshold: 'threshold' },
  },
}
const products = readFileSync(new URL('fixtures/taobao-products.csv', import.meta.url))
const editedProducts = new TextEncoder().encode('商品ID,商品标题,商家编码,状态,父商品ID\nP-1,Oolong tea,TEA-1,active,\n')

async function bench(options: { readonly broadRoot?: boolean } = {}): Promise<{ root: string; commerce: CommerceMode }> {
  const root = await mkdtemp(join(tmpdir(), 'commerce-commit-'))
  roots.push(root)
  if (options.broadRoot === true) await chmod(root, 0o755)
  const ctx = new Context()
  const projection = ctx.plugin(SessionProjectionRegistry)
  const subprocess = ctx.plugin(LocalSubprocessRuntime)
  fibers.push(projection, subprocess)
  await projection.await()
  await subprocess.await()
  const fiber = ctx.plugin(CommerceMode, {
    sourcesRoot: root,
    platforms,
    analysis: { maxRows: 20, maxOutputBytes: 65_536, timeoutMs: 2_000, graceMs: 100 },
    lockWaitMs: 5_000,
    sqlite3Path: 'sqlite3',
  })
  fibers.push(fiber)
  await fiber.await()
  return { root, commerce: ctx.commerce as CommerceMode }
}

function importProducts(commerce: CommerceMode): Promise<CommerceImportPreview> {
  return commerce.importSpreadsheet({ kind: 'products', platform: 'taobao', filename: 'products.csv', bytes: products })
}

function reimportProducts(commerce: CommerceMode, sourceId: CommerceSourceId): Promise<CommerceImportPreview> {
  return commerce.importSpreadsheet({
    sourceId, kind: 'products', platform: 'taobao', filename: 'products.csv', bytes: editedProducts,
  })
}

async function storeState(root: string, sourceId: CommerceSourceId) {
  const database = join(root, `${sourceId}.sqlite`)
  return {
    database: await readFile(database),
    mode: (await stat(database)).mode & 0o777,
    manifest: await readFile(join(root, 'manifest.json')),
  }
}

function commitResidue(entries: readonly string[]): string[] {
  return entries.filter(entry => entry.endsWith('.tmp') || entry.endsWith('.bak'))
}

describe('commerce source commit', () => {
  it('keeps the previous database and manifest when a re-import manifest commit fails', async () => {
    const { root, commerce } = await bench()
    const first = await importProducts(commerce)
    const before = await storeState(root, first.source.id)
    vi.mocked(writeCommerceManifest).mockRejectedValueOnce(new Error('manifest disk full'))
    await expect(reimportProducts(commerce, first.source.id)).rejects.toThrow('manifest disk full')
    expect(await storeState(root, first.source.id)).toEqual(before)
    expect(commitResidue(await readdir(root))).toEqual([])
  })

  it('keeps the previous database, its mode, and the manifest when replacing the database fails', async () => {
    const { root, commerce } = await bench()
    const first = await importProducts(commerce)
    const before = await storeState(root, first.source.id)
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('replacement refused'), { code: 'EPERM' }))
    await expect(reimportProducts(commerce, first.source.id)).rejects.toThrow('replacement refused')
    expect(await storeState(root, first.source.id)).toEqual(before)
    expect(commitResidue(await readdir(root))).toEqual([])
  })

  it('reports a committed re-import as success when backup cleanup fails', async () => {
    const { root, commerce } = await bench()
    const first = await importProducts(commerce)
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(unlink).mockImplementation(async (path) => {
      if (String(path).endsWith('.bak')) throw Object.assign(new Error('backup busy'), { code: 'EBUSY' })
      await actual.unlink(path)
    })
    await expect(reimportProducts(commerce, first.source.id)).resolves.toMatchObject({ tables: [{ rowCount: 1 }] })
    const listings = await commerce.searchListings(first.source.id, { query: 'Oolong', limit: 5 })
    expect(listings.map(listing => listing.title)).toEqual(['Oolong tea'])
    expect((await readdir(root)).filter(entry => entry.endsWith('.bak'))).toHaveLength(1)
  })

  it('leaves no database behind when a new source manifest commit fails', async () => {
    const { root, commerce } = await bench()
    vi.mocked(writeCommerceManifest).mockRejectedValueOnce(new Error('manifest disk full'))
    await expect(importProducts(commerce)).rejects.toThrow('manifest disk full')
    expect((await readdir(root)).filter(entry => entry.endsWith('.sqlite'))).toEqual([])
    expect(commitResidue(await readdir(root))).toEqual([])
  })

  it('publishes no sample source when its database write fails', async () => {
    const { root, commerce } = await bench()
    vi.mocked(writeSqliteFile).mockRejectedValueOnce(new Error('sample disk full'))
    await expect(commerce.importSample()).rejects.toThrow('sample disk full')
    expect(await commerce.listSources()).toEqual([])
    expect((await readdir(root)).filter(entry => entry.endsWith('.sqlite'))).toEqual([])
    expect(vi.mocked(writeSqliteFile)).toHaveBeenCalledTimes(1)
  })

  it.skipIf(process.platform === 'win32')('keeps the source root, manifest, and committed database owner-only', async () => {
    const { root, commerce } = await bench({ broadRoot: true })
    const first = await importProducts(commerce)
    expect((await stat(root)).mode & 0o777).toBe(0o700)
    expect((await stat(join(root, 'manifest.json'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(root, `${first.source.id}.sqlite`))).mode & 0o777).toBe(0o400)
  })
})
