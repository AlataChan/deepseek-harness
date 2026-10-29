/**
 * TUI bundle entry point.
 * @module @deepseek-ai/dsh-tui-bundle
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'tui-bundle'

/**
 * Apply the TUI bundle plugin.
 * @param _ctx - Cordis context.
 */
export function apply(_ctx: Context): void {
  // Bundle marker row; composition is declared by cordis.patch.yml
}
