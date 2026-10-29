/**
 * Durable Feishu ingress, isolated tenant delivery, and human interaction helpers.
 * Runtime and ingress Cordis plugins use the explicit /runtime and /ingress entries.
 *
 * @module @deepseek-ai/dsh-experimental-im-feishu
 */

export type {
  FeishuAppId,
  FeishuTenantId,
  FeishuChatId,
  FeishuSenderId,
  FeishuEventId,
  OperatorId,
  TargetTenantId,
  ImDeliveryKey,
  ResolvedApprovalContext,
  IncomingImMessage,
  IngressAcceptResult,
  IngressDurableAcceptor,
} from './types.ts'

export {
  parseFeishuAppId,
  parseFeishuTenantId,
  parseFeishuChatId,
  parseFeishuSenderId,
  parseFeishuEventId,
  parseOperatorId,
  parseTargetTenantId,
} from './types.ts'

export {
  mintImSessionRequestId,
  createImPromptSource,
  encodeDeliveryKey,
} from './source.ts'

export {
  resolveApprovalContext,
  type ApprovalTargetQuery,
} from './approval-context.ts'

export {
  IM_SCHEMA_VERSION,
  INGRESS_DOMAIN_NAME,
  TENANT_RECEIPT_DOMAIN_NAME,
  operatorBindingSchema,
  ingressDeliverySchema,
  tenantReceiptSchema,
  ingressDomainSpec,
  tenantReceiptDomainSpec,
  encodeOperatorBindingKey,
  IngressStorage,
  TenantReceiptStorage,
  reconcileDelivery,
  type OperatorBindingRecord,
  type IngressDeliveryRecord,
  type TenantReceiptRecord,
  type DeliveryReconciliationResult,
} from './storage.ts'

export {
  IPC_PROTOCOL_VERSION,
  ipcServerMessageSchema,
  MAX_FRAME_BYTES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  NdjsonLineBuffer,
  TenantIpcSession,
  TenantIpcServer,
  TenantIpcClient,
  type IpcFrame,
  type InitRequest,
  type InitResponse,
  type SubmitDeliveryRequest,
  type SubmitDeliveryResponse,
  type GetDeliveryRequest,
  type GetDeliveryResponse,
  type CancelDeliveryRequest,
  type CancelDeliveryResponse,
  type GetApprovalContextRequest,
  type GetApprovalContextResponse,
  type PingRequest,
  type PongResponse,
  type ErrorResponse,
  type IpcClientMessage,
  type IpcServerMessage,
  type TenantRuntimeIpcHandler,
} from './ipc.ts'

export {
  TenantRuntimeService,
  type AgentSessionProvider,
  type TenantRuntimeConfig,
} from './runtime-service.ts'

export {
  IngressService,
  type TenantIpcClientProvider,
  type IngressConfig,
  type ImReplySender,
  ingressConfigSchema,
} from './ingress.ts'

export { ImWriterLease } from './writer-lease.ts'
