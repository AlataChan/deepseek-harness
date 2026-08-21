/** Package-owned invariant companion for `@deepseek-ai/dsh-tui-app`. @module @deepseek-ai/dsh-tui-app/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-tui'
import type {} from './startup.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-tui-app'

/** Cordis companion plugin name. */
export const name = 'tui-app-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** Require every terminal controller publication to consume the startup provider. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('tui/controller-mounted', (relation) => {
    if (ctx.get('tuiStartup') === undefined) fail('terminal controller published without the TUI startup provider')
    if (!relation.providersPublished) fail('terminal controller published before its interaction providers')
  })
}, { inject: ['tuiStartup'] as const })

/**
 * Register the bundle-owned startup-to-controller invariant.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
