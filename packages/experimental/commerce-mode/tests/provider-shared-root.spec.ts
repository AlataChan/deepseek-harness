/** Imports from separate Provider instances sharing one source root keep every committed source. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import CommerceMode, { type Config } from '@deepseek-ai/dsh-experimental-commerce-mode'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})

const platforms: Config['platforms'] = {
  sample: {
    orders: { order_id: 'order', listing_id: 'listing', quantity: 'quantity', gross_sales: 'sales', currency: 'currency', ordered_at: 'date' },
    products: { listing_id: 'listing', title: 'title', sku: 'sku', status: 'status', parent_id: 'parent' },
    inventory: { listing_id: 'listing', available: 'available', low_stock_threshold: 'threshold' },
  },
}

async function sharedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'commerce-shared-root-'))
  roots.push(root)
  return root
}

async function provider(sourcesRoot: string, lockWaitMs: number): Promise<CommerceMode> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(CommerceMode, {
    sourcesRoot,
    platforms,
    analysis: { maxRows: 20, maxOutputBytes: 65_536, timeoutMs: 2_000, graceMs: 100 },
    lockWaitMs,
    sqlite3Path: 'sqlite3',
  })
  return ctx.commerce as CommerceMode
}

function products(title: string): Uint8Array {
  return new TextEncoder().encode(`listing,title,sku,status,parent\nP-1,${title},SKU-1,active,\n`)
}

describe('shared source root', () => {
  it('keeps both sources when two Providers import concurrently', async () => {
    const root = await sharedRoot()
    const [first, second] = await Promise.all([provider(root, 30_000), provider(root, 30_000)])
    const imported = await Promise.all([
      first.importSpreadsheet({ kind: 'products', platform: 'sample', filename: 'first.csv', bytes: products('Green tea') }),
      second.importSpreadsheet({ kind: 'products', platform: 'sample', filename: 'second.csv', bytes: products('Black tea') }),
    ])
    const listed = (await first.listSources()).map(source => source.id).sort()
    expect(listed).toEqual(imported.map(preview => preview.source.id).sort())
  })

  it('fails an import that cannot acquire the source-store lock in time', async () => {
    const root = await sharedRoot()
    const commerce = await provider(root, 50)
    await writeFile(join(root, 'manifest.json.lock'), 'held by another Host\n')
    await expect(commerce.importSpreadsheet({
      kind: 'products', platform: 'sample', filename: 'products.csv', bytes: products('Tea'),
    })).rejects.toThrow('timed out waiting for the writer lock')
    expect(await commerce.listSources()).toEqual([])
  })

  it('refuses a configuration without the sample mapping', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(LocalSubprocessRuntime)
    await expect(ctx.plugin(CommerceMode, {
      sourcesRoot: await sharedRoot(),
      platforms: { taobao: platforms.sample ?? {} },
      analysis: { maxRows: 20, maxOutputBytes: 65_536, timeoutMs: 2_000, graceMs: 100 },
      lockWaitMs: 5_000,
      sqlite3Path: 'sqlite3',
    })).rejects.toThrow("platforms must include the 'sample' mapping")
  })
})
