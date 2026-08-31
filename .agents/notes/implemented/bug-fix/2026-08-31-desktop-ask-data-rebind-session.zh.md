# Agent Note: Ask-data start must not reuse a bound session

Status: implemented

[English](2026-08-31-desktop-ask-data-rebind-session.md) | 中文

## Problem

「开始提问」只要当前会话还是空白，就会把该会话 id 传给 `commitAskData`。第一次绑定之后会话仍是空白，再点名单里另一份源就会撞上 Host 的「已经绑到另一份源」。点已经绑上的那份源会关掉数据源页，露出空白首页。

## Decision

数据源页只在当前会话空白且未绑定时传入 `currentBlankSessionId`。已绑定的会话改传 `currentBound`。点到同一份源就直接打开该会话；点另一份源时不带 `sessionId`，由 `commitAskData` 新建会话。官方 session-controller 仍是一个会话一份源。

## Alternatives considered

**让 Host 把空白会话改绑到另一份源。** 否决：`commitExisting` 已经规定一个会话一份绑定；overlay Client 不能把已绑定 id 拿去绑另一份源。

**把每行的「开始提问」收成页上唯一按钮。** 否决：两颗按钮对应两份源；失败的是复用了会话 id，不是多了一颗按钮。

## Consequences

第二份源会开新会话，不再画出 `already bound to a different source`。已绑定会话上再点同一份源不会调用 commit。覆盖在 `tests/apply.client.spec.ts` 和 `tests/data-source-page.client.spec.tsx`。
