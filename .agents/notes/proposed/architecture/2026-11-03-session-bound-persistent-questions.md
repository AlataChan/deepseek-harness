# Agent Note: Session-bound persistent questions

Status: proposed

English | [中文](2026-11-03-session-bound-persistent-questions.zh.md)

## Problem

An agent can ask a question in chat, but ordinary chat alone does not identify an expiring question, expose pending status across conversations, or bind an external answer to the asking Session. A second task runtime would add execution concepts before the human-led workflow needs them.

## Proposal

Keep Sessions and native Teams as the execution owners. Add optional structured question records attached to Sessions, with the Session log owning admitted answers. Use the existing queued human prompt path; accepted human input remains visible even when the question subsequently becomes stale. Admit no second prompt while the first submission is unresolved.

Store each question as one aggregate, with no transaction spanning the question record and Session log. Reconstruct admission from exact Session identity and request identity, and preserve uncertainty when durable evidence is insufficient. Private question-record upgrades belong to the feature runtime.

An authenticated desktop or verified card answer carries full human authority under existing Goal rules. Publishing a question stops automatic Goal continuation; the answer turn may resume an active disarmed Goal. It does not bypass permissions or authorize resuming a truly paused Goal.

Extend the existing desktop Feishu connection through generic ports without importing this desktop feature into the multi-tenant IM service. Keep typed IM conversation routing separate from card answers. Reuse receipt storage and reconciliation rather than creating another delivery pump.

## Alternatives considered

**Ordinary chat alone.** It already survives restart, but lacks structured expiry, cross-session pending status, and a verified card-to-question binding. Keep it as the fallback when delegated work makes persistent waiting unsafe.

**A separate task runtime.** Task attempts, dependency scheduling, and another task board add state and recovery obligations without being required for the initial human-led conversation workflow. Reconsider only for a concrete event-driven or unattended workload.

**A second answer-delivery pipeline.** A dedicated queue duplicates Session admission and existing IM receipt behavior, creating competing owners for accepted answers. Keep transport receipts as delivery evidence and the Session as answer authority.

## Acceptance criteria

Real Host tests cover queued answer identity, edits, cancellation, expiry, supersession, both teardown orders, and crash recovery with Session search disabled. An accepted answer is never silently filtered or automatically replayed. Package lifecycle tests cover late dependency arrival and removal. Independent source review and a fresh installed desktop artifact verify the complete feature.

## Risks

Question storage and Session persistence can disagree after interruption; the UI must expose uncertainty without claiming that an external action did not occur. A full-human answer may permit model-driven Goal continuation. Feishu answers require the desktop to remain online until real platform evidence supports stronger delivery guarantees.

An observed entry must pass the Session owner’s flush checkpoint before its aggregate can persist admission, including updates already queued by competing actions. Preserve synchronous evidence priority while waiting. On checkpoint failure, disable entry indexing rather than publish unsupported admission. Drain admitted card callbacks before closing either owned domain; separate Cordis effects may unload concurrently.
