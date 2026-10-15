---
description: "Persistent assistants directory, conversation header, drawer, and example chips"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-client-ui-assistants

English | [中文](README.zh.md)

## Summary

`client-ui-assistants` provides browser UI components for persistent assistants: an assistant directory panel in the sidebar, home cards rendered through the hero squad child seat, an assistant conversation header with a details drawer, and role-specific example chips in the composer input dock.

The directory loads assistants independently of teams and model discovery. Failed auxiliary loads show an error while preserving saved assistant cards. A failed save keeps the entered draft and displays the error; a pending initial assistant query shows a loading message instead of an empty catalog. Archived entries remain available through the management views.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Behavior

Assistants and standing teams support colored initials or bundled preset icons in their creation and editing forms. Avatars make no external image requests and provide no image upload. Team views include roster editing, member model overrides, and shared memory; assistant details include private memory. Archived memories remain visible for restoration, and removing memory explains that earlier conversation history is retained.

Opening a standing-team roster is read-only, including before its first task. The panel displays saved members immediately and observes existing live activity while open; it does not provision sessions or run models. Starting a task requires an explicit action. Loading, saving, routing, and task-start failures remain visible; failed saves preserve drafts for correction.

The browser entry declares `remote` before mounting the generated contribution, then registers UI in a child scope that requires `remote.assistants`. Composer predictions request completed-turn context from the Host and pass cancellation through the native Remote signal. Typing, navigation, running turns and teardown discard pending suggestions; the same completed-turn suggestion is not requested again after typing. Adoption inserts editable text through input actions and never submits a prompt.

<a id="model-experience"></a>
## Model Experience

Indirectly, through conversation-scoped model route controls and user prompt insertion from role-specific example chips.

#### KV Cache effect

Prompt insertions via example chips modify draft text before submission and do not affect cached prefixes until admitted.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Shadowing the session model seat (`conversation.input.model`) was evaluated as not viable without an upstream edit to `ui-model-selection`; conversation-scoped model overrides are controlled via the conversation header and details drawer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative.

#### Future directions

None.

</details>
