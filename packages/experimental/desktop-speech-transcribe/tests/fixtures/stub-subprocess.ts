/** Test-only subprocess seam for compositions whose input never needs decoding. */
import type { Context } from '@deepseek-ai/cordis'

/**
 * Provide an inert process provider: executable lookup succeeds and any spawn
 * reports an unreachable path.
 * @param ctx - composition context that receives the service.
 */
export function apply(ctx: Context): void {
  ctx.provide('subprocess', {
    async resolveExecutable(command: string): Promise<string> {
      return `/stub/${command}`
    },
    spawn(): never {
      throw new Error('stub-subprocess: this composition never decodes')
    },
  })
}
