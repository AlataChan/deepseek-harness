# Persistent Session questions

English | [中文](session-decisions.zh.md)

The optional [`session-decisions` package](../../packages/experimental/session-decisions/README.md) owns structured questions attached to existing Sessions. Sessions remain the execution and answer-log owners; this service stores question lifecycle and answer-admission indexing.

## Identity and authority

`DecisionId` identifies one saved question. Its `SessionId` identifies the asking conversation, and its revision controls question mutations. The answer request ID correlates one reserved submission with the existing Session prompt path. Admission is distinct from completion of the work requested by that answer.

An authenticated answer is ordinary human input and uses queued submission. Once accepted, it remains visible to the model even if the question is superseded. The package adds no automatic answer replay or background delivery queue.

## Durable state

Each question is one storage-domain record. Question lifecycle, suspension, answer pointer, and notification references share that record; Session writes are separate and have no cross-record transaction. The answer body belongs to the Session log. The question record retains correlation and conflict-detection metadata rather than a second answer body.

Uncertain delivery requires reconciliation and forbids another prompt. Exact durable Session evidence can establish that an answer entered; absence of such evidence does not establish that the requested external action did not occur. Private record upgrades belong to this package, without changing the Session log format.

## Presentation

The package README owns configuration, tool behavior, Client presentation, expiry, recovery, and supported composition. Card lifecycle is read from the question service; exporting the Session alone does not export a live question status index.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.md) · [SessionId](core.md) · [SessionRequestId](session.md)

Source: [`packages/experimental/session-decisions/src/service.ts`](../../packages/experimental/session-decisions/src/service.ts)
<!-- END GENERATED cordis-surface -->
