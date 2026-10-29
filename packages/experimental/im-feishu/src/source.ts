/**
 * Prompt message source construction and delivery identity mapping for Feishu IM.
 *
 * @module @deepseek-ai/dsh-experimental-im-feishu/source
 */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ImDeliveryKey } from './types.ts'

/**
 * Mint a fresh cryptographically random SessionRequestId for a newly admitted IM delivery.
 *
 * @returns A new branded SessionRequestId.
 */
export function mintImSessionRequestId(): SessionRequestId {
  return brandString<SessionRequestId>(randomUUID())
}

/**
 * Create a canonical Option (c) user message source for an authenticated IM prompt.
 * Carries the minted branded SessionRequestId in `rpcId` and an optional clientTimeZone.
 * Delivery keys and platform IDs remain in domain storage, never in Session log source.
 *
 * @param requestId - Minted prompt identity shared across delivery retries.
 * @param clientTimeZone - Optional validated IANA or UTC client time zone.
 * @returns A valid MessageSource adhering to the `user-rpc` schema.
 */
export function createImPromptSource(
  requestId: SessionRequestId,
  clientTimeZone?: string,
): MessageSource {
  return {
    kind: 'user',
    rpcId: requestId,
    ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
  }
}

/**
 * Encode an IM delivery key into a deterministic canonical lookup string for domain storage.
 * Uses a fixed ordered JSON tuple to ensure injectivity for arbitrary string values.
 *
 * @param key - The structured Feishu delivery composite key.
 * @returns The injective canonical JSON string key.
 */
export function encodeDeliveryKey(key: ImDeliveryKey): string {
  return JSON.stringify([
    key.provider,
    key.appId,
    key.tenantId,
    key.chatId,
    key.senderId,
    key.eventId,
  ])
}
