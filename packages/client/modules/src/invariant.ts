/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-modules`.
 * @module @deepseek-ai/dsh-client-modules/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-modules'

/** Cordis companion plugin name. */
export const name = 'client-modules-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Owned relation: the node half's boot entry graph must stay self-consistent
 * — every row must have a bundle record under the same id and revision, or a
 * surface receiving the graph cannot locate the artifact it advertises.
 * Checked on every scan trigger (cordis 'internal/plugin'): graph() and
 * bundleRecords() read the same table object, so the relation holds at any
 * instant — no need to wait out the node half's own microtask-debounced flush.
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('internal/plugin', () => {
    const host = ctx.get('clientModules')
    if (host === undefined) return // browser side / host without the node half: nothing to audit
    const records = new Map(host.bundleRecords().map(record => [record.entry.id, record]))
    for (const row of host.graph().entries) {
      const record = records.get(row.id)
      if (record === undefined || record.entry.rev !== row.rev) {
        fail(`client graph row "${row.id}" at revision ${row.rev} has no matching bundle record`)
      }
    }
  }, { global: true })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
