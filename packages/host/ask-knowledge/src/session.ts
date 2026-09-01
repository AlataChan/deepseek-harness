/**
 * Host fold of one ask-knowledge bind. Event and projection keys live in
 * {@link ./types.ts}; this module owns only the `ProjectionDefinition`.
 * @module @deepseek-ai/dsh-host-ask-knowledge/session
 */

import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { AskKnowledgeBinding } from './types.ts'

export type { AskKnowledgeBinding } from './types.ts'

const askKnowledgeBindingSchema = z.union([
  z.object({
    libraryId: z.string(),
    displayName: z.string(),
  }),
  z.null(),
])

/** Current Session ask-knowledge bind, empty until `ask-knowledge/bound`. */
export const askKnowledgeBindingProjectionDefinition = {
  key: 'askKnowledgeBinding',
  stateSchema: askKnowledgeBindingSchema,
  init: () => null,
  apply: (state, event) => {
    if (event.type === 'ask-knowledge/bound') return event.data
    if (event.type === 'ask-knowledge/unbound') return null
    return state
  },
  wire: { viewSchema: askKnowledgeBindingSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'askKnowledgeBinding', AskKnowledgeBinding | null>
