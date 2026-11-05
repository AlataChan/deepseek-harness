# 持久化会话问题

[English](session-decisions.md) | 中文

可选的 [`session-decisions` 包](../../packages/experimental/session-decisions/README.zh.md)管理附属于现有会话的结构化问题。会话仍负责执行和保存回答日志；此服务保存问题生命周期及回答准入索引。

## 标识与权限

`DecisionId` 标识一个已保存的问题。其 `SessionId` 标识提问会话，修订号控制问题变更。回答请求 ID 将一次已预留的提交与现有会话提示输入路径关联起来。回答获准进入会话，不等于回答所要求的工作已经完成。

经过认证的回答属于普通人工输入，并通过排队方式提交。一旦接受，即使问题随后被取代，模型仍能看到该回答。此包不增加自动重放回答或后台投递队列。

## 持久化状态

每个问题对应一条 storage-domain 记录。问题生命周期、暂停状态、回答指针和通知引用共用该记录；会话写入独立进行，不具备跨记录事务。回答正文属于会话日志。问题记录保留关联及冲突检测元数据，而不保存第二份回答正文。

投递结果不确定时需要核实，并禁止再次提交提示输入。精确的持久化会话证据可以确认回答已进入会话；缺少此类证据并不代表请求的外部操作没有发生。私有记录升级由此包负责，不改变会话日志格式。

## 展示

包 README 负责说明配置、工具行为、客户端展示、过期、恢复和支持的组合。卡片生命周期从问题服务读取；仅导出会话不会导出实时问题状态索引。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessiondecisions--sessiondecisionsservice"></a>

### `ctx.sessionDecisions` — `SessionDecisionsService`

The session-decisions Host service; Remote namespace `sessionDecisions`.

```ts cordis-catalog
/**
 * Validated feature limits, shared with the tools consumer for arg validation.
 * @returns Validated question bounds.
 */
limits(): DecisionLimits

/**
 * Save a new open question. Public admission owner for the question tool
 * (B1.3) and workflow callers (B2): validation, one-unresolved, and
 * capacity policy all enforce here, not in Remote closures.
 * @param input - Question creation fields.
 * @returns Saved question with its initial revision.
 */
async create(input: { sessionId: SessionId; question: string; choices: readonly string[]; ttlMs?: number }): Promise<DecisionView>

/**
 * Answer-admission owner: validate the payload and its request identity,
 * reserve the answer slot, deliver exactly one Session prompt (`queue`
 * mode), flush durability, and leave settlement to durable evidence. Every
 * outcome returns the immutable feature-allocated request id; retries
 * classify per the B0 retry table without a second prompt.
 * @param decisionId - Saved question identity.
 * @param expectedRevision - Revision required for this mutation.
 * @param requestId - Reserved Session prompt identity.
 * @param payload - Answer fields used for validation and conflict detection.
 * @returns Admission outcome; uncertainty never permits another prompt.
 */
@Remote async submit( decisionId: DecisionId, expectedRevision: number, requestId: SessionRequestId, payload: AnswerSubmitPayload, ): Promise<AnswerSubmitOutcome>

/**
 * Trusted local admission for B2 workflow callbacks: identical validation,
 * reservation, and one-prompt delivery to {@link submit}, without a caller
 * request identity (the feature's allocated ID is always used), plus the
 * optional `beforePrompt` hook. The hook runs exactly once, after the
 * reservation commits and before the one queued prompt, and receives only
 * the reserved decision, Session, and request identities. Hook failure
 * leaves the reservation unresolved: never reset, never resent, never
 * prompted — the retry table reports `submitting` until durable evidence
 * settles it.
 * @param decisionId - Saved question identity.
 * @param expectedRevision - Revision required for this mutation.
 * @param payload - Answer fields used for validation and conflict detection.
 * @param beforePrompt - Trusted local hook invoked after reservation and before the one queued prompt.
 * @returns Admission outcome for the shared desktop and verified-channel path.
 */
async admitAnswer( decisionId: DecisionId, expectedRevision: number, payload: AnswerSubmitPayload, beforePrompt?: (reserved: { decisionId: DecisionId; sessionId: SessionId; requestId: SessionRequestId }) => Promise<void>, ): Promise<AnswerSubmitOutcome>

/** Read private notification metadata for the trusted channel adapter.
 * @param decisionId - Saved question identity.
 * @returns JSON-only publication fields, when present.
 */
notification(decisionId: DecisionId): Promise<JsonValue | undefined>

/** Compare-and-swap publication progress through the aggregate's single writer.
 * @param decisionId - Saved question identity.
 * @param expected - Previously read metadata; undefined claims an empty slot.
 * @param next - Validated publication metadata.
 * @param expectedRevision - Initial question revision, omitted for settlement.
 * @returns Whether this call committed the update.
 */
writeNotification(decisionId: DecisionId, expected: JsonValue | undefined, next: JsonValue, expectedRevision?: number): Promise<boolean>

/** Publish one optional notification after the question guard and turn conclusion are armed.
 * @param decisionId - Saved question identity.
 * @returns Completion of the bounded publication attempt; a saved question remains usable on failure.
 */
async notifyQuestion(decisionId: DecisionId): Promise<void>

/**
 * Questions belonging to the asking Session.
 * @param sessionId - Asking Session identity.
 * @returns Questions belonging to the asking Session.
 */
@Remote catalog(sessionId: SessionId): Promise<DecisionView[]>

/**
 * Question if it exists.
 * @param decisionId - Saved question identity.
 * @returns Question if it exists.
 */
@Remote get(decisionId: DecisionId): Promise<DecisionView | undefined>

/**
 * Feature availability for diagnostics: available state or the named failure.
 * @returns Feature availability and an optional unavailability reason.
 */
@Remote status(): Promise<{ available: boolean; reason?: string }>

/**
 * Tracking-dismissal result; an admitted input is not retracted.
 * @param decisionId - Saved question identity.
 * @param expectedRevision - Revision required for this mutation.
 * @returns Tracking-dismissal result; an admitted input is not retracted.
 */
@Remote async dismiss(decisionId: DecisionId, expectedRevision: number): Promise<RecordMutationOutcome>

/**
 * Cancellation result with the current question state.
 * @param decisionId - Saved question identity.
 * @param expectedRevision - Revision required for this mutation.
 * @returns Cancellation result with the current question state.
 */
@Remote async cancel(decisionId: DecisionId, expectedRevision: number): Promise<RecordMutationOutcome>

/**
 * Suspension result with the current question state.
 * @param decisionId - Saved question identity.
 * @param expectedRevision - Revision required for this mutation.
 * @param reason - User-visible suspension reason.
 * @returns Suspension result with the current question state.
 */
@Remote async pause(decisionId: DecisionId, expectedRevision: number, reason: string): Promise<RecordMutationOutcome>

/**
 * Question-resumption result; does not resume Goal.
 * @param decisionId - Saved question identity.
 * @param expectedRevision - Revision required for this mutation.
 * @returns Question-resumption result; does not resume Goal.
 */
@Remote async resume(decisionId: DecisionId, expectedRevision: number): Promise<RecordMutationOutcome>

/**
 * Producing-step identity of one observed tool call, delegated to the
 * observers. `undefined` (feature off, degraded, or call not observed)
 * refuses the question tool without writing.
 * @param sessionId - Asking Session identity.
 * @param callId - Tool call identity in the producing step.
 * @returns Identity when the tool call belongs to the observed producing step.
 */
producingIdentity(sessionId: SessionId, callId: string): ProducingStepIdentity | undefined

/**
 * Arm the session's deny-all question guard for the producing step,
 * delegated to the observers. A no-op while the feature is degraded or
 * stopping — and then the tool result has already been saved durably.
 * @param agent - Agent owning the producing step.
 * @param identity - Observed producing-step identity.
 */
armProducingGuard(agent: Agent, identity: ProducingStepIdentity): void

/**
 * Apply observed queue facts to one record. B1.3's observers call this on
 * Session events; it lives on the service so fact settlement has a single
 * admission owner. Facts accumulate synchronously BEFORE any write is
 * queued, so a competing write already in the chain (a dismissal, a
 * withdrawal) resolves against them inside its durable update, and the
 * settle write below resolves again at its own chain slot — the latest
 * synchronous facts always win inside the actual storage execution.
 * @param decisionId - Saved question identity.
 * @param facts - Observed Session admission evidence.
 * @returns Current view after applying evidence, or undefined if the question is absent.
 */
async applyFacts(decisionId: DecisionId, facts: DecisionFacts): Promise<DecisionView | undefined>
```

Types: [Agent](core.zh.md) · [SessionId](core.zh.md) · [SessionRequestId](session.zh.md)

Source: [`packages/experimental/session-decisions/src/service.ts`](../../packages/experimental/session-decisions/src/service.ts)
<!-- END GENERATED cordis-surface -->
