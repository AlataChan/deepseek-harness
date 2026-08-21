/** Package-owned invariant companion for `@deepseek-ai/dsh-tui`. @module @deepseek-ai/dsh-tui/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { TuiControllerLifecycle } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-tui'

/** Cordis companion plugin name. */
export const name = 'tui-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** Assert one-to-one publication and disposal of the controller-owned runtime relation. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  let live: TuiControllerLifecycle | undefined
  ctx.on('tui/controller-mounted', (relation) => {
    if (live !== undefined) fail('more than one terminal controller is live')
    if (!relation.providersPublished) fail('controller published before its interaction providers')
    const agent = relation.agent
    if (agent !== undefined && ctx.agents.get(agent.id) !== agent) {
      fail('controller published an Agent that is not the exact live registry entry')
    }
    live = relation
  })
  ctx.on('tui/controller-disposed', (relation) => {
    const current = live
    if (current === undefined || current.controller !== relation.controller) {
      return fail('controller disposal does not match the live terminal owner')
    }
    if (current.agent !== relation.agent || !relation.providersPublished) {
      fail('controller disposal changed its Agent or provider ownership relation')
    }
    live = undefined
  })
}, { inject: ['agents'] as const })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
