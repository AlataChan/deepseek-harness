/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-installed-runtime`.
 * @module @deepseek-ai/dsh-installed-runtime/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-installed-runtime'

/** Cordis companion plugin name. */
export const name = 'installed-runtime-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package is a pure discovery library plus a JSON
 * CLI; callers own any process they spawn from the returned paths.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's empty invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
