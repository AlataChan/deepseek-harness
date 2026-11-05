/**
 * Tool waterfall names declared on the tool registry in `index.ts`.
 * A second Cordis augmentation would disagree with that class, so this module only names them.
 * @module
 */

/** Waterfall and notification names the registry already declares. */
export const TOOL_RUNTIME_EVENTS = [
  'tools/pre-execute',
  'tools/execute',
  'tools/post-execute',
  'tools/result',
  'tools/change',
] as const
