/**
 * Resolve DEEPSEEK_API_KEY for one sidecar spawn. Never writes process.env.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/credentials-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'

const KEY_REF = credentialRef('DEEPSEEK_API_KEY')

/** User-visible failure when the Models page has no key. */
export const MISSING_API_KEY_MESSAGE = '还没有 API Key'

/**
 * Resolve the DeepSeek key for one propose (or other LLM) sidecar call.
 * @param ctx - Host context that may carry `credentials`.
 * @returns env overlay containing only `DEEPSEEK_API_KEY`.
 */
export async function resolveProposeEnv(ctx: Context): Promise<Readonly<Record<string, string>>> {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new AskKnowledgeError('credentials-missing', MISSING_API_KEY_MESSAGE)
  }
  const resolved = await credentials.resolve(KEY_REF)
  if (resolved === undefined || resolved.value.trim() === '') {
    throw new AskKnowledgeError('credentials-missing', MISSING_API_KEY_MESSAGE)
  }
  return { DEEPSEEK_API_KEY: resolved.value }
}
