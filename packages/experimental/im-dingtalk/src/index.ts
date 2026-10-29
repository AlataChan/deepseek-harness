/**
 * DingTalk Stream platform transport, inbound event normalizer,
 * and safe outbound messaging for DeepSeek Harness.
 *
 * @module @deepseek-ai/dsh-experimental-im-dingtalk
 */

export type {
  DingTalkClientId,
  DingTalkCorpId,
  DingTalkConversationId,
  DingTalkSenderId,
  DingTalkMessageId,
  IncomingImMessage,
  IngressAcceptResult,
  IngressDurableAcceptor,
} from './types.ts'

export {
  parseDingTalkClientId,
  parseDingTalkCorpId,
  parseDingTalkConversationId,
  parseDingTalkSenderId,
  parseDingTalkMessageId,
} from './types.ts'

export {
  DEFAULT_APPROVED_DINGTALK_HOSTS,
  DingTalkNormalizerError,
  validateSessionWebhookUrl,
  normalizeDingTalkMessage,
  sanitizeDingTalkOutboundText,
  type DingTalkRejectionCode,
  type DingTalkNormalizerOptions,
} from './dingtalk-normalizer.ts'

export {
  DingTalkAmbiguousTimeoutError,
  DingTalkOutboundError,
  DingTalkOutboundClient,
  type HttpFetchFn,
  type DingTalkOutboundConfig,
} from './dingtalk-outbound.ts'

export {
  TOPIC_ROBOT,
  EventAck,
  DingTalkTransport,
  dingTalkTransportConfigSchema,
  type EventAckStatus,
  type DingTalkDownStream,
  type DingTalkCallbackAck,
  type DWClientLike,
  type DingTalkClientFactory,
  type DingTalkTransportDependencies,
  type DingTalkTransportConfig,
} from './dingtalk-transport.ts'
