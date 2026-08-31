# Agent Note: Ask-data template download and existing-database entry do nothing

Status: implemented

[English](2026-08-31-desktop-ask-data-dead-actions.md) | 中文

## Problem

「下载填写模板」用 `<a download>` 加 blob URL。Tauri 2 WebView 不会把它当成保存，所以点击没有可见结果。「高级连接」会建一个空白 data-agent 会话并调用 `openSession`，但不关数据源页。data-agent 工作台按钮在 `conversation.input.right`，数据源页挡住输入区时它不会挂上。打开这个未绑定的空白会话，本来也会再次登记数据源页。

## Decision

`offerAskDataTemplate` 先试 `showSaveFilePicker`，仍会请求 `<a download>`，然后复制 CSV。页上报告已保存、已复制，或给出只读文本框。「连接已有数据库」替换旧文案，说明这是给已有数据库用的，调用 `onAdvanced`，关掉数据源页，并记下会话 id，避免 `sessions.list` 再为该会话打开数据源页。当前若已是未绑定的空白 data-agent 会话，就复用它，不再建第二个。用户保存连接后，再点「问数」并从名单点选。官方 `desktop-app` 不变。

## Alternatives considered

**在官方 session-controller 上加 `session.downloadAskDataTemplate`。** 否决：新 Remote 要重生 Typert 并重编 companion；overlay Client 复制在拷贝 `client.js` 之后就能用。

**保持数据源页，就地打开工作台。** 否决：工作台占位只挂在输入区旁边。

## Consequences

表格用户能看见模板。已有数据库的用户能进工作台。逃出后尚未绑定的会话，`prompt` 仍失败为 `session/ask-data-unbound`，直到从名单提交一份源。覆盖在 `tests/template.client.spec.ts`、`tests/data-source-page.client.spec.tsx` 和 `tests/apply.client.spec.ts`。
