---
description: "Persistent assistant and team catalog, scoped route selection, and lifecycle registry."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-assistant-registry

English | [中文](README.zh.md)

## Summary

`assistant-registry` is an experimental overlay package providing persistent assistant profiles, saved-team definitions, private conversation bindings, scoped route precedence enforcement, and role system-prompt section injection.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Stage C execution and auxiliary evidence

Rounds own an initially idle Agent through its complete execution interval. Cancelling a slot removes its owned input, retains sibling inputs, aborts active work, and waits for idle before releasing ownership. Slot timeouts follow the same cancellation path. The model request receives the remaining output-token limit; actual input and output usage consume the cumulative allowance, so provider input billing can exceed the remaining allowance before its usage is known. Interrupted active slots recover as uncertain and are never automatically executed again; retained committed replies publish once after restart. Admission identity includes recipients and resolved execution bounds.

Desktop callers use `startRound` for an immediate admission record, poll `getRound` for completion, and call `cancelRound` to stop owned execution. This leaves the serialized carrier channel available for cancellation. The Host `executeRound` method waits for completion; its blocking RPC variant requires a transport that processes concurrent calls. Background execution errors remain visible through `getRound` until an explicit recovery retry, and service disposal cancels and drains started rounds.

Automatic memory review runs once for each successful completed private assistant turn and receives bounded user/assistant text from that turn. Composer context comes from the Host's latest completed-turn observation, not editor revisions. Auxiliary model-visible requests and outcomes are retained as `assistant/auxiliary` session events, with billing records deduplicated by call ID. These events do not create conversation turns. New logs containing this event require a runtime with the assistant-registry event declaration.

Composer predictions provide single-line follow-up suggestions for empty drafts using logged context from the same session. The feature is controlled by `enableComposerPredictions`, a volatile boolean configuration (`.volatile()`, default `false`) that takes effect live on update and immediately aborts active predictions when disabled. Client admission rejects disabled, missing-live-session, out-of-scope, running, stale-sequence, failed-turn, retired-seat, or non-empty draft requests with zero model calls; the separately owned early request is allowed during the matching live turn. Lifecycle, binding, live Session identity, completed turn, and route are revalidated after asynchronous admission, after the durable request checkpoint, before result publication, and before cache reuse. Eligible later subscribers reuse the successful in-memory result without additional inference; existing durable request evidence prevents automatic replay when that result is unavailable. Retired/deleted bindings cancel active inference, while completed provider usage remains logged even when its suggestion is rejected. Predictions use the task's effective model and reasoning selection without an alternate model or extra summarization call. Host context prioritizes the initial user goal, latest request, recent partial conversation excerpts, observed tool failures and results, and the available reply; long replies retain a bounded beginning and ending. Tool excerpts are untrusted evidence, never instructions, and do not imply task success. Runtime and clock injections, unrelated scopes and private memories are excluded. Excerpts are bounded before joining, and both the context response and serialized provider messages obey `predictionContextMaxBytes` (default 8192) with CJK-safe UTF-8 boundaries. Desktop delivery uses the cancellable `streamComposerPrediction` Remote stream, yielding one settled result without holding the serial unary request queue. For opted-in root conversations and team coordinators, one request starts after the visible reply reaches a complete sentence of at least `predictionEarlyMinChars` characters (default 30); if this does not happen, it starts after an eligible completion. Teammate seats and delegated child sessions do not start early requests. A completed turn reuses a still-valid early result without another inference; an abandoned or failed main attempt cancels its suggestion. The early text is approximate and can be ignored by the user. `predictionFirstTextTimeoutMs` and `predictionTimeoutMs` default to 0, disabling both prediction-owned deadlines. Positive values optionally bound waiting for nonblank text and the whole request respectively; reasoning-only chunks do not satisfy a configured first-text deadline. Draft changes and navigation suppress presentation of an early result; new turns, opt-out and service disposal abort the owned request. Provider transport limits still apply. The output ceiling `maxPredictionTokens` (default 1024) includes provider reasoning; the visible suggestion remains a short sentence. Routes that exhaust the output ceiling on reasoning may produce no suggestion. Only normally finished, validated output is presented; timeouts do not automatically retry. Context is pre-screened against secret patterns to cancel model dispatch without inference whenever sensitive tokens appear.

Round journals, read cursors, and auxiliary billing use serialized, atomic, fsynced JSON replacement under the profile writer lease. Loads validate all records before publishing state; invalid files remain untouched and block further writes. Read cursors advance and billing records become visible only after successful persistence. Replayed auxiliary call identities do not bill twice. Usage selectors resolve private conversations and historical team runtime sessions, deduplicate shared session IDs, and exclude each stored session’s inherited fork prefix.

Team avatars retain optional local selection identifiers such as `character:<preset>` and historical `icon:<preset>` strings; an empty value selects initials. The Client owns default avatar rendering. Metadata and model-route changes become effective only after durable storage succeeds. Combined seat edits validate the model before saving any fields, and retired seats cannot be edited. A team's coordinator profile can change before its coordinator seat exists; initialized rosters reject profile replacement to preserve the existing role and conversation identity.

`getTeamActivity` reads a saved team's currently live lead roster, tasks, and interactions. Dormant teams return no activity; reading activity never restores sessions or starts model work. Explicit provisioning repairs a legacy empty roster with its original coordinator profile, preserving an existing lead conversation.

Idle private Sessions with no submitted turns can remove their assistant binding through `clearConversationBinding`; Sessions with history require a new ordinary conversation. Profile and team deletion require the confirmed revision, reject active work, and prevent restoration or identifier reuse. Profile deletion also rejects references from retained teams. Deletion erases reusable configuration and scoped memory while keeping minimal identity tombstones, reserved seat names, and Session logs. Prompt assembly and direct Agent execution reject deleted identities, including after restart.

<a id="model-experience"></a>
## Model Experience

Indirectly, through logged session events and injected dynamic system prompt sections.

#### KV Cache effect

Re-entrant turns reuse cached prefixes; updated role sections take effect from the next request boundary.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Cross-device catalog synchronization and distributed transactions are outside V1.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative.

#### Future directions

Undecided directions include cross-device synchronization, per-seat workspace directories, and realtime voice.

</details>
