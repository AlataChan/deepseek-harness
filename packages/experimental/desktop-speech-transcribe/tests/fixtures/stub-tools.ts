/** Test-only tools registry capturing the definitions a composed plugin registers. */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Definitions registered by the composed plugin, in registration order. */
export const registered: ToolDefinition[] = []

/**
 * Provide the capturing registry the composed tool plugin injects.
 * @param ctx - composition context that receives the service.
 */
export function apply(ctx: Context): void {
  ctx.provide('tools', {
    register(definition: ToolDefinition): () => void {
      registered.push(definition)
      return () => {
        const index = registered.indexOf(definition)
        if (index >= 0) registered.splice(index, 1)
      }
    },
  })
}
