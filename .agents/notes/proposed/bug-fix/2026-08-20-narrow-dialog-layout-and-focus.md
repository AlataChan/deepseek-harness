# Agent Note: Narrow dialog layout and focus ownership

Status: proposed

English | [中文](2026-08-20-narrow-dialog-layout-and-focus.zh.md)

## Problem

The settings dialog keeps a 188-pixel navigation rail when an interactive client renders inside a narrow VS Code Activity Bar webview. The content column then collapses below the width its controls and explanatory copy require, producing character-by-character wrapping, overlap, clipping, and horizontal scrolling.

The shared `Modal` primitive and the settings dialog declare `aria-modal="true"` without owning keyboard focus. Opening a dialog can leave focus on a control behind its mask, Tab can reach background controls, and closing does not reliably return focus to the opener. Nested dialogs also need one unambiguous keyboard owner.

## Proposal

At viewport widths up to 640 pixels, the settings dialog uses one vertical column: its navigation becomes a compact horizontally scrollable row above the content, while the content retains the full dialog width. Wider viewports retain the two-column layout.

A shared modal-focus hook captures the opener, selects an initial focus target, keeps Tab and Shift-Tab within the topmost `aria-modal` dialog, routes Escape only to that dialog, and restores the opener when the dialog unmounts. The shared `Modal` primitive and the settings shell both use this owner so nested dialogs follow the same rule.

## Alternatives considered

**Require users to widen the Activity Bar.** The extension cannot assume or control that layout, and its default-width view must remain usable without rearranging VS Code.

**Shrink the navigation rail but retain two columns.** Labels still consume most of a 300–400-pixel webview and leave feature settings too narrow, so this delays rather than removes the failure.

**Patch focus in each dialog.** Independent document listeners drift and conflict for nested dialogs. One reusable owner gives every dialog the same initial-focus, containment, Escape, and restoration behavior.

## Acceptance criteria

The settings sections remain readable and operable in the default-width VS Code Activity Bar and retain the existing wide layout in a browser-sized viewport. Unit tests pin the narrow stylesheet rules, focus entry, both Tab wrap directions, topmost nested ownership, Escape, and opener restoration. A rebuilt VSIX passes the same real VS Code workspace, settings, and directory-dialog smoke paths.

## Risks

Topmost ownership follows document order among mounted `aria-modal` dialogs, matching body-portaled child dialogs and the settings shell. A consumer that renders a visually higher dialog earlier in document order would need to align its portal order rather than adding another keyboard listener.
