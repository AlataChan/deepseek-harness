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

Round journals, read cursors, and auxiliary billing use serialized, atomic, fsynced JSON replacement under the profile writer lease. Loads validate all records before publishing state; invalid files remain untouched and block further writes. Read cursors advance and billing records become visible only after successful persistence. Replayed auxiliary call identities do not bill twice. Usage selectors resolve private conversations and historical team runtime sessions, deduplicate shared session IDs, and exclude each stored session’s inherited fork prefix.

Team avatars retain optional local selection identifiers such as `character:<preset>` and historical `icon:<preset>` strings; an empty value selects initials. The Client owns default avatar rendering. Metadata and model-route changes become effective only after durable storage succeeds. Combined seat edits validate the model before saving any fields, and retired seats cannot be edited. A team's coordinator profile can change before its coordinator seat exists; initialized rosters reject profile replacement to preserve the existing role and conversation identity.

`getTeamActivity` reads a saved team's currently live lead roster, tasks, and interactions. Dormant teams return no activity; reading activity never restores sessions or starts model work. Explicit provisioning repairs a legacy empty roster with its original coordinator profile, preserving an existing lead conversation.

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
