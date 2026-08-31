# Agent Note: Ask-data template download and existing-database entry do nothing

Status: implemented

English | [中文](2026-08-31-desktop-ask-data-dead-actions.zh.md)

## Problem

「下载填写模板」used `<a download>` plus a blob URL. Tauri 2 WebView does not run that as a save, so the click had no visible effect. 「高级连接」created a blank data-agent session and called `openSession` without closing the gate. The data-agent workbench trigger lives in `conversation.input.right`, which stays unmounted while the gate hides the composer. Opening that blank unbound session would also have re-registered the gate.

## Decision

`offerAskDataTemplate` tries `showSaveFilePicker`, then still requests `<a download>`, then copies the CSV. The page reports saved, copied, or shows a readonly text box. 「连接已有数据库」replaces the old label, explains that it is for an existing database, calls `onAdvanced`, closes the gate, and records the session id so `sessions.list` does not reopen the page for that session. A current unbound blank data-agent session is reused instead of creating a second one. After the user saves a connection they click 问数 and pick the row. Official `desktop-app` is unchanged.

## Alternatives considered

**Add `session.downloadAskDataTemplate` on official session-controller.** Rejected: a new Remote needs Typert regeneration and a companion rebuild; the overlay Client copy already works after copying `client.js`.

**Keep the gate up and open the workbench in place.** Rejected: the workbench occupant mounts only next to the composer.

## Consequences

Spreadsheet users get a visible template. Existing-database users reach the workbench. Prompt on an escaped unbound session still fails as `session/ask-data-unbound` until they commit a listed source. Coverage is `tests/template.client.spec.ts`, `tests/data-source-page.client.spec.tsx`, and `tests/apply.client.spec.ts`.
