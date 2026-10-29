/** Compose tenant delivery handling with optional explicit human interaction answerers. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ApprovalActionId } from './approval-actions.ts'
import type { TenantApprovalBroker } from './approval-broker.ts'
import type { QuestionActionId, TenantQuestionBroker } from './question-broker.ts'
import type { TenantRuntimeService } from './runtime-service.ts'
import type { TenantRuntimeIpcHandler, SubmitDeliveryRequest, GetDeliveryRequest, CancelDeliveryRequest, GetApprovalContextRequest } from './ipc.ts'
import type { ListInteractionsRequest, ListInteractionsResponse, AnswerInteractionRequest, AnswerInteractionResponse } from './interaction-protocol.ts'

/** Optional Phase 3 handler; Phase 2 profiles compose the runtime directly. */
export class TenantInteractionHandler implements TenantRuntimeIpcHandler {
  /**
   * @param runtime - Tenant-owned delivery service.
   * @param approvals - Tenant-owned approval requests.
   * @param questions - Tenant-owned structured questions.
   */
  constructor(private readonly runtime: TenantRuntimeService, private readonly approvals: TenantApprovalBroker,
    private readonly questions: TenantQuestionBroker) {}

  handleSubmitDelivery(request: SubmitDeliveryRequest) { return this.runtime.handleSubmitDelivery(request) }
  handleGetDelivery(request: GetDeliveryRequest) { return this.runtime.handleGetDelivery(request) }
  handleCancelDelivery(request: CancelDeliveryRequest) { return this.runtime.handleCancelDelivery(request) }
  handleGetApprovalContext(request: GetApprovalContextRequest) { return this.runtime.handleGetApprovalContext(request) }
  handleClientDisconnected() { return this.runtime.handleClientDisconnected() }

  handleListInteractions(request: ListInteractionsRequest): Promise<ListInteractionsResponse> {
    return Promise.resolve({ id: request.id, type: 'list_interactions_ack', deliveryKey: request.deliveryKey,
      approvals: [...this.approvals.list(request.deliveryKey, request.operatorId)],
      questions: this.questions.list(request.deliveryKey, request.operatorId).map(card => ({ ...card, questions: [...card.questions] })),
    })
  }

  async handleAnswerInteraction(request: AnswerInteractionRequest): Promise<AnswerInteractionResponse> {
    let accepted = false
    if (request.response.kind === 'approval') {
      if (this.approvals.list(request.deliveryKey, request.operatorId).some(card => card.actionId === request.actionId)) {
        accepted = await this.approvals.answer(brandString<ApprovalActionId>(request.actionId), request.actor,
          request.operatorId, request.response.decision)
      }
    } else if (this.questions.list(request.deliveryKey, request.operatorId).some(card => card.actionId === request.actionId)) {
      accepted = await this.questions.answer(brandString<QuestionActionId>(request.actionId), request.actor,
        request.operatorId, request.response.answer)
    }
    return { id: request.id, type: 'answer_interaction_ack', accepted }
  }
}
