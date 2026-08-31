/**
 * Client-namespace projection of the ask-data domain: a pure re-export of
 * the package's types outlet. Client code imports only this namespace so
 * the Host `AskData` service and `dsh-session` root stay out of the browser
 * program.
 * @module @deepseek-ai/dsh-host-ask-data/client
 */

export type * from './types.ts'
