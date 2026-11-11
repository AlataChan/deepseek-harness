# Stage B2 Feishu Decision Answers Implementation Plan

**Goal:** Publish persistent question cards through the existing desktop Feishu connection and deliver verified button answers to the original asking session.

**Architecture:** Desktop IM remains the sole connection owner. Decision-specific adapters live in the `session-decisions/feishu` subpath; im-feishu exposes generic channel/target ports without importing the desktop decision feature. A card callback adapter binds one decision revision, operator, publication and target session. It reuses the existing IM receipt and Session reconciliation mechanisms through an explicit target provider, while ordinary private text retains its existing IM conversation mapping. The Session log remains the admitted-answer authority.

**Tech Stack:** Existing Feishu SDK transport, desktop-im, im-feishu receipt storage/runtime, session-decisions, storage-domain, Vitest, Host-backed Session fixtures, and Tauri packaging.

**Execution status:** Follow after accepted B1. Synthetic implementation can use fake SDK boundaries; live qualification requires an authorized test application and explicit platform actions. Use `executing-plans` when implementation is requested. No Stage C work is included.

## Summary

This plan completes the IM channel in the [roadmap](2026-11-03-octopus-implementation-roadmap.md). It builds on [B0/B1](2026-11-03-octopus-stage-b0-b1-persistent-questions-plan.md); it does not implement a second delivery queue, a second WebSocket owner, or durable versions of live approval Promises. Real Feishu offline behavior remains unqualified until tested.

## Task B2.1: Pin connection, identity and delivery ownership

**Inspect:** `packages/experimental/desktop-im/src/{index,controller}.ts`; `packages/experimental/im-feishu/src/{desktop,desktop-lease,feishu-transport,ingress,interaction-ingress,interaction-handler,session-provider,runtime-service,storage,source}.ts`.

**Create evidence:** `.plans/octopus-implementation/stage-b2/source-and-identity-map.md`.

1. Trace `createDesktopImRuntime()` and its existing `FeishuTransport`. Confirm the currently absent card acceptor and identify the exact callback/publication wiring point. Do not instantiate another transport to add cards.
2. Trace free-text events through normalizer, ingress binding, conversation-to-session mapping, receipt creation and `TenantRuntimeService`. Record that this targets the configured IM session/workspace, not an arbitrary session with a pending question.
3. Trace current `InteractionIngress` publication and callback identity checks. Separate reusable card/identity logic from its live-request polling and tenant broker ownership. Persistent decisions cannot depend on the current in-process pending maps or be limited to the duration of an IM delivery.
4. Trace receipt admission, request-ID binding, bounded Session readers and `reconcileDelivery()`. A recovered receipt with no matching prompt remains unknown; do not reinterpret missing evidence as permission to replay.
5. Freeze a target-binding record containing decision ID/revision, source session ID, workspace identity, configured app/tenant/chat/operator binding, accepted publication ID, expiry, and channel configuration generation. Persist a server-generated opaque UUID for the generation: retain it across ordinary restarts and revoke it before explicit disable, configuration replacement or credential replacement. Settings and credentials have no shared transaction; a failed replacement leaves the old generation revoked. Match the configured external operator against authenticated SDK identity rather than the internal desktop operator label. The target comes only from a persisted valid decision; no callback-supplied path or session ID is trusted.
6. Freeze dependency direction: `im-feishu` exposes generic card-publish, verified-card-callback and session-target ports in `src/card-channel.ts` with a public export; it imports no `session-decisions` type or implementation. `desktop-im` implements those ports over its existing socket. The proposed `session-decisions/feishu` plugin consumes them and owns all decision-specific adapters. Audit `im-service-bundle`'s transitive production closure to ensure it cannot pull in the desktop decision feature.
7. Choose one publication owner: the session-decisions service writes persistent-question publication state in the existing decision aggregate. Its Feishu adapter invokes that service; generic im-feishu/desktop-im code does not maintain another question-publication journal. Existing live-interaction publication records retain their current distinct purpose. IM receipt state remains owned by the existing receipt runtime.
8. Pin the delivery-admission and storage-ownership choices the B0 review surfaced: a non-idle asking session (`TenantRuntimeService.admit` refuses non-idle agents, `runtime-service.ts:126`) and desktop `maxActiveDeliveries: 1` (`desktop.ts:110`) make a card answer fail rather than queue — choose explicit refusal or a decision-specific submit operation; a second runtime instance over one `TenantReceiptStorage` creates two receipt writers, so receipts for decision answers take a separate namespace or a decision-specific submit path; the decision adapter never owns asking-session handles and never cancels them on adapter disposal (`TenantAgentSessionProvider.dispose()` cancels owned handles with `{ kind: 'user' }`, `session-provider.ts:309-312`); asking-session reconciliation uses a bounded reader because `readSessionLog` throws above `maxReconciliationEvents` (`session-provider.ts:276-281`).

**Exit evidence:** Explicit adapter methods and persisted fields are reviewed against current interfaces. Existing conversation mapping is not weakened to permit arbitrary `sessionId` overrides. Confirm public exports and the no-reverse-dependency rule before any B2 code; no session-decisions imports may enter im-feishu or im-service-bundle. Any new persisted receipt/binding type is declared for the required type review.

## Implementation file mapping

The feature adapter keeps target validation, receipt creation, submission, and reconciliation together in `packages/experimental/session-decisions/src/feishu/channel.ts`; it adds no alternate Session provider or delivery runtime. Card rendering lives beside it in `cards.ts`. Host-backed callback and delivery tests live in `apps/web/tests/persistent-questions-feishu.snapshot.ts`; generic connection tests live in `packages/experimental/im-feishu/tests/card-channel.spec.ts` and `desktop.spec.ts`. The implementation uses these owners instead of the draft's proposed per-function adapter and test files. The acceptance requirements below remain applicable.

## Task B2.2: Add durable-question card publication to the existing connection

**Create:** `packages/experimental/session-decisions/src/feishu/index.ts`, `cards.ts`, `channel.ts`, with Host-backed card and channel tests in `apps/web/tests/persistent-questions-feishu.snapshot.ts`. Add generic `packages/experimental/im-feishu/src/card-channel.ts` and `tests/card-channel.spec.ts`, with no decision-feature imports.

**Modify:** `packages/experimental/im-feishu/src/desktop.ts`, its package exports, and `packages/experimental/desktop-im/src/index.ts` only to expose/register generic card capabilities over the existing owner. Extend session-decisions package exports with `./feishu` and its feature-owned publication methods. Dependencies point from the feature to generic IM capabilities, never in reverse; no core package depends on this feature.

1. Write a test whose fake SDK factory counts transports: enabling decision cards must still construct exactly one Feishu connection. Disabling/reconfiguring closes the same owner and drains its callbacks before replacement.
2. Build localized bounded cards from public question data: question, choices, expiry, and navigation hint. Include “按钮用于回答此问题；直接发文字会进入独立的 IM 会话” and the online-only limitation. Free text must not be offered as an answer route in this release.
3. Publish through the existing transport's outbound method. The session-decisions service persists publication state in its decision aggregate as the sole writer; the feature adapter reports transport outcomes through that service. Do not add a second publication journal or generic outbox implementation. Keep the actual accepted platform message ID for callback matching.
4. Use pending/in-flight/sent/failed/unknown transitions with current uncertainty semantics. A lost send acknowledgment must not silently create another live question or an automatic-success claim. Expired/cancelled cards show non-actionable status.
5. Preserve existing approval/live-question card routes. Route a callback only by an explicit kind and validated binding; do not send a persistent-question answer into the old live broker.
6. Test reconfiguration, wrong chat/operator, replaced credentials, revoked binding, oversized card, duplicate publication pass, and lost acknowledgment. No callback secret is retained in visible card data or test artifacts.

**Run:** `pnpm exec vitest run packages/experimental/im-feishu/tests/card-channel.spec.ts packages/experimental/im-feishu/tests/desktop.spec.ts packages/experimental/im-feishu/tests/interaction-cards.spec.ts`; then `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/persistent-questions-feishu.snapshot.ts`.

**Expected:** Single connection ownership, typed cards, preserved ordinary routes, and explicit publication uncertainty. Fake SDK tests do not establish real platform delivery.

## Task B2.3: Reuse receipts with an explicit asking-session provider

**Extend:** `packages/experimental/session-decisions/src/feishu/channel.ts` and `apps/web/tests/persistent-questions-feishu.snapshot.ts`. Use generic IM provider/runtime interfaces through their public exports; retain the existing Session controller as the execution owner.

**Modify narrowly:** `packages/experimental/im-feishu/src/{desktop,runtime-service,storage,card-channel}.ts` and exported types only for generic capability gaps established by B2.1. No desktop question type enters those owners. Prefer reuse through current interfaces; do not copy receipt storage, create a second pump/reconciler, or weaken ordinary chat's session match.

1. Add a target-confusion regression first: a legitimate card for Session A cannot deliver into Session B even if the callback includes B's ID. An ordinary IM chat request cannot use the card-target adapter to escape its conversation mapping.
2. Implement `DecisionSessionProvider` as a proposed adapter around the Host session controller and existing bounded Session reader. It resolves only the session stored on the validated decision binding, rechecks current workspace/operator access, and refuses archived, delegated, unavailable, or mismatched targets according to current owners.
3. Reuse `TenantReceiptStorage`, its schema and `reconcileDelivery()` in an isolated decision receipt namespace through the feature's submission operation. Keep ordinary conversation receipt ownership unchanged; do not construct a second delivery pump or runtime writer. Do not change `TenantAgentSessionProvider` to trust `request.sessionId`, and never let adapter disposal cancel the asking Agent.
4. Delegate both desktop and Feishu answers to B1's trusted local `admitAnswer()` owner. Its optional `beforePrompt` callback writes the receipt after the decision reservation commits and before the one public `sessionController.prompt()` call with `mode: queue`. That callback is never a Remote or model argument. Derive one stable callback-delivery identity from the verified publication, decision revision and accepted answer. A second callback cannot claim a second answer. Persist the receipt/request identity and check the actual admitted Session source against `createImPromptSource()`; platform identities remain in domain records, without a new persisted message-source variant or browser-controlled override.
5. Reuse the existing receipt record, Session reconciliation, unknown-state behavior and bounded read limits. Reconcile against the exact asking session, not the IM free-text session. Session content owns the admitted answer; decision state stores receipt/request references and status.
6. Handle the separate writes explicitly: decision reservation, receipt creation, prompt admission, reconciliation and decision-index update. Inject a crash at every cut. An existing recovered admitting receipt without matching prompt remains unknown and is never replayed automatically. Every reservation outside `none` forbids another receipt callback or prompt invocation, including a reservation with no receipt. Bounded absence is not evidence of non-dispatch. Preserve unresolved state and allow explicit tracking dismissal; never reopen delivery under a fresh card identity.
7. Preserve message-source authority from the source matrix. Background publication/reconciliation cannot mint a fresh human answer. Duplicate transport events return the same recorded result; conflicting answer content rejects.
8. Test a cold asking session, wrong workspace, archived session, receipt/session conflict, active target, changing operator binding, read ceiling exhaustion, and uncertain prompt admission. Keep current fail-closed behavior when the reader cannot establish evidence.

**Run:** `pnpm exec vitest run packages/experimental/im-feishu/tests/runtime-service.spec.ts packages/experimental/im-feishu/tests/session-provider.spec.ts`; then `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/persistent-questions-feishu.snapshot.ts`.

**Expected:** Receipt semantics are reused; only verified bound cards can reach their asking session. Ordinary IM routing and receipt conflict checks remain unchanged.

## Task B2.4: Wire callback routing and truthful desktop state

**Modify:** generic `packages/experimental/im-feishu/src/{desktop,feishu-transport,card-channel}.ts`, `packages/experimental/desktop-im/src/{index,types}.ts`, and feature-owned `packages/experimental/session-decisions/src/feishu/channel.ts`. Update client locales only where copy changes.

**Create or extend tests:** `apps/web/tests/persistent-questions-feishu.snapshot.ts`, existing `desktop.spec.ts`, and `packages/experimental/desktop-im/tests/{controller,loader-composition}.spec.ts`.

1. Install a card acceptor on the already owned transport and route authenticated SDK identity into the decision adapter. Validate app, tenant, chat, operator, original publication, decision revision, expiry and current configuration generation before accepting.
2. Keep free-text handling on the existing ingress path. Keep the configured workspace check: a question in workspace A cannot publish or accept a card through a connection authorized for workspace B. Ordinary IM text remains in its existing configured conversation; the desktop can still answer A. Within one authorized workspace, a verified button targets only its stored asking Session, never the separate free-text IM Session.
3. Race desktop answer against card answer through the same decision owner. Only one wins; losing callbacks return a non-success/already-answered outcome rather than delivering again.
4. Reflect answer state from Session evidence and receipt reconciliation. “Sent,” “admitted,” and “model finished” remain distinct. Unknown deliveries show an actionable unresolved state and preserve desktop access to the question/history.
5. Validate revision/expiry/context before admission and submit as a queued next-turn human answer. The service never resumes Goal; the model retains current full-human Goal authority in the new turn. Preserve core's distinction between paused and active-but-disarmed Goals. If context changes after acceptance, supersede the question but always deliver the human input as ordinary text; do not retract it through pre-step filtering. An already stale card is rejected before admission.
6. Disable or close connection intake before shutdown; await callbacks and receipt-backed work through existing teardown. Retain pending question records for desktop recovery. Never drop uncertainty merely because shutdown was orderly.

**Run:** `pnpm exec vitest run packages/experimental/im-feishu/tests/desktop.spec.ts packages/experimental/desktop-im/tests/controller.spec.ts packages/experimental/desktop-im/tests/loader-composition.spec.ts`; then `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/persistent-questions-feishu.snapshot.ts`.

## Task B2.5: Host-backed replay and failure qualification

**Create:** `apps/web/tests/persistent-questions-feishu.snapshot.ts`, `snapshots/web/persistent-questions-feishu/`, and feature-local failure fixtures. Extend B1's actual Host-backed runner rather than replacing Session controller with a hand-mounted fake.

1. Drive the SDK boundary synthetically while preserving real Host sessions, persistence, decision records, and receipt reconciliation. Record question-to-card-to-human-answer behavior and separate IM free-text routing.
2. Cover duplicate click, stale card, desktop-versus-card answer, cancellation/expiry, restart after callback admission, lost publication response, lost delivery acknowledgment, wrong actor, reconfiguration, and target-session mismatch.
3. Assert actual Session input count/source/request identity in the asking session, no injected answer in the ordinary IM session, and no duplicate new turn from callback replay.
4. Assert the decision service does not call Goal resume; test that the answer-turn model may resume an active-but-disarmed Goal while truly paused Goal resume still rejects. Assert the existing tool permission path remains enforced, queued answers start after the requesting turn, and late supersession never removes accepted human input. Include a busy-Team request refusal without publishing a persistent card.
5. Inspect artifact output independently of assistant prose. Platform calls are fake in this lane; mark it synthetic in `.plans/octopus-implementation/stage-b2/synthetic-results.md`.

**Run after needed build:** `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/persistent-questions-feishu.snapshot.ts`, plus only affected package specs. **Expected:** Deterministic Host/receipt behavior; no real platform readiness claim.

## Task B2.6: Qualify the authorized Feishu app

**Prerequisites:** Explicitly selected non-production app, configured test operator/chat, test workspace, model route, least-required platform permissions and subscriptions, and authorization for the messages/actions being tested. Resolve secrets through existing credentials; do not put them in fixtures or evidence.

1. Record sanitized app configuration and SDK/transport versions. With the desktop online, publish a synthetic question, answer by button, and confirm one answer in the asking session.
2. Type private text and confirm that it enters the separate IM conversation. Verify the card clearly explains this.
3. Test duplicate clicks, wrong operator/chat, expired card, cancellation, credential/configuration changes and reconnect. Confirm one desktop-owned connection in the tested app; do not launch a competing client merely to speculate about delivery distribution.
4. Close the desktop, attempt a card answer and a private reply, then reopen. Record actual failure/retry/redelivery behavior and timing without assuming the platform queues anything. Repeat network disconnect/reconnect separately from orderly app shutdown.
5. Keep online-only product wording unless the observed, documented platform behavior supports a stronger statement. Unknown results retain desktop fallback; do not relax receipt recovery to make the demonstration pass.
6. Record results and remaining limits in `.plans/octopus-implementation/stage-b2/platform-qualification.md`. If app access is unavailable, mark platform qualification pending and stop the release claim, while retaining completed synthetic evidence.

## Task B2.7: Documentation and installer delivery

1. Update im-feishu and desktop-im README pairs and new feature documentation. Verify the production closure of im-service-bundle contains no session-decisions code, and that generic capability exports compile for both desktop and tenant consumers. State single connection ownership, exact button/free-text routing, existing receipt reuse, actual human-answer Goal semantics and the measured offline limits. Add persistence acknowledgments for actual receipt/binding changes, and update SDK expected output only when their owned Session events change.
2. Run focused tests/snapshots and required docs/type/lint checks sequentially, then verify upstream intake for any covered path changed. No Schedule package change is part of this plan.
3. Build and qualify the produced DMG using the roadmap pipeline. In a fresh copied app/home, test desktop-only use with IM disabled, then the authorized Feishu case. Verify no mandatory IM setup or second connection appears on first launch.
4. Recheck restart/uncertain-receipt behavior in that installed artifact. Preserve hashes and sanitized evidence in `.plans/octopus-implementation/stage-b2/acceptance.md`.

## Completion criteria

One connection publishes cards and receives their callbacks; free text retains its own session; verified cards target only the asking session; Session-owned answers use the existing receipt/reconciliation system; duplicate and uncertain outcomes stay truthful; and authorized live-app plus installed-artifact evidence support the delivered claim. Synthetic success without platform access is an incomplete channel qualification.

## Dev Note

This plan completes B's optional IM channel without a new task scheduler or execution model. DingTalk answers, persistent tool approvals, programmatic-question suspension inside PTC, decision-service automatic Goal resume and Stage C remain outside this delivery.
