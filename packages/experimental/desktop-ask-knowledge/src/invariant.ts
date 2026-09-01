/**
 * Package-owned invariant companion for the desktop ask-knowledge overlay.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-desktop-ask-knowledge'

/** Cordis companion plugin name. */
export const name = 'experimental-desktop-ask-knowledge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: overlay rows are authoritative in catalog.json;
 * vault files and session binds are observed by the Provider and Consumer.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the desktop-ask-knowledge invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
