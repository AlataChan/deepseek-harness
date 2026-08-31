/**
 * Host fold of one ask-data bind. The event and projection keys live in
 * {@link ./types.ts}; this module owns only the `ProjectionDefinition`.
 * @module @deepseek-ai/dsh-host-ask-data/session
 */

import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { AskDataBinding } from './types.ts'

export type { AskDataBinding } from './types.ts'

const askDataBindingSchema = z.union([
  z.object({
    sourceId: z.string(),
    connectionRef: z.string(),
    displayName: z.string(),
    readonly: z.boolean(),
  }),
  z.null(),
])

/** Current Session ask-data bind, empty until `ask-data/bound`. */
export const askDataBindingProjectionDefinition = {
  key: 'askDataBinding',
  stateSchema: askDataBindingSchema,
  init: () => null,
  apply: (state, event) => event.type === 'ask-data/bound' ? event.data : state,
  wire: { viewSchema: askDataBindingSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'askDataBinding', AskDataBinding | null>
