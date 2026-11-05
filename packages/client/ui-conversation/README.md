---
description: "Target-neutral conversation assembly and browser shell: event and view registries, per-session bindings, input state, slots, and temporary composer takeovers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-conversation

English | [中文](README.zh.md)

## Summary

`ui-conversation` owns target-neutral Conversation assembly and the shared browser shell. It consumes Session Controller `SessionEventLikeEntry` feeds, exposes React-free registries and per-Session bindings through `ctx.uiConversation`, and contributes the `useConversation`, `useInput`, and `inputActions` standard props through `ctx.uiSession`. It also owns the per-session durable image URL cache: `ctx.uiConversation.imageUrl(sessionId, attachment)` resolves one session-authorized browser URL per attachment and revokes it with the Session binding, so every Conversation target shares one `session.attachment` read. Concrete targets such as Chat are separate packages that register their own Definitions, snapshot builders, Views, and renderers.

## Table of Contents

- [Conversation assembly](#conversation-assembly)
- [Shell and standard props](#shell-and-standard-props)
- [Temporary composer entries](#temporary-composer-entries)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="conversation-assembly"></a>

## Conversation assembly

`UiConversation.events` is the single registry for event Definitions, and `UiConversation.views` is the single registry for target snapshot builders. Both registries reject duplicate keys, preserve registration order, return idempotent disposers, and rebuild existing bindings when their contribution roster changes. `UiConversation.binding(bindingOrSessionId)` returns one identity-stable Conversation binding for the current Session Controller binding. It does not open another event source.

The adapter passes each `SessionEventLikeEntry` directly to the assembler. Its outer `type` distinguishes durable events from Client-only transient events, while its inner `event` always exposes `type`, `seq`, `time`, and `data`; Definitions receive that inner `SessionEventLike`. Replacement windows may include both entry variants, while historical prepends carry durable entries and live appends may carry either. Every Definition uses the same `match` and `update` methods for both event forms, while `start` receives only a durable event and the assembler rejects a transient start. Definitions that do not consume Assistant deltas return `null` for `assistant/live-chunk`. Replacement windows and revision gaps rebuild from the complete loaded window; contiguous append, prepend, and Assistant-settlement revisions use incremental assembly. Settlement removes only the named attempt's transient matches, applies its optional durable entry, and replays the affected Contexts and dependents without replacing unrelated target nodes. The assembler owns Context matching, Turn/Step locations, target node materialization, target activity, and stable target sources. `ConversationSnapshot` contains only target-neutral views and active-target facts; Session lifecycle state remains in `SessionSnapshot`.

A target becomes active when shell selection resolves it or when its source receives a first subscriber. The assembler replaces that target from current Contexts once and keeps it active for later incremental flushes; creating a source does not activate it and unsubscription does not deactivate it.

Target packages declaration-merge their snapshot and Location data maps, then register with `ctx.uiConversation.events.register(...)` and `ctx.uiConversation.views.register(...)`. A target reads its Session-owned source with `ctx.uiConversation.binding(binding).target(targetId)`. Registrations are Cordis effects and their returned disposers remove the contribution from the same registry. The shared request inspection serves every target: `ctx.uiConversation.inspectSystemPrompt(previous, event)` interprets system messages and positional replacements as immutable loaded-surface state. It selects the last nonempty surviving system node in surface order, retains only surviving replacement positions for chained rewrites, and withholds the prompt after an unindexed older endpoint until prepend replay supplies its order. Target-owned Definitions retain historical cards independently. `ctx.uiConversation.inspectRequestPrompt(previous, header, system)` classifies request changes against that effective prompt; ordinary messages and stream chunks require no system-state work.

<a id="shell-and-standard-props"></a>

## Shell and standard props

The package registers the optional-Session `conversation` shell, strict Session header/body entries, View list, composer chain and bar, input regions, Hero regions, an optional `conversation.atmosphere` plate, queue dock, draft persistence, and phase calculation. `ctx.uiSession.provide()` materializes the Conversation and input sources from the same Session binding and supplies `inputActions` as a stable standard prop.

View selection is deterministic: a registered persisted selection wins, otherwise registered `chat` wins, otherwise no View renders. It never chooses the first registered View. Shell phase combines Session lifecycle with the active-target set; no target-specific snapshot is read by the shell.

The shell reads the persisted View preference before rendering when a Session first binds or a cached Session becomes current, activates the registered preferred View or Chat fallback, and activates later tab or focus selections before committing them to the store. A blank Session still omits the `conversation.view` slot; no unselected target is activated.

The resident composer survives no-Session and Session transitions. The no-Session state keeps the same composer surface mounted but inert while the Workspace picker connects a blank Session. The surface is a shell-owned Lexical editor: reference chips are atomic decorator nodes carrying the owner's serialization identity (submission expands them through the owner codec), claimed slash commands stay styled leading text, folder text references carry the folder glyph as an icon prefix, and the draft's clipboard projection is mirrored into the per-Session Conversation store. Queue operations address exact queue occurrences through the scoped `ctx.conversation` service; queue previews render sent text through the shared inline reference projection from `ui-primitives` (wire session forms fold to their label) and show local or durable images and files in original attachment order. Images use thumbnails; files use compact name-and-size cards. An edit exposes the literal sent text, and durable thumbnails resolve through the session image URL cache. Busy Enter behavior is stored in the Host-backed `ui-conversation` settings namespace.

Ordinary sends occupy one `sending` phase and keep the complete draft, reference chips, quotes, attachments, and undo history until Host acceptance. The editor stays read-only during that attempt. Acceptance clears the document and history; refusal returns the unchanged draft to editing. `sendSession` reserves a private submission identity before image serialization and publishes its echo only after acceptance. Placement still derives from the captured delivery mode and running state. Images use the browser native `FileReader` data-URL path; generic files cite staged receipts, also used by command submissions. Queue/history observation retires the identity once and transfers previews to the durable cache or releases file cards. Generic files retain their FIFO upload queue and the configured `maxConcurrentFileUploads` limit, default two; removal skips queued transfers or aborts active transports. Continuable children keep their independently minted request ids and omit local echoes.

After Host acceptance, a queued local echo can remain until its matching queue projection arrives. Its edit, remove, and steer actions stay disabled during that handoff; the Host row enables actions under the usual content and running-state rules. Refusal keeps the draft and its attachments. A later receipt error cannot roll back an already observed accepted input.

Phone and tablet composers do not autofocus. Only an accepted draft clear moves focus to the non-editable composer card, preventing the virtual keyboard from reopening; refusal retains editor focus. Selected quotes are atomic draft nodes and serialize as ordinary multiline Markdown, with resource markers inside quotes kept literal.

Disabled Send and Stop buttons suppress their tooltips, including a Stop button that becomes a disabled Send button when the turn ends. While a normal composer is running, its primary pointer action remains Stop when the draft is empty or input is unavailable. Actionable text or attachments switch the same seat to Send; clearing or successfully submitting the draft restores Stop. The busy-Enter setting selects the Queue or Steer delivery for ordinary Sessions and continuable children, and the running Send button delivers through the same mode plain Enter resolves to; while it is enabled (no upload pending) over a plain message draft its label names that mode (Queue message or Steer message), so the setting governs Enter and the button together while Cmd/Ctrl+Enter still uses the other mode, and idle sessions, empty drafts, and `/` command lines keep the plain Send label. Their QueueDock rows share Edit, Remove, and Steer, and an empty draft shares the steer-all chord. One-shot children remain read-only. Plan mode and active goals do not change attachment intake. Continuable children keep separate Send and Stop actions but expose no paperclip, paste, or drop intake; if their parent is offline, Send and the composer gestures lock while QueueDock controls for the live inbox remain available ([decisions](../../../.agents/notes/archived/bug-fix/2026-08-20-running-draft-primary-send.md), [inbox controls](../../../.agents/notes/archived/feature/2026-08-27-continuable-subagent-human-inbox-control.md)).

<a id="temporary-composer-entries"></a>

## Temporary composer entries

`conversation.composer` is a generic chain. Its complete owner currency is:

```ts type-equiv
/** Owner values used to elect a composer takeover. */
interface ComposerChainProps {
  /** Current Session identity used by temporary business-owned entries. */
  sessionId: SessionId | undefined
  /** Current Session lifecycle state, absent without a selected Session. */
  session: SessionSnapshot | undefined
  /** Effective business-owned interaction awaiting the user in this Session. */
  pendingInteraction: SessionPendingInteraction | undefined
}
```

A business package may install one entry only while a Remote waterfall request is pending:

```tsx
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChainSelect, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface Request {
  readonly sessionId: SessionId
}

type RequestComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: Request }

const select: ChainSelect<ComposerChainProps, Request> = owner =>
  owner.sessionId === request.sessionId ? request : null

const dispose = ctx.slots.register(
  { name: 'conversation.composer', select },
  RequestComposer,
)

try {
  return await request.result
} finally {
  dispose()
}
```

The selector must be a pure function of the owner currency. Its non-null return is delivered to the component as `matched`; `PropsRuntime<'conversation.composer'>` supplies the standard Session and global props. Chain order remains ascending `priority`, then registration order, and the first non-null selector wins. The shell keeps the default composer mounted beneath a takeover. Request state, listeners, response encoding, and any request-specific child slots belong to the business package; they are not carried by `SessionSnapshot` or declared by this core package.

<a id="model-experience"></a>

## Model Experience

None, as this package renders browser state and sends user-admitted inputs through Session Controller APIs without constructing model requests.

#### KV Cache effect

None; Conversation assembly and browser input state do not alter provider-side prompt caching.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only registered targets can render** — the shell deliberately has no implicit fallback target beyond the registered `chat` preference.


<a id="dev-note"></a>

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Conversation Definitions, target builders, and Views are already validated by their owning registries and the Slot ledger.
