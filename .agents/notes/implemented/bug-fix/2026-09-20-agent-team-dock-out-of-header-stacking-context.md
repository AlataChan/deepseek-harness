# Agent Note: The Agent Team dock escapes the conversation header stacking context

Status: implemented

English | [中文](2026-09-20-agent-team-dock-out-of-header-stacking-context.zh.md)

## Problem

The 团队协作 panel painted below the transcript. Transcript text, links, and table rows showed through the dock, and its unpinned backdrop never appeared.

`ui-conversation`'s `ConversationRoot` composes `.header` and `.body` as siblings, and both declare `position: relative` with `z-index: 1`. `.body` follows `.header` in document order, so at equal `z-index` every pixel of `.body` paints above the whole `.header` subtree. The client-ui-agent-team dock registered into the `conversation.session.header.actions` slot, which renders inside `.header`, and its `position: fixed; z-index: 121` competed only inside the header's stacking context — a descendant z-index cannot outrank a sibling stacking context. The dock reached the viewport edges correctly because no ancestor carries a transform, which made the defect look like a missing background rather than a trapped layer.

## Decision

`TeamAction` portals the dock and its backdrop to `document.body` with `createPortal`, so `position: fixed` stays viewport-relative and `z-index` competes at the root. This is the idiom the repository already uses for viewport overlays: `ui-primitives` (`Modal`, `Menu`, `Toast`, `HoverCard`, `OnboardingSurface`) and `ui-chat` (`TurnUsagePanel`).

`react-dom` is a `PLATFORM_MODULES` baseline entry, so the browser half requests it without a manifest change; the package keeps its existing `devDependencies` entry and gains `@types/react-dom`.

The trigger button stays in the header slot. Only the two overlay nodes move, so slot ownership, resize handling, pinning, and the auto-refresh interval are unchanged.

## Alternatives considered

**Raise `.header`'s `z-index`.** Rejected: it changes a stable `ui-conversation` layer to serve one experimental overlay, and the header would then have to outrank the composer seat (`z-index: 9`), the width handles (`z-index: 8`), and markdown sticky code banners (`z-index: 6`) — all of which are raised inside `.body` for their own reasons.

**Drop `z-index: 1` from `.header`.** Rejected: the header positions its own `::after` rule against that context, and the change would silently reorder the header against the atmosphere plate.

**Render the dock into `ui-layout`'s `shell.overlay` slot.** Rejected: that slot belongs to another package's declaration, and the dock must mount under any shell that provides the header slot.

## Consequences

The dock and backdrop paint above the application frame (their `z-index: 121` outranks the frame's `shell.overlay` layer at `z-index: 20`) and below the modal and toast tiers (`z-index: 1000` and `1100`). Closing the dock removes the portaled nodes with the same conditional render as before.

`packages/experimental/client-ui-agent-team/tests/team-action.client.spec.tsx` asserts that both nodes are children of `document.body` and that the plugin's own container holds no `[data-team-dock]`. The case fails against the pre-fix render, which kept the dock inside the slot container.
