/**
 * Client-namespace projection of the ask-knowledge domain: a pure re-export of
 * the package's types outlet. Client code imports only this namespace so
 * the Host `AskKnowledge` service and `dsh-session` root stay out of the browser
 * program.
 * @module @deepseek-ai/dsh-host-ask-knowledge/client
 */

export type * from './types.ts'
