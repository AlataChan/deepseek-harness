/** In-process terminal presentation plugin. @module @deepseek-ai/dsh-tui */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name. */
export const name = 'tui'

/**
 * Mount the terminal presentation package.
 * @param _ctx - Cordis context that will own the terminal client lifecycle.
 */
export function apply(_ctx: Context): void {}
