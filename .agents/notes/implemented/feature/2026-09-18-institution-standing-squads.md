# Agent Note: Institution-standing squads exist before chat

Status: implemented

English | [中文](2026-09-18-institution-standing-squads.zh.md)

## Problem

Agent Teams already keeps continuable teammates on a Lead Session, but the only user path was in-chat spawn. 文书组 / 案例组 / 传播部 existed only as composer starter prompts, so a new topic looked like forming a new team. Institution-standing work needs a roster that exists before the conversation.

## Decision

The Host keeps a file catalog (`$DSH_HOME/institution-squads.json`, or `institutionCatalogPath`) of the three product-constant squads. Each row stores an optional Lead `SessionId` and per-seat provider/model overrides. `listInstitutionSquads` drops a Lead id when persistence no longer has that Session. `ensureInstitutionSquad` binds the calling Lead Session and spawns any baked-in seat whose name is not yet on the roster. A later topic is a human prompt on that same Session.

The Client occupies `conversation.hero.agentTeam` with three squad cards. Dispatch creates a Session in the Hero workspace when unbound, titles it, ensures seats, and opens the Lead. Seat dropdowns write the catalog and must show the live teammate model when the Lead is loaded. The header dock remains the collaboration view; its starter buttons stay the ad-hoc 现组 path and still only fill the composer.

`institutionFreshProvider` (default `spawn`) is the continuable provider used for Host-provisioned seats. Official `apps/desktop`, `desktop-app`, and the companion are unchanged.

## Testing

Host specs cover the empty catalog, seat-route persistence, first ensure plus reuse, stale-Lead clearing, teammate-caller rejection, provider-only and model-only seat routes, an empty stored seat object, catalog read/write failures, and unknown squad/seat codes. Client specs cover workspace gating, create-rename-ensure-open, established reuse, seat-model writes, list/rename/ensure/create/seat-update failures, and a busy second-click no-op. The conversation skeleton asserts the new Hero slot is rendered.

## Alternatives considered

**Port open-pstack role→model sheets as the next settings page.** Rejected: pstack routes job types to models. Institution standing is a named roster that exists before chat.

**Create a new Session per topic.** Rejected: that would spawn again and drop standing context.

**Store the catalog only in the Client.** Rejected: the Lead binding and seat routes must survive a Client refresh and remain Host-authoritative.

## Consequences

- The first home-page Agent Team entry is the three standing squads, not the header dock.
- Failed seat names still consume the Team name slot on that Lead; a deleted Lead Session clears the catalog binding so the next dispatch can create a new Lead.
- Typert remotes `listInstitutionSquads`, `updateInstitutionSeat`, and `ensureInstitutionSquad` are part of the experimental Team contribution.
