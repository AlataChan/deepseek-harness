/**
 * Package-owned invariant companion for the desktop ask-data overlay.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-desktop-ask-data'

/** Cordis companion plugin name. */
export const name = 'experimental-desktop-ask-data-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: overlay rows are authoritative in the manifest file;
 * data-agent owns the connection book this overlay writes through.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the desktop-ask-data invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
