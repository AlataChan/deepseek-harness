/** File-backed commerce Provider behavior through the public package entry. */

import { readFileSync } from 'node:fs'
import { copyFile, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import {
  CommerceSourceId,
  ListingId,
  type CommerceChange,
} from '@deepseek-ai/dsh-host-commerce'
import CommerceMode, {
  type Config,
} from '@deepseek-ai/dsh-experimental-commerce-mode'
import {
  assertAnalysisDatabasePath,
  runSqliteProcess,
  validateAnalysisQuery,
} from '../src/provider/analysis.ts'

const roots: string[] = []
const fibers: Array<ReturnType<Context['plugin']>> = []

afterEach(async () => {
  await Promise.allSettled(fibers.splice(0).map(fiber => fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})

const platforms: Config['platforms'] = {
  taobao: {
    orders: { order_id: '订单编号', listing_id: '商品ID', quantity: '数量', gross_sales: '实付金额', currency: '币种', ordered_at: '下单时间' },
    products: { listing_id: '商品ID', title: '商品标题', sku: '商家编码', status: '状态', parent_id: '父商品ID' },
    inventory: { listing_id: '商品ID', available: '可用库存', low_stock_threshold: '低库存阈值' },
  },
  pinduoduo: {
    orders: { order_id: '订单号', listing_id: '商品id', quantity: '商品数量', gross_sales: '商家实收金额', currency: '币种', ordered_at: '成团时间' },
    products: { listing_id: '商品id', title: '商品名称', sku: '商家编码', status: '商品状态', parent_id: '父商品id' },
    inventory: { listing_id: '商品id', available: '可售库存', low_stock_threshold: '低库存阈值' },
  },
  'douyin-shop': {
    orders: { order_id: '订单号', listing_id: '商品ID', quantity: '购买数量', gross_sales: '订单应付金额', currency: '币种', ordered_at: '下单时间' },
    products: { listing_id: '商品ID', title: '商品名称', sku: '商家编码', status: '商品状态', parent_id: '父商品ID' },
    inventory: { listing_id: '商品ID', available: '可售库存', low_stock_threshold: '低库存阈值' },
  },
  youzan: {
    orders: { order_id: '订单号', listing_id: '商品编码', quantity: '商品数量', gross_sales: '实付金额', currency: '币种', ordered_at: '下单时间' },
    products: { listing_id: '商品编码', title: '商品名称', sku: '商家编码', status: '商品状态', parent_id: '父商品编码' },
    inventory: { listing_id: '商品编码', available: '可售库存', low_stock_threshold: '低库存阈值' },
  },
  sample: {
    orders: { order_id: 'order', listing_id: 'listing', quantity: 'quantity', gross_sales: 'sales', currency: 'currency', ordered_at: 'date' },
    products: { listing_id: 'listing', title: 'title', sku: 'sku', status: 'status', parent_id: 'parent', price: 'price', description: 'description' },
    inventory: { listing_id: 'listing', available: 'available', low_stock_threshold: 'threshold' },
  },
}

async function bench(analysis: Partial<Config['analysis']> = {}): Promise<{
  ctx: Context
  root: string
  commerce: CommerceMode
}> {
  const root = await mkdtemp(join(tmpdir(), 'commerce-mode-'))
  roots.push(root)
  const ctx = new Context()
  const projectionFiber = ctx.plugin(SessionProjectionRegistry)
  const subprocessFiber = ctx.plugin(LocalSubprocessRuntime)
  fibers.push(projectionFiber, subprocessFiber)
  await projectionFiber.await()
  await subprocessFiber.await()
  const fiber = ctx.plugin(CommerceMode, {
    sourcesRoot: root,
    platforms,
    analysis: { maxRows: 20, maxOutputBytes: 65_536, timeoutMs: 2_000, graceMs: 100, ...analysis },
    lockWaitMs: 5_000,
    sqlite3Path: 'sqlite3',
  })
  fibers.push(fiber)
  await fiber.await()
  return { ctx, root, commerce: ctx.commerce as CommerceMode }
}

function csv(platform: string, kind: 'orders' | 'products' | 'inventory'): Uint8Array {
  return readFileSync(new URL(`fixtures/${platform}-${kind}.csv`, import.meta.url))
}

describe('CommerceMode Provider', () => {
  it.each(['taobao', 'pinduoduo', 'douyin-shop', 'youzan'])('imports fixed tables with the %s mapping', async (platform) => {
    const { commerce } = await bench()
    const imported = await commerce.importSpreadsheet({
      kind: 'products', platform, filename: 'products.csv', bytes: csv(platform, 'products'),
    })
    const sourceId = imported.source.id
    await commerce.importSpreadsheet({
      sourceId, kind: 'orders', platform, filename: 'orders.csv', bytes: csv(platform, 'orders'),
    })
    await commerce.importSpreadsheet({
      sourceId, kind: 'inventory', platform, filename: 'inventory.csv', bytes: csv(platform, 'inventory'),
    })

    expect((await commerce.describeSource(sourceId)).kinds).toEqual(['orders', 'products', 'inventory'])
    expect(await commerce.searchListings(sourceId, { query: 'Jasmine', limit: 5 })).toEqual([{
      id: 'P-1', title: 'Jasmine tea', sku: 'TEA-1', status: 'active',
    }])
    expect(await commerce.getListing(sourceId, ListingId('P-1'))).toMatchObject({
      id: 'P-1', title: 'Jasmine tea', variantIds: [], values: { sku: 'TEA-1' },
    })
    expect(await commerce.salesSummary(sourceId, {})).toEqual({
      orderCount: 1, unitsSold: 2, grossSales: 19.5, currency: 'CNY',
    })
    expect(await commerce.inventoryHealth(sourceId)).toEqual({
      items: [{ listingId: 'P-1', available: 3, status: 'low' }],
    })
    expect((await commerce.analysisSchema(sourceId)).tables.map(table => table.name)).toEqual([
      'inventory', 'orders', 'products',
    ])
    expect(await commerce.runAnalysisQuery(sourceId, 'SELECT title FROM products')).toEqual({
      columns: ['title'], rows: [{ title: 'Jasmine tea' }], truncated: false,
    })
  })

  it('preserves decoder warnings and rejects missing mapped columns', async () => {
    const { commerce } = await bench()
    const preview = await commerce.importSpreadsheet({
      kind: 'products', platform: 'sample', filename: 'products.csv',
      bytes: Buffer.from('listing,title,title,sku,status,parent\nP-1,Tea,duplicate,T-1,active,\n'),
    })
    expect(preview.warnings).toContain('header-duplicate')
    await expect(commerce.importSpreadsheet({
      kind: 'orders', platform: 'sample', filename: 'orders.csv', bytes: Buffer.from('order\nO-1\n'),
    })).rejects.toMatchObject({ code: 'import-invalid' })
  })

  it('lists, describes, and reloads imported sources from the manifest', async () => {
    const first = await bench()
    const imported = await first.commerce.importSpreadsheet({
      kind: 'products', platform: 'taobao', filename: 'products.csv', bytes: csv('taobao', 'products'),
    })
    expect(await first.commerce.listSources()).toEqual([imported.source])
    expect(await first.commerce.describeSource(imported.source.id)).toEqual({
      displayName: 'products.csv', kinds: ['products'],
    })
    await expect(first.commerce.describeSource(CommerceSourceId('missing'))).rejects.toMatchObject({
      code: 'source-missing',
    })
    expect(JSON.parse(await readFile(join(first.root, 'manifest.json'), 'utf8'))).toMatchObject({ version: 1 })
  })

  it('lists configured platform ids in configuration order', async () => {
    const { commerce } = await bench()
    expect(commerce.platforms()).toEqual(['taobao', 'pinduoduo', 'douyin-shop', 'youzan', 'sample'])
  })

  it('imports optional numeric price and text description product columns', async () => {
    const { commerce } = await bench()
    const sample = await commerce.importSample()
    const listing = await commerce.getListing(sample.source.id, ListingId('P-100'))
    expect(listing.values).toMatchObject({ price: 19.9, description: 'Spring-picked jasmine green tea in a 100 g tin' })
    await expect(commerce.importSpreadsheet({
      kind: 'products', platform: 'sample', filename: 'bad-price.csv',
      bytes: new TextEncoder().encode('listing,title,price\nP-1,Tea,free\n'),
    })).rejects.toMatchObject({ code: 'import-invalid', details: { ruleId: 'numeric-price' } })
  })

  it('imports the packaged fictional sample', async () => {
    const { commerce } = await bench()
    const preview = await commerce.importSample()
    expect(preview.source.displayName).toBe('Fictional tea shop')
    expect(preview.source.kinds).toEqual(['orders', 'products', 'inventory'])
    expect(preview.tables).toHaveLength(3)
  })

  it('rejects each lexical refusal class', () => {
    const refused = [
      ['', 'empty'], ['UPDATE products SET title = \'x\'', 'forbidden-keyword'],
      ['SELECT 1; SELECT 2', 'multiple-statements'], ['SELECT 1 -- comment', 'comments'],
      ['SELECT /* comment */ 1', 'comments'], ['PRAGMA table_info(products)', 'forbidden-keyword'],
      ['WITH x AS (DELETE FROM products RETURNING *) SELECT * FROM x', 'forbidden-keyword'],
      ['SELECT 1; trailing', 'multiple-statements'],
      ['EXPLAIN SELECT 1', 'select-only'],
    ] as const
    for (const [query, ruleId] of refused) {
      expect(() => validateAnalysisQuery(query)).toThrow(expect.objectContaining({
        code: 'analysis-rejected', details: { ruleId },
      }))
    }
    expect(validateAnalysisQuery('WITH x AS (SELECT 1 AS n) SELECT n FROM x')).toBeTruthy()
  })

  it('rejects REPLACE INTO after a read-only CTE', () => {
    expect(() => validateAnalysisQuery('WITH x AS (SELECT 1) REPLACE INTO products VALUES (1)'))
      .toThrow(expect.objectContaining({
        code: 'analysis-rejected', details: { ruleId: 'forbidden-keyword' },
      }))
  })

  it('accepts and executes the read-only replace function', async () => {
    const { commerce } = await bench()
    const imported = await commerce.importSpreadsheet({
      kind: 'products', platform: 'sample', filename: 'products.csv',
      bytes: Buffer.from('listing,title,sku,status,parent\nP-1,Jasmine tea,T-1,active,\n'),
    })
    expect(await commerce.runAnalysisQuery(
      imported.source.id,
      "SELECT replace(title, 'tea', 'cup') AS title FROM products",
    )).toEqual({
      columns: ['title'], rows: [{ title: 'Jasmine cup' }], truncated: false,
    })
  })

  it('caps rows and marks a result truncated', async () => {
    const { commerce } = await bench({ maxRows: 1 })
    const imported = await commerce.importSpreadsheet({
      kind: 'products', platform: 'sample', filename: 'products.csv',
      bytes: Buffer.from('listing,title,sku,status,parent\nP-1,Tea,T-1,active,\nP-2,Cup,C-1,active,\n'),
    })
    expect(await commerce.runAnalysisQuery(imported.source.id, 'SELECT listing_id FROM products ORDER BY 1')).toEqual({
      columns: ['listing_id'], rows: [{ listing_id: 'P-1' }], truncated: true,
    })
  })

  it('terminates oversized and timed-out analysis', async () => {
    const oversized = await bench({ maxOutputBytes: 32 })
    const source = await oversized.commerce.importSpreadsheet({
      kind: 'products', platform: 'taobao', filename: 'products.csv', bytes: csv('taobao', 'products'),
    })
    await expect(oversized.commerce.runAnalysisQuery(source.source.id, "SELECT printf('%01000d', 1) AS text"))
      .rejects.toMatchObject({ code: 'analysis-output-too-large' })

    const timed = await bench({ timeoutMs: 10 })
    const timedSource = await timed.commerce.importSpreadsheet({
      kind: 'products', platform: 'taobao', filename: 'products.csv', bytes: csv('taobao', 'products'),
    })
    await expect(timed.commerce.runAnalysisQuery(timedSource.source.id,
      'WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM x WHERE n<100000000) SELECT sum(n) FROM x'))
      .rejects.toMatchObject({ code: 'analysis-timeout' })
  }, 30_000)

  it('observes real sqlite safe-mode denials through the managed runner', async () => {
    const { ctx, root } = await bench()
    const sqlite3 = await ctx.subprocess.resolveExecutable('sqlite3')
    const limits = { maxRows: 1, maxOutputBytes: 65_536, timeoutMs: 2_000, graceMs: 100 }
    const dangerous = [
      ["SELECT readfile('/tmp/commerce-denied')", 'readfile'],
      ["SELECT writefile('/tmp/commerce-denied','x')", 'writefile'],
      ["SELECT load_extension('/tmp/commerce-denied')", 'load_extension'],
      ["ATTACH '/tmp/commerce-denied' AS p", 'ATTACH'],
    ] as const
    for (const [sql, diagnostic] of dangerous) {
      const result = await runSqliteProcess(ctx, [
        sqlite3, '-safe', '-batch', '-bail', ':memory:', sql,
      ], root, limits)
      expect(result.outcome.exitCode, diagnostic).not.toBe(0)
      expect(result.stderr.toLowerCase(), diagnostic).toContain(diagnostic.toLowerCase())
    }
  })

  it.skipIf(process.platform === 'win32')('rejects linked and outside-root databases', async () => {
    const { commerce, root } = await bench()
    const imported = await commerce.importSpreadsheet({
      kind: 'products', platform: 'taobao', filename: 'products.csv', bytes: csv('taobao', 'products'),
    })
    const database = join(root, `${imported.source.id}.sqlite`)
    const linked = join(root, 'linked.sqlite')
    await symlink(database, linked)
    await expect(assertAnalysisDatabasePath(root, linked)).rejects.toMatchObject({
      code: 'source-invalid', details: { ruleId: 'database-path' },
    })
    const outsideRoot = await mkdtemp(join(tmpdir(), 'commerce-outside-'))
    roots.push(outsideRoot)
    const outside = join(outsideRoot, 'outside.sqlite')
    await copyFile(database, outside)
    await expect(assertAnalysisDatabasePath(root, outside)).rejects.toMatchObject({
      code: 'source-invalid', details: { ruleId: 'database-path' },
    })
  })

  it('neutralizes formula-leading text while leaving numbers numeric', async () => {
    const { commerce } = await bench()
    const changes: CommerceChange[] = [{
      id: 'change-1' as CommerceChange['id'], kind: 'listing-update', listingId: ListingId('P-1'),
      before: { title: 'Tea', price: 10 }, after: { title: '=HYPERLINK("x")', price: 12, note: '\tcmd' },
    }]
    const csvText = await commerce.renderExport(changes, 'taobao')
    expect(csvText).toContain("'=HYPERLINK(\"\"x\"\")")
    expect(csvText).toContain("'\tcmd")
    expect(csvText).toContain(',12,')
    for (const prefix of ['+', '-', '@', '\t', '\r']) {
      const rendered = await commerce.renderExport([{ ...changes[0]!, after: { title: `${prefix}value` } }], 'taobao')
      expect(rendered).toContain(`'${prefix}value`)
    }
  })

  it('rejects a manifest path that names a source outside the root', async () => {
    const { commerce, root } = await bench()
    await writeFile(join(root, 'manifest.json'), JSON.stringify({
      version: 1,
      sources: [{ id: '../outside', displayName: 'bad', kinds: ['products'], warnings: [] }],
    }))
    await expect(commerce.listSources()).rejects.toMatchObject({ code: 'source-invalid' })
  })
})
