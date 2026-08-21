# Agent Note: Narrow dialog layout and focus ownership

Status: implemented

English | [中文](2026-08-20-narrow-dialog-layout-and-focus.zh.md)

## Problem

The settings dialog keeps a 188-pixel navigation rail when an interactive client renders inside a narrow VS Code Activity Bar webview. The content column then collapses below the width its controls and explanatory copy require, producing character-by-character wrapping, overlap, clipping, and horizontal scrolling. In the compact sidebar rail, the Settings trigger also removes its visible text without retaining an accessible name.

The shared `Modal` primitive and the settings dialog declare `aria-modal="true"` without owning keyboard focus. Opening a dialog can leave focus on a control behind its mask, Tab can reach background controls, and closing does not reliably return focus to the opener. Nested dialogs also need one unambiguous keyboard owner.

## Decision

At viewport widths up to 640 pixels, the settings dialog uses one vertical column: its navigation is a compact horizontally scrollable row above the content, while the content retains the full dialog width. Wider viewports retain the two-column layout. The compact trigger retains its translated label as visually hidden text.

The shared `useModalFocus` hook captures the opener, selects an initial focus target, keeps Tab and Shift-Tab within the topmost `aria-modal` dialog, routes Escape only to that dialog, and restores the opener when the dialog unmounts. The shared `Modal` primitive and the settings shell both use this owner so nested dialogs follow the same rule.

## Alternatives considered

**Require users to widen the Activity Bar.** The extension cannot assume or control that layout, and its default-width view must remain usable without rearranging VS Code.

**Shrink the navigation rail but retain two columns.** Labels still consume most of a 300–400-pixel webview and leave feature settings too narrow, so this delays rather than removes the failure.

**Patch focus in each dialog.** Independent document listeners drift and conflict for nested dialogs. One reusable owner gives every dialog the same initial-focus, containment, Escape, and restoration behavior.

## Verification

Stylesheet tests pin the narrow single-column rules. Component tests pin the compact trigger's accessible label, focus entry, both Tab wrap directions, topmost nested ownership, Escape, and opener restoration. The directory-browser suite keeps its nested-dialog and immediate refocus paths under the shared owner. The packaged VSIX loads at the default VS Code Activity Bar width and exposes the compact Settings trigger by name in the VS Code accessibility tree. A keyless Chromium test exercises settings and directory dialogs through the same built webview composition.

## Consequences

Settings cards retain their usable width in narrow clients at the cost of one horizontally scrollable navigation row. Topmost focus ownership follows document order among mounted `aria-modal` dialogs, matching body-portaled child dialogs and the settings shell. A consumer that renders a visually higher dialog earlier in document order aligns its portal order rather than adding another keyboard listener.
