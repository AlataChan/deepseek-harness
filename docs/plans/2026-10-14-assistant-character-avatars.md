# Assistant Character Avatars Implementation Plan

English | [中文](2026-10-14-assistant-character-avatars.zh.md)

**Goal:** Ship the approved Seaside Friends default and optional Soft Robots for assistants and standing teams.

**Architecture:** Extend the shared `EntityAvatar` and `AvatarPicker` in `client-ui-assistants`. Bundle eight decorative SVG portraits with the Client; persist selections in the existing optional avatar string. Undefined values use the seaside whale, while historical empty values retain initials and historical icon selections remain readable. No Host operation, session event, dependency, or application logo changes.

**Tech stack:** React, TypeScript, CSS Modules, existing theme tokens, Vitest and browser verification.

## Approved design

Seaside Friends contains a leaf-fin whale, seal, jellyfish and hermit crab. Soft Robots contains four rounded faces with distinct antennae, ears and expressions. Both sets use expressive faces, rounded outlines and restrained pastel fills. The selector presents the two named series, marks Seaside Friends as default, and retains a separate initials choice. The rejected geometric-spirit direction is excluded.

## Task 1: Selection and compatibility

Write failing tests in `packages/experimental/client-ui-assistants/tests/character-avatar.client.spec.tsx` for default rendering, eight selectable characters, legacy icons and initials, keyboard selection, disabled controls and separate form radio groups. Run that file and confirm the missing character implementation fails. Add the internal portrait renderer and extend `EntityAvatar.tsx`, its CSS and localized dictionaries. Default new forms to the seaside selection without rewriting existing catalog records.

## Task 2: Mounted forms and persistence

Update assistant creation, detail editing, team creation and team editing to distinguish an absent avatar from an explicitly saved initials selection. Update the existing avatar tests for character selections and failed-save retention. Run both avatar suites plus mounted workflow tests; preserve the existing durable catalog and Remote operations.

## Task 3: Visual and release verification

Inspect both series at 26px and 40px in light and dark themes using the actual components and theme CSS. Check keyboard focus and narrow form layouts. Update the package README pair, run Client compilation, localization, package checks and focused tests, and build the Client bundle. Add a desktop bundle assertion for both series, rebuild the DMG and run the installed lifecycle verifier. Retain logs and visual evidence under `.plans/persistent-assistants/character-avatars/`.
