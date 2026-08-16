/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-client-modules-web`.
 * @module @deepseek-ai/dsh-host-client-modules-web/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-client-modules-web'

/** Cordis companion plugin name. */
export const name = 'host-client-modules-web-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the adapter owns two effect-scoped Web registrations
// and no mutable service relation; real-composition coverage proves that both
// the route and index tap release when its fiber disposes.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
