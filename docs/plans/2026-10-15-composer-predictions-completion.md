# Composer Predictions Completion and Acceptance Implementation Plan

English | [中文](2026-10-15-composer-predictions-completion.zh.md)

> **Builder:** implement this plan task-by-task in dependency order with the executing-plans workflow; land each task as its own scoped commit.

**Goal:** After a foreground conversation completes, offer one context-aware next-message suggestion as gray text inside its empty composer, with Tab accepting an editable draft and never sending it.

**Architecture:** Complete the existing assistant-registry prediction service and client-ui-assistants integration. Resolve context and eligibility on the Host, retain the existing auxiliary request/usage evidence, and use the existing composer overlay and settings slots. Keep ordinary chats, assistant chats, and team coordinator chats on the same prediction path without changing assistant bindings or the application default model.

**Tech Stack:** Cordis, Typert remotes, React, the existing Session query and input APIs, existing revisioned Settings APIs, and existing model/provider adapters.

**Status:** Proposed implementation, based on source inspection, installed macOS UI inspection, existing tests, and independent synthetic probes. This document does not enable predictions, change product code, start paid model requests, or authorize packaging. Product choices below require review before implementation.

**Plan review (round 2, 2026-10-16):** Source-checked against the current settings facade, loader volatile updates, composer keyboard arbitration, route projection, and test discovery. Ready to begin the isolated feasibility task; inline presentation remains gated on Task 1. Review approval does not establish working product behavior or release acceptance.

## Summary

The feature exists as an experimental foundation, but enabling its current flag would not deliver the requested Codex-style experience. It excludes ordinary conversations, renders a separate banner, and lacks important Host and keyboard guards. Complete those paths before exposing an ordinary-user setting. The default remains off until a user enables suggestions with a clear model-usage notice.

## Contents

- [Observed implementation](#observed-implementation)
- [Product and architecture decisions](#product-and-architecture-decisions)
- [Required behavior](#required-behavior)
- [Implementation tasks](#implementation-tasks)
- [Acceptance and release](#acceptance-and-release)
- [Remaining verification limits](#remaining-verification-limits)

## Observed implementation

Inspection targeted the current working-tree implementation and the running `/Applications/octopus_DSH.app`. No product source/configuration was edited. General Settings was inspected without changing settings or submitting a prompt. Private conversation text and screenshots are not part of this plan or its evidence deliverables.

| Finding | Current source or observation | Consequence |
| --- | --- | --- |
| Disabled by default | `AssistantService.Config.enableComposerPredictions` defaults to false; the installed bundle retains this default | Shipping the source does not activate suggestions |
| Bound-session restriction | `getComposerContext()` returns null unless `isAssistantBound(sessionId)` is true | Ordinary conversations cannot get suggestions through the mounted UI |
| No ordinary-user control | General Settings has no prediction toggle; the Client contains no prediction settings component | Users cannot discover/enable the feature through a dedicated product setting |
| Not reachable through settings | `enableComposerPredictions` is a plain `z.boolean()` Config field, not `.volatile()`; `settings/configForms` returns no field for the namespace and `isVolatilePath` rejects the write | A user toggle cannot persist until the field becomes volatile and is read live |
| Separate banner | The contribution occupies `conversation.input.dock`; `ComposerPrediction.module.css` renders a bordered banner | It does not reproduce inline gray text |
| Global keyboard capture | `ComposerPrediction` listens to `window.keydown` and accepts every Tab while eligible | Other controls, Shift+Tab, and IME input can accidentally accept text |
| Host trusts request state | `predictComposer()` delegates client-supplied context, draft text, and sequence without verifying a completed turn | The Client is the only eligibility gate; a direct request can still trigger inference |
| Short, unstructured context | The Host collects text from the latest completed turn, then the predictor retains only the final three snippets, at most 300 characters each | Original intent, role attribution, tool outcomes, and earlier decisions can be lost |
| Existing useful pieces | Real auxiliary inference, token accounting, cancellation, generated remotes, revisioned insertion, and several stale-result checks already exist | Reuse these; do not build a second prediction runtime |

Existing verification: four focused files passed **24 tests**, exit 0. Independent probes then reproduced **four failures**: adoption outside composer focus, adoption on Shift+Tab, adoption during IME composition, and Host inference for a nonempty draft with a fabricated sequence and no eligible completed turn. The Host probe used the existing synthetic model harness and observed a prediction plus usage attribution; it did not call a paid provider.

Evidence remains under `.plans/composer-predictions-audit/`: `existing-prediction-tests.log`, `adversarial-prediction-probes.log`, reproducible probe sources, and a sanitized native-settings summary. Probe copies were removed from package test directories after execution. These scratch files are not clean-checkout dependencies; implementation must move the relevant regressions into the owning test suites.

References: [existing product design](2026-10-12-persistent-assistants-and-teams-design.md), [Host service](../../packages/experimental/assistant-registry/src/index.ts), [prediction inference](../../packages/experimental/assistant-registry/src/review-prediction.ts), [Client integration](../../packages/experimental/client-ui-assistants/src/client/ComposerPrediction.tsx), and [OpenAI's documented interaction](https://learn.chatgpt.com/docs/features/composer-predictions). OpenAI's private model/request implementation is not assumed here.

## Product and architecture decisions

| Approach | Benefit | Limitation | Disposition |
| --- | --- | --- | --- |
| Complete the existing service and use existing overlay/settings slots | Reuses routing, remotes, usage evidence, and input ownership; can cover ordinary conversations | Requires real editor/layout integration and stronger eligibility | Recommended |
| Enable the current flag and keep the banner | Small activation change | Leaves the reproduced safety defects, scope restriction, and visual mismatch | Reject as a release solution |
| Create an independent prediction package/runtime | Independent lifecycle | Duplicates inference, settings, routing, and billing ownership | Defer unless the existing service cannot support a complete implementation |

Recommended first version:

- Offer suggestions in foreground ordinary chats, private assistant chats, and standing-team coordinator chats. Do not predict inside background child/seat sessions or after cancellation, failure, or a permission question.
- Add one row through `settings.general.item`, the documented seat for a single setting that needs no page of its own, with the Chinese label `显示下一步建议` and the usage notice beside it. Persist the Host flag through the revisioned Settings controller and declare the field volatile so the value is read live; do not add a second browser-only paid-feature switch or a whole settings page.
- Keep suggestions off until enabled. Explain: `根据当前对话生成下一步建议，会使用当前模型额度；Tab 仅填入，不会自动发送`. Do not enable automatic memory review as a side effect.
- Render one short, plain-text suggestion inside the empty input, with a subtle `Tab 采用` affordance and a pointer-accessible adoption action. Preserve normal typing, attachments, and reference chips.
- Reuse the effective conversation route. Never mutate the application default model. A dedicated low-cost prediction route can be a later, explicitly configured option.
- Generate automatically on a newly observed foreground running-to-successful-idle transition. Opening old history must not silently issue another paid request.

All product changes stay in the two fork-owned experimental packages. Verification scripts, generated documentation/catalogs, recorded-session fixtures, and a test-only browser runner under `apps/web/tests/` may change. Do not edit `packages/core`, `packages/client`, `apps/desktop`, or `packages/subagent`. Do not copy the resident editor or import its package-private `ComposerKeyboard` implementation.

## Required behavior

### Host eligibility and context

Use the existing authenticated desktop-owner remote ingress, then verify a live Session, the exact latest completed turn, idle state, and configuration, and build model context from logged events. This remains a single-user Host operation; do not expose it as a delegated model tool or interpret a supplied Session ID as authorization. Remove the assistant-binding prerequisite for ordinary owner-visible conversations while preserving retired/deleted assistant and team restrictions. Removing a binding check preserves the ingress authority and adds eligibility checks: the Session is live in the local Session store, its latest turn completed successfully, the Session is idle, and the effective route resolves. These state checks are not proof of caller ownership; scoped callers, if supported by the ingress, must retain their existing access restrictions. `assertSessionUsable` covers only lifecycle and deletion, and `authorizeSessionSource` is a session-history visibility authority that returns true when caller and target match, so neither is an ownership check to reuse here.

Do not trust `recentTexts` from a remote request as model context. Keep or revise `getComposerContext()` as a bounded eligibility lookup, then independently revalidate the live Session and committed sequence in `predictComposer()`. Update all consumers and generated remotes together. A supplied nonempty draft, including whitespace, is ineligible. The Host can check only the declared draft snapshot; the Client owns live draft/focus checks, revisioned insertion, and cancellation. Typing after dispatch can invalidate output but cannot guarantee that a provider has incurred no cost.

Identify the target turn by Session id and completed-turn sequence. The Host re-derives the latest completed turn from the log and rejects every other sequence, so a forged or stale value cannot reach inference; no separate Host-issued context identity, lifetime store, or new branded wire type is needed. Capture the live Session object on the Host so replacement under the same Session ID cannot validate old work. Capture Client request identity, Session binding incarnation, and draft revision separately, and keep any new cross-process id branded. A rejected stale, unauthorized, disabled, running, or nonempty request must dispatch zero model calls.

Build bounded, role-attributed context from the latest user request, completion summary, relevant prior exchange, and bounded logged outcome summaries. Do not dump arbitrary tool output, file contents, private memory, other team seats, or another conversation into the request. Screen the selected context with the existing `SECRET_PATTERN` before dispatch or auxiliary request logging; a match skips prediction without recording the matched text in diagnostics. This heuristic is not comprehensive secret detection or authorization. Preserve language and user intent. The prompt requests one useful next user message, not another assistant answer, a list, or an unconditional question.

Add a validated `predictionContextMaxBytes` Config field for the complete serialized prediction messages, including prompt scaffolding and role labels. Choose and document its default using the Task 3 CJK/English fixtures; bound event reads and selection before allocating large intermediate strings, and skip when fixed overhead alone exceeds the limit. Use a conservative UTF-8 byte bound in this release; exact tokenizer integration and provider-specific tuning are follow-up work; do not use characters divided by four for Chinese. Existing output and deadline defaults are 150 tokens and 3,000 ms; retain configurability and measure representative providers before changing those defaults. Failure, empty output, invalid output, or timeout produces no suggestion and never blocks typing.

Single-flight equivalent requests across windows, keyed by live Session incarnation, completed sequence, effective route/configuration, and prediction policy. Reuse an eligible successful result rather than issuing duplicate calls. Each subscriber owns only its subscription: closing window A must not abort inference while window B is waiting. Release subscriptions idempotently and abort underlying work when all subscribers release, a turn/route/setting invalidates it, the deadline expires, or the service disposes. Remove listeners and in-flight entries on every terminal path; do not let one subscriber cancellation poison a reusable result. Inspect existing `assistant/auxiliary` evidence to avoid automatically repeating an uncertain interrupted request after reconnect/restart. Use existing events and usage attribution; no new Session event is required by this plan. A response must be rechecked against the current Session/turn before presentation. Resolve the effective current route through existing routing owners — the live `modelSelection` projection (`next`), assistant/seat overrides where bound, and the application default owner when no selection exists — not solely the last historical request header. Include reasoning effort and other effective request configuration in the route comparison. The Host re-resolves it inside `predictComposer` after `runAuxiliaryInference` settles and returns no result on mismatch. Changing the selected route invalidates an old result and must not change the global default.

### Client lifecycle and adoption

Capture the empty draft's `TokenSpan`/revision when requesting a suggestion. Keep Client request identity, Session binding incarnation, committed turn sequence, and draft revision together; the Host separately captures its live Session object and effective route. A result may become visible only when all still match and the complete draft remains empty. A new Session binding, any typing (including whitespace), IME composition, navigation, settings change, submission, or newer turn cancels or invalidates the request.

Acceptance uses `inputActions.insertText(text, capturedSpan)` and checks its boolean result. Do not capture a fresh span to make an outdated suggestion appear current. Do not fall back to `setDraft()` or call `submit()`. A failed insertion must not announce success or overwrite the user's text.

Keyboard ownership belongs to the focused composer. The `conversation.input.overlay` anchor is a sibling of the editor inside the composer card, so editor keydowns never pass through it: attach the listener through `closest('[data-composer-card]')`, in the bubble phase, after the resident editor's Lexical arbitration, and re-check `event.target` against the owning editor. `InputActions` exposes no key-registration member and the package-private `ComposerKeyboard.arbitrate` is deliberately not exported, so Task 1 must verify this ancestor attachment against the real editor. Ignore prevented events, modifier chords, Shift+Tab, IME/composition events, and events whose target is not the owning editor. Existing `/` and `@` menus and normal focus traversal take precedence. Do not depend solely on React state to detect composition; honor `event.isComposing`, legacy `keyCode === 229`, the resident editor's `data-composer-composing` marker (including its delayed clearing after composition end), and committed input state. Bind and dispose the listener with its composer and rebind if the owning editor/card changes.

### In-input presentation feasibility

`conversation.input.overlay` is an existing Session-scoped slot rendered inside the composer card. Its current anchor is positioned at the top of the card with zero height and was designed for floating entries. It is not itself a ready-made ghost-text editor API.

Task 1 must demonstrate that a fork-owned overlay can align to the empty editor, preserve native placeholder behavior, and coexist with attachments, font changes, narrow windows, and light/dark themes. Use the existing `data-composer-card`/contenteditable surface and supported hooks; avoid private generated CSS class selectors, DOM reparenting, or replacement of the Lexical editor. Any temporary DOM listeners/measurement observers must be owned and disposed with that composer. Do not hide the placeholder globally.

If the existing slot cannot satisfy these controls without fragile manipulation, report the specific missing public extension point. Keep a compact dock alternative as an explicit product fallback; do not label it inline ghost text. Any protected-package extension requires separate scope approval before implementation.

## Implementation tasks

Each task follows the same loop: add the named regression, run it red for the intended reason, implement the smallest change, run the owning checks, then make a scoped commit. Do not land a commit containing only failing tests.

### Task 1: Prove the editor integration and lock the visual direction

**Files:** inspect `packages/client/ui-conversation/src/client/{contract/slots.ts,input/editor/keymap.ts,skeleton/InputBar.tsx,skeleton/InputBar.module.css}` without editing; prototype in `packages/experimental/client-ui-assistants/tests/composer-overlay.client.spec.tsx` and an isolated browser fixture.

1. Reproduce the three archived keyboard failures against the current component.
2. Mount the actual resident composer with a synthetic suggestion through `conversation.input.overlay`; do not use a fake textarea as visual acceptance evidence. Read `useSession`, `useInput`, and `inputActions` from its standard Session props: unlike the current dock, the overlay supplies no owner `session`/`input` values.
3. Demonstrate inline placement, native placeholder handling, resizing/font changes, pointer adoption, IME, menu priority, attachments, and both themes. Include actual screenshots and assertions against the resident editor's draft, not only callback spies.
4. Record whether the fork-only path is sufficient. Stop the inline portion if its required public capabilities are absent; do not expand protected scope silently.

**Run:** `pnpm exec vitest run packages/experimental/client-ui-assistants/tests/composer-overlay.client.spec.tsx`. Browser fixture launch must use the supported `dsh` Web profile and the repository's pinned browse-picker overlay where a picker is involved.

**Expected:** intended keyboard failures first; a verified feasible inline composition before promoting prototype behavior. No product-wide enablement in this task.

### Task 2: Make Host requests authoritative and cover ordinary conversations

**Modify:** `packages/experimental/assistant-registry/src/{index.ts,review-prediction.ts,types.ts}`.

**Test:** `packages/experimental/assistant-registry/tests/predictions.spec.ts`; create `tests/composer-eligibility.spec.ts`.

1. Add tests for ordinary/assistant/coordinator success and zero-call rejection of nonexistent, running, failed-turn, stale-sequence, retired-seat, and declared nonempty-draft requests. Separately verify the existing ingress refuses unauthenticated or out-of-scope callers without treating lifecycle checks as authorization.
2. Move context construction and eligibility into the Host request path. Add live identity and output freshness checks; disregard remote text as context.
3. Add deterministic simultaneous-window tests: A and B share one request; A disconnects while B receives the result; both disconnect and the adapter aborts; a turn/route change invalidates both; an old subscriber cannot cancel a newer request. Include a blocked-stream test proving cancellation reaches the actual model adapter through the real remote carrier. A mocked callback receiving `AbortSignal` is insufficient.
4. Revise the existing test that currently expects a prediction with `draftText: 'What are the'` and no completed user turn: that behavior is intentionally removed.
5. Verify request/result evidence and provider-reported usage still reconstruct the actual auxiliary inference. Preserve paid failed/aborted usage when reported.

**Run:** `pnpm exec vitest run packages/experimental/assistant-registry/tests/predictions.spec.ts packages/experimental/assistant-registry/tests/composer-eligibility.spec.ts`.

**Expected:** canonical logged context reaches the recording adapter; every invalid request produces zero calls; duplicate requests produce one call.

### Task 3: Improve bounded suggestion context and output

**Modify:** `packages/experimental/assistant-registry/src/{index.ts,review-prediction.ts}` and the declared request/context types as needed.

**Test:** create `packages/experimental/assistant-registry/tests/composer-context.spec.ts`.

1. Add synthetic Chinese and English conversations where the important original goal occurs before the final three text blocks. Include successful work, unfinished work, and a legitimate next verification step.
2. Preserve message roles and bounded outcomes, serialize the complete auxiliary request, and keep the request inside a conservative UTF-8 byte bound rather than a character count.
3. Require one concise next user message in the conversation language. Reject empty/malformed/over-limit output without inventing a fallback prediction. Do not require nondeterministic wording in unit tests; assert prompt inputs and structural output rules.
4. Verify no foreign scope or unrelated private memory enters the request, and all model-visible prediction context remains in existing auxiliary logs.

**Scope:** retain the existing `maxPredictionTokens` (150) and `predictionTimeoutMs` (3,000) Config defaults. The validated serialized-message byte allowance is required in this task; exact tokenizer integration and provider-specific optimization are deferred. Test the full request limit, fixed-overhead overflow, long CJK text, and secret-screening zero-call behavior.

**Run:** `pnpm exec vitest run packages/experimental/assistant-registry/tests/composer-context.spec.ts`.

**Expected:** relevant earlier intent survives bounded selection; serialized allowances hold for CJK; no extra model requests or tools are invoked.

### Task 4: Add the paid-feature control and update Client state

**Modify:** `packages/experimental/client-ui-assistants/src/client/{mount.ts,index.ts,ComposerPrediction.tsx,locales.ts}`; `packages/experimental/assistant-registry/src/{index.ts,review-prediction.ts}` for the volatile field; existing locale JSON owners; package Host/Client dependency declarations if the settings remote is not already declared.

**Create:** `tests/prediction-setting-row.client.spec.tsx`. Do not create a settings page component; add owner-local styles only if existing primitives cannot express the row.

1. Register one row through `settings.general.item`, the documented seat for a single setting that needs no page, using the existing injected `ctx.configForms` facade and its revisioned Host mirror; follow the existing General Settings row pattern rather than constructing a second remote cache. Use the owning assistant-registry settings namespace and verify it against descriptors. In the Host, expose the namespace through the existing settings registration lifecycle (including `settings.configure({ auto: false }, ctx.fiber)` where needed); preserve headless operation when settings are absent.
2. Declare `enableComposerPredictions` with `.volatile()` and update its TypeScript type to `Volatile<boolean>`. Pass a live getter into the prediction manager and read `.get()` at admission, immediately before dispatch, and after inference settles, instead of capturing a constructor boolean. Subscribe through the owning context to `loader/volatile-update` to cancel prediction work on disable; `Volatile` exposes `.get()`, not a subscription API. Keep prediction cancellation separate from memory-review controllers. Both changes are required: without the volatile declaration `settings/configForms` exposes no field and `isVolatilePath` rejects every write, and without the live read, disabling during inference cannot take effect.
3. Use `ConfigForm.set()` and the existing mirror's serialized revision handling to persist only the intended prediction field; preserve other plugin configuration. Disable the row until the form is ready, writable, and in Host mode; do not persist a paid-feature toggle only in the browser memory fallback. Display the usage notice before enabling. A failed write leaves the previous effective state visible and reports failure.
4. Keep memory review unchanged. Test persistence, cross-window effective state, disabling during inference, and plugin disposal/reload behavior.
5. Replace ad hoc request refs with an explicit request identity/draft-revision lifecycle. Trigger on a new completed foreground turn, not merely mounting a historical idle Session.

**Run:** `pnpm exec vitest run packages/experimental/client-ui-assistants/tests/prediction-setting-row.client.spec.tsx packages/experimental/client-ui-assistants/tests/remediation-dock-lifecycle.client.spec.tsx`.

**Expected:** disabled means zero calls; opting in survives restart; typing and settings changes invalidate the old request; existing claims and drafts survive reload.

### Task 5: Ship inline presentation with editor-safe acceptance

**Modify:** `packages/experimental/client-ui-assistants/src/client/{ComposerPrediction.tsx,ComposerPrediction.module.css,mount.ts}`; add a small `ComposerPredictionOverlay.tsx` if Task 1 demonstrates a distinct presentation owner is useful.

**Test:** existing `prediction.client.spec.tsx` and lifecycle files; promote the archived three keyboard controls and the real-composer fixture from Task 1.

1. Move the visible suggestion into the proven overlay composition; avoid rendering a second banner for the same suggestion.
2. Add focused, bubble-phase keyboard handling and a pointer-accessible alternative, preserving menu arbitration and screen-reader behavior.
3. Use the captured insertion span and clear only after successful insertion. Remove unconditional replacement fallbacks.
4. Verify that IME, Shift+Tab, other-window/control focus, typing then clearing, draft-revision races, failed insertion, turn advance, and conversation switch cannot accept/resurrect stale text.

**Run:** `pnpm exec vitest run packages/experimental/client-ui-assistants/tests/prediction.client.spec.tsx packages/experimental/client-ui-assistants/tests/remediation-dock-lifecycle.client.spec.tsx packages/experimental/client-ui-assistants/tests/composer-overlay.client.spec.tsx`.

**Expected:** all archived negative controls pass; Tab inserts once into the actual editor; no submission or provider turn begins until the user sends the draft.

### Task 6: Verify installed behavior and document the feature

**Modify:** both affected package README pairs, affected generated Config/Cordis catalogs and their bilingual owners where fields or remote signatures change, and existing desktop acceptance gates. Regenerate through the owning generators; do not edit unrelated generated regions. Update `docs/subsystems/agent-team.{md,zh.md}` only if its documented surface changes.

**Create:** `scripts/verify-composer-predictions-installed-flows.mjs`, using the installed runtime closure and an isolated synthetic profile/provider. Add a keyless recorded-session fixture under `snapshots/session/` using a shipped `dsh` profile and real prediction events, plus a discovered browser runner at `apps/web/tests/composer-predictions.snapshot.ts` with fixture data under `snapshots/web/composer-predictions/` for the Tab-accept path. `vitest.web.config.ts` discovers runners under `apps/web/tests/`, not TypeScript files placed in `snapshots/web/`: a session fixture can only reach the Host through a test-only cordis driver, so it cannot exercise the automatic Client trigger or real editor insertion. Follow `snapshots/AGENTS.md`; do not create a new production Node launcher.

1. Verify the actual mounted settings and editor paths against the isolated Host, including ordinary chat. Assert the model request contains real committed context and the actual selected route.
2. Block/release provider responses to prove stale output and cancellation are handled, then accept with Tab and assert a changed editable draft with no new user turn.
3. Verify a cold restart retains opt-in and usage evidence, and opening old history does not repeat paid inference. Test disabled behavior and a deliberate invalid sequence as installed negative controls.
4. Update user documentation, bilingual copy, route/usage notices, and all public consumers changed by the new request fields. No new Session event is planned; acknowledge any actual persistence-type change if implementation discovers one.

**Focused local checks:** run the owning Host/Client prediction suites and scoped coverage over all changed source files with the repository's per-file thresholds; record the exact command and included files. Run both compiler faces, `pnpm run verify-client-ui-i18n`, `pnpm run verify-client-packages`, `pnpm run gen-client-catalog --check`, the affected Cordis/Config catalog gates, `pnpm run verify-no-unknown-casts`, `pnpm run verify-upstream-intake`, focused documentation gates, and `git diff --check`. Run the new keyless Session snapshot and the discovered browser runner explicitly; a generic PONG replay is not prediction coverage. `test:gui` currently selects `packages/client` and `packages/host`, so it does not replace explicit experimental Client tests.

**CI/integration checks:** retain `pnpm run test:coverage` as the exhaustive per-file coverage gate, `pnpm run test:gui` for shared UI regressions, `DSH_SNAPSHOT=replay pnpm run test:web` for built browser replay, and `pnpm run doc-sync`. Use the existing test launcher/filter options for focused local browser evidence. CI owns exhaustive rehearsal unless a failure or repository-wide change requires it locally; report checks not run separately from failures.

**Release checks, only when packaging is authorized:** rebuild the affected Host/Client artifacts, run `bash scripts/verify-desktop-bundle.sh`, mount the produced DMG read-only and execute the installed prediction verifier, then run the Windows installer/readiness/installed-flow workflow against that exact commit. Add the prediction verifier to the build gates so static marker checks cannot substitute for actual inference and acceptance. Record artifact hashes. Native Windows Host acceptance and browser tests do not themselves establish Windows WebView keyboard behavior; require real Windows GUI evidence before claiming desktop interaction parity.

## Acceptance and release

| Control | Required result |
| --- | --- |
| Ordinary chat completes with opt-in enabled | One useful suggestion appears in the empty composer |
| Private assistant/coordinator completes | Same interaction, correct local route and scope |
| User has not opted in | No prediction request or auxiliary billing |
| User types a space, text, or begins IME | Pending/visible prediction is invalidated without changing the draft |
| Tab in focused eligible composer | Editable insertion once; no `submit()` or user turn |
| Shift+Tab, modifier chord, external focus, IME, or prevented key | Normal control/menu behavior; no prediction adoption |
| `/` or `@` menu, attachments, reference chips, blocked/claimed input | Existing editor ownership wins; no damaged content or competing overlay |
| Navigation, newer turn, binding incarnation change, or late response | Stale suggestion cannot render or insert |
| Current model selection changes | Old-route result is invalidated; prediction uses the current effective route without mutating defaults |
| Direct stale/nonempty/unauthorized Host request | Zero inference and no synthetic usage |
| Two windows request the same eligible turn | One provider request; closing one subscriber preserves the other; releasing both aborts the adapter |
| Disable during inference | Prediction request aborts, late output is rejected, memory review is unaffected, real billed usage remains recorded |
| Oversized CJK context or secret-pattern match | Complete message byte limit holds; secret match dispatches zero calls and logs no matched text |
| Provider fails, times out, or returns empty output | Typing remains responsive; no invented suggestion; observed paid usage retained |
| Cold restart or opening old history | Preference survives; no automatic repeat of ambiguous/already-issued paid work |
| Light/dark, larger font, narrow window | Gray text remains legible and aligned without duplicate placeholder/layout shifts |
| Packaged macOS and Windows | Correct artifacts contain the feature; installed negative controls pass |

Accept the feature only after the Host checks, actual editor interaction, and installed paths pass. Existing unit-test success, a configured boolean, or a screenshot of a mock component alone is insufficient.

## Remaining verification limits

This planning round did not enable predictions in the user's profile, submit a paid prompt, rebuild the app, or modify product source. Installed inspection establishes the current controls and bundled code, not a successful installed prediction. The current provider's real prediction latency and the overlay's exact native-editor layout remain implementation acceptance work. No promise is made that increasing the current three-second deadline alone will improve suggestion quality or solve these defects.
