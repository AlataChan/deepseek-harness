/**
 * Host and Client projection of the single commerce source binding.
 * @module @deepseek-ai/dsh-host-commerce/session
 */

import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CommerceBinding, CommerceSourceId } from './types.ts'

export type { CommerceBinding } from './types.ts'

const commerceBindingSchema = z.union([
  z.object({
    sourceId: z.string().transform(value => brandString<CommerceSourceId>(value)),
    displayName: z.string(),
    kinds: z.array(z.enum(['orders', 'products', 'inventory'])).readonly(),
  }),
  z.null(),
])

/** Current Session commerce binding, empty until `commerce/bound`. */
export const commerceBindingProjectionDefinition = {
  key: 'commerceBinding',
  stateSchema: commerceBindingSchema,
  init: () => null,
  apply: (state, event) => event.type === 'commerce/bound' ? event.data : state,
  wire: { viewSchema: commerceBindingSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'commerceBinding', CommerceBinding | null>
