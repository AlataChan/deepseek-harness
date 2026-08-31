# Agent Note: Ask-data start must not reuse a bound session

Status: implemented

English | [中文](2026-08-31-desktop-ask-data-rebind-session.zh.md)

## Problem

「开始提问」passed the current Session id whenever the row was blank. After the first bind the Session is still blank, so the second listed source called `commitAskData` with that id and the Host rejected it as already bound to a different source. Clicking the already-bound source closed the page and showed the empty hero.

## Decision

The gate passes `currentBlankSessionId` only when the current Session is blank and unbound. A bound Session is passed as `currentBound`. The page opens that Session when the picked source matches; a different source omits `sessionId` so `commitAskData` creates a new Session. Official session-controller stays one Session, one source.

## Alternatives considered

**Let Host rebind a blank Session to another source.** Rejected: `commitExisting` already owns one bind per Session; overlay Client must not send a bound id for a different source.

**Replace per-row 「开始提问」 with one page-level start.** Rejected: two buttons were two sources; the failure was the reused Session id, not the extra control.

## Consequences

A second source starts a new Session instead of painting `already bound to a different source`. Same-source start on the bound Session does not call commit. Coverage is `tests/apply.client.spec.ts` and `tests/data-source-page.client.spec.tsx`.
