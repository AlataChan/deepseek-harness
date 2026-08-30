/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-connection-process`.
 * @module @deepseek-ai/dsh-client-connection-process/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-connection-process'

/** Cordis companion plugin name. */
export const name = 'client-connection-process-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the protocol parser and codec own closed local state;
 * gateway lifecycle relationships are checked by their owning package tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's empty invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
