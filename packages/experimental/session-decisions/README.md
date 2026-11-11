---
description: "Installable profile layer adding durable, expiring session questions with one-click desktop answers, for users composing or customizing a profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-session-decisions

English | [中文](README.zh.md)

## Summary

This layer gives a profile's agents one durable, structured way to ask the user a question that survives turns, compaction, and restarts. It inserts the Host decision service, the `request_persistent_question` / `read_persistent_question` tools, and an opt-in `persistent-questions` agent preset; the sibling client face renders the question card. At most one open question exists per Session, and a new one requires the old one to be answered, cancelled, or superseded by fresh user input. The package is published under its experimental name and carries no stability promise.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add the layer to a profile when the model needs a blocking, choice-shaped decision that the user can answer from the desktop or browser composer with one click and that must stay readable after the asking conversation has been compacted.

### Install into a profile

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-session-decisions
dsh plugin --profile <name> remove @deepseek-ai/dsh-experimental-session-decisions
```

The package's `dsh.bundle.patch` applies two layers at reconcile: the Host patch (`cordis.patch.yml`) mounts the decision service behind durable storage, and the preset patch (`preset.cordis.yml`) inserts the opt-in preset row. Removing the layer withdraws both. Without the patch declaration the layer does not activate and the tools stay absent. All limits are optional and validated at startup:

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Feature switch; a disabled service opens no domain and admits nothing |
| `feishuEnabled` | `false` | Opt in to finite-choice notifications through the configured desktop IM connection; requires `desktopIm` and Session persistence |
| `defaultTtlMs` | `86400000` | Default question lifetime (24 h) |
| `closedRetentionMs` | `2592000000` | Closed-record retention (30 d) |
| `maxRecords` | `1000` | Maximum retained records (open and closed) |
| `maxQuestionBytes` | `16384` | Maximum UTF-8 byte length of a question |
| `maxChoices` | `8` | Maximum choices per question |
| `maxChoiceLabelBytes` | `512` | Maximum UTF-8 byte length of one choice label |
| `maxAnswerTextBytes` | `16384` | Maximum UTF-8 byte length of a free-text answer |
| `reconcileMaxEvents` | `100000` | Maximum durable Session events scanned per session at boot reconciliation; exhaustion leaves the remainder honestly unknown |

The active answer card stays visible above the ordinary composer, independent of collapsed tool history. The asking turn ending invalidates the shared question cache immediately; a 15-second background poll also reconciles external state changes. Click a choice to submit it immediately; for a written answer, use the card’s answer field and Send answer. The header question mark is an additional shortcut. After admission or cancellation the active card closes; the saved question remains readable in tool history.

### Optional Feishu answers

Set `feishuEnabled: true` on the `session-decisions` row after configuring the desktop Feishu connection. The desktop owns the sole connection; this feature registers a card consumer on it. A question without an online connection remains answerable on the desktop. Free-text questions stay on the desktop; finite choices use plain-text buttons. Typing in Feishu continues into the existing IM conversation, while buttons answer the original question.

The question record owns publication status. Publication is claimed before sending; a lost send acknowledgment stays unknown and is never automatically resent. Each card binds its platform message, app, tenant, operator, chat, workspace, question revision, and durable authorization generation. Disabling or replacing credentials rotates the generation before credentials are replaced. Ordinary application close retains it for cold restore.

A verified callback uses the same answer reservation and queued Session prompt as a desktop answer. An isolated `decision_answer_receipts` domain reuses IM receipt storage and reconciliation. A receipt failure after reservation leaves the answer unresolved and never prompts again. Admission means the answer entered the conversation, not that a business action completed. After authenticated callback handling, the response replaces the card with a non-actionable rendering; foreign callbacks receive no question content. Offline callbacks are not promised; answer on the desktop after restarting. Synthetic Host tests do not establish permissions or delivery behavior for a real Feishu application.

### What you get

The model gains two agent-scoped tools — ask one expiring question with numbered choices, and read a saved record as JSON after compaction — plus the one-unresolved invariant, a producing-step guard released by step completion or a new authenticated human claim, and answer admission through the ordinary queued prompt path. The Client card serializes actions before the disabled state renders, retains rejected drafts, and keeps the open panel visible during retry reads.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host patch document inserts the service row over the storage plugins; the preset patch inserts one `@deepseek-ai/dsh-agent-preset` row (`preset-persistent-questions`, order 2) that restates the shipped standard child roster plus the `./tools` consumer row and an explicit `@deepseek-ai/dsh-agent-tool-presentation` row pinned to `mode: native`. Later user profile edits of the preset row replace its whole config and are never forced back: a removed consumer stays removed, and a user-selected PTC or both mode keeps advertise-and-refuse semantics. Activation is declarative: an enabled service waits through the framework's dependency gate for the session stack whatever order the composition mounted it in, while a disabled service never demands it. The service owns saving, supersession, expiry sweeps, guard arming, and answer admission; the observers correlate durable Session evidence — a queue edit keeps the replacement pending, follows the tracked text digest, and makes an original-payload retry conflict — and boot reconciliation reads each record's post-anchor durable Session evidence through the public read-only persistence handles: ordinary input supersedes a stale open question across restart, and an answer whose entry reached the log but whose index write failed reconstructs as admitted without a second prompt. Evidence that cannot be verified fails closed: an open question without a usable anchor, without a readable session log, or beyond the scan budget refuses admission (retry answers `reconciliation_required`) while the ordinary cancel and dismiss flows stay available, and a reservation without durable entry evidence degrades to the honest `needs_reconciliation` unknown. `src/client/` owns the card. Source map: `cordis.patch.yml`, `preset.cordis.yml`, `src/`.

</details>

The Session owner must flush the matching human entry before any competing aggregate update can persist it as admitted. Entry evidence still takes priority over dismissal, but waits behind that flush checkpoint; a missing writer or failed checkpoint disables entry indexing and preserves uncertainty. This ordering does not create a transaction between the two stores. One teardown owner drains card operations before closing either the question domain or its receipt domain.

Expiry and retention share one owned timer. Notifications during a sweep or after shutdown do not start another sweep; losing storage while re-arming is contained and reported through the feature availability state.

-----

<a id="model-experience"></a>
## Model Experience

### Persistent questions

#### What the model sees

`request_persistent_question` returns the saved question's decision ID, revision, expiry, and choices, with result text stating the answer-format contract: the answer arrives as a queued user message starting with `Answer to question <decisionId>:`. A question needs zero choices (bounded free text) or at least two; a single-choice question is refused before anything is saved. `read_persistent_question` returns the saved record as JSON without the wire request ID — that correlation identity stays Host-side on the client-facing view — so the question and its answer stay readable after context compaction. Inside PTC programs the question tool refuses with the pinned literal: "Persistent questions are unavailable inside PTC programs. Ask the user in ordinary chat instead."

#### Token effect

Each question adds one tool result (the contract text plus numbered choices) and one queued user message (the answer sentence). The persisted `{ decisionId, revision }` presentation metadata rides result metadata for the client card and costs no model tokens.

#### KV Cache effect

The question tool result appends after the step's reusable prefix; the answer arrives as a later user message. After compaction, the saved record remains retrievable through `read_persistent_question` instead of living in context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits describe what the feature cannot do yet or what needs special operational care. They are current package constraints, not a comparison with other question mechanisms.

- **One open question per Session** — a second question requires the first to be answered, cancelled, or superseded; there is no question queue.
- **Root conversations only** — PTC programs, delegated subagents, sessions with running owned background jobs or live subagent children, and Team teammates (or a Lead with running/provisioning teammates) are refused with an ordinary-chat fallback.
- **User-edited PTC compositions** — a saved preset edit that keeps the tools consumer but selects PTC or both presentation mode relies on advertise-and-refuse: the SDK can advertise the tools, the read tool stays usable, and question creation returns the pinned PTC refusal before saving.
- **Answers are settled from one process** — durable evidence settles reservations, and a restart reconstructs settled facts from each record's durable Session evidence (admissions, supersession); but only the process that owns a Session's live agents observes new events, so a Session answered by a different harness process still reconciles only when that process observes the events. Records created before the context anchor field existed cannot prove context currency from durable evidence: an open one refuses admission as unverifiable (fail closed) instead of staying answerable.
- **Experimental prototype with no stability promise** — the package is public, but its contracts can change freely while it incubates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The generated Typert artifacts in `lib/typert/` are checkpointed; Host wire changes after a regeneration checkpoint require a final regeneration before acceptance. The composition tests keep the feature preset roster synchronized with `packages/bundle/web-app/presets/standard.patch.yml` and pin the offline patch semantics through `applyEntryPatches`, so editing either patch file without the other fails those tests. Root owns the installer pins and shared metadata; manifest dependency changes need a root `pnpm install` sync before acceptance.

</details>
