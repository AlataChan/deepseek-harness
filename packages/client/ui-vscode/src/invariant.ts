/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-vscode`.
 * @module @deepseek-ai/dsh-client-ui-vscode/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-vscode'

/** Cordis companion plugin name. */
export const name = 'client-ui-vscode-invariant'
/** Service required before the companion reserves package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package retains no Host relationship, while its
 * slot, IDE-event, selected-root, and reference-codec lifecycles are tested.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
