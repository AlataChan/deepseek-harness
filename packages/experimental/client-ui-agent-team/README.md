---
description: "Use and debug the experimental Web Agent Teams roster, shared task board, and teammate navigation panel."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-agent-team

English | [中文](README.zh.md)

## Summary

This package adds a Team roster action to the Web conversation header (Chinese trigger「团队协作」, English「Team」, brand subtitle Agent Team) and the three institution-standing squads on the blank-session Hero. Users inspect members, manage the shared task board, and open durable teammate conversations. Opening a Hero squad creates or reuses that squad's Lead Session, provisions the baked-in seats once, and does not spawn a new team for a new topic. The panel copy contrasts standing institution teammates with ad-hoc in-chat teams and one-shot subagents; starter-prompt fill buttons only call `inputActions.setDraft` (no auto-send). It reads authoritative Team state through the generated `ctx.remote.agentTeams` contribution and keeps ordinary child-history navigation on the stable addressed-subagent path. Choose it for the experimental source-checkout Web profile; official releases exclude it. The browser projection does not extend the stable API Proxy, store Team state, or register model-facing input.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install the package through [`@deepseek-ai/dsh-experimental-agent-team-web-profile`](../agent-team-web-profile/README.md) after the stable Web bundle and the Host-side Agent Teams profile. The Web Client loader mounts the `/client` export; the root Host export is inert, and the package has no user configuration fields.

octopus_DSH desktop also seeds this package from [scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json). Its `cordis.patch.yml` is the dual-face desktop bundle document: it disables the overlapping global continuable-child controls, inserts the Host Team service and tools, then inserts this package so the Client half mounts. Headless and source Web keep using `agent-team-profile` + `agent-team-web-profile` instead of this seed path.

### Dispatch a standing institution squad

The Hero row occupies `conversation.hero.agentTeam`. It lists 文书组 / 案例组 / 传播部 from `agentTeams/listInstitutionSquads`. Dispatching a squad creates a Session in the chosen workspace when the catalog has no Lead, titles it, calls `agentTeams/ensureInstitutionSquad` so missing seats are spawned once, and opens that Lead. A later topic is a prompt on the same Session. Seat model dropdowns call `agentTeams/updateInstitutionSeat` and `session/modelCatalog`; the displayed model is the catalog route, or the live teammate model when the Lead is loaded.

### Inspect and navigate the roster

Opening the panel calls `agentTeams/view`. Roster rows show durable names, runtime status, model, and diagnostics. Selecting a healthy teammate refreshes the existing direct-child catalog and opens the ordinary `{ parentSessionId, childSessionId, mode: 'continuable' }` address. History and later human prompts continue through the stable addressed-subagent conversation path; this package adds no Team-specific address field.

### Manage the task board

The task board shows task identity, owner, blockers, readiness, advisory write scopes, and overlap warnings. A user can create, edit, assign or unassign, complete, reopen, and delete tasks through `agentTeams/createTask` and `agentTeams/updateTask`. Every update sends the displayed revision, and create or update rejections remain explicit business results.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client export mounts the generated `ctx.remote.agentTeams` contribution from [`@deepseek-ai/dsh-experimental-agent-team/remote`](../agent-team/README.md), then registers its locale dictionaries, the conversation-header dock, and the Hero institution row through Cordis effects. Disposing the plugin fiber removes those registrations.

Starting a create or update invalidates older refreshes. Success reloads the complete Team view so every task's derived fields stay current. A `team-task-conflict` result displays a stale-state notice only after that reload succeeds; a reload failure remains visible instead. Editing task text or scopes and changing dependencies use two sequential compare-and-set mutations because the Team service exposes them as separate actions.

| File | Role |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | Generated Remote, locale, navigation, and slot registrations |
| [`src/client/InstitutionSquads.tsx`](src/client/InstitutionSquads.tsx) | Hero standing-squad cards |
| [`src/client/TeamAction.tsx`](src/client/TeamAction.tsx) | Roster and task-board interaction state |
| [`src/client/locales.ts`](src/client/locales.ts) | English and Chinese panel copy |
| [`src/index.ts`](src/index.ts) | Inert Host entry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent Teams Web profile](../agent-team-web-profile/README.md) — the source-checkout bundle that mounts this Client plugin.
- [Agent Teams service](../agent-team/README.md) — authoritative roster, task, and Remote behavior.
- [Conversation UI](../../client/ui-conversation/README.md) — the stable header slot and addressed-subagent navigation surface.
- [Experimental packages](../README.md) — incubation status and release exclusion.

-----

<a id="model-experience"></a>
## Model Experience

None, as this browser projection and task control surface registers no model-facing input.

#### KV Cache effect

No direct effect; the Team tools and ordinary conversation submission own any later model-visible use.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Snapshot refresh** — the panel refreshes on open, explicit refresh, and mutations; it has no live event subscription or mailbox timeline.
- **Ordinary child continuation** — a human message sent after navigation uses the stable addressed-subagent prompt path, not the Team peer mailbox.
- **Dock cannot spawn** — the header dock still cannot create, rename, delete, or interrupt teammates. Standing seats are provisioned from the Hero institution row. Write scopes remain advisory metadata.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. RPC is authoritative and the package owns only one disposable slot registration.
