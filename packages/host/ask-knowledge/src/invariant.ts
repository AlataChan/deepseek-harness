/** Package-owned invariant companion for the ask-knowledge seam. @module @deepseek-ai/dsh-host-ask-knowledge/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-ask-knowledge'

/** Cordis companion plugin name. */
export const name = 'host-ask-knowledge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this stateless Service Definition owns the capability
 * vocabulary, while the overlay Provider and the session Consumer own observations.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the ask-knowledge invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
