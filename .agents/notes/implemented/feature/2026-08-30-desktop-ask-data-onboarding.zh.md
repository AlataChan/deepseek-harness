# Agent Note: octopus_DSH 问数启动（先有数据，再有会话）

Status: implemented

[English](2026-08-30-desktop-ask-data-onboarding.md) | 中文

## Problem

octopus_DSH 用户想问一张表时，现在要先开空白「数据模式」会话，再在 data-agent 工作台里填 SQLite 路径。普通人手里是 Excel 或 CSV，不是数据库路径。未绑定也能 `prompt` 的空白数据模式会话，还会让模型装作表已经连上。

## Decision

官方 Service Definition 是 `@deepseek-ai/dsh-host-ask-data`（`ctx.askData`：`listSources` / `importSpreadsheet` / `importSample` / `bind`）。fork overlay `@deepseek-ai/dsh-experimental-desktop-ask-data` 是唯一 Provider，也是 `conversation.hero.askData` 与 `conversation.askData.gate` 的 Client 占位。官方 `desktop-app` 组合和默认 `standard` 助理保持不变。「问数」是新会话 chip。

路径是先有数据：先选或导入数据源（示例优先），再由 `commitAskData` 创建或复用已经绑好的会话。`session-controller` 只做 Consumer，不进口 overlay 内部。连接账本仍只有 data-agent 0.1.3。overlay 绑定调用 `ctx.dataAgentConnections.connect` / `resolveForExecution`（Task 0 `adapter: api`）。`connectionRef` 是 data-agent 的 profile id。

硬限制只写在一份 `limits.ts`，出现在数据源页、上传旁、预览、失败恢复，以及动态 system-prompt 段。示例文件名用 ASCII：`sample-sales.xlsx` / `.csv` / `.sqlite`。本机没有 `sqlite3` 时只禁用上传；`importSample` 拷贝预构建 sqlite。向该文件提问仍要 data-agent 的 `sqlite3` CLI（Task 0 在查询层是 `sqlite3-free sample: BLOCKED`）。

未绑定的 data-agent 会话 `prompt` 拒绝为 `session/ask-data-unbound`。绑定之后再 `select` 离开 `data-agent` 是 `session/ask-data-bound`。pin 名单若仍含 `dsh-context`，`verify-desktop-bundle.sh` 失败；不改写用户现有 profile。

## Alternatives considered

**改官方 `desktop-app` 或默认助理。** 否决：fork 规则不把课期和桌面外挂写进官方组合。

**把 data-agent 搬进仓库，或再造一套连接账本。** 否决：0.1.3 已经有 profile 和 session 绑定。Task 0 找到了文档化的 Host API。

**点「问数」就建空 SQLite。** 否决：第一条成功路径是填好的示例表，不是空库。

**把表格字节送给模型。** 否决：导入留在 Host；会话日志不得携带文件字节。

## Consequences

带此 overlay 的新桌面 profile 可以：打开问数 → 用示例 → 预览 → 提交 → 查询示例表，全程不用填路径。干净示例 CSV 上传零警告。已提交连接上的写工具必须失败。没有 overlay 的官方 web 在问数孔位保持空。

data-agent 0.1.3 的 SQLite 查询需要能解析到 `sqlite3` CLI。现有用户 profile 若仍列出 `dsh-context`，companion 起不来；窗口必须显示这次失败。脏表启发式会漏掉一些表；警告加示例恢复是接受的补救。

组装后的 first-ask 是 `packages/experimental/desktop-ask-data/tests/first-ask.host.spec.ts`，对着真实 0.1.3。按测试政策，录入语料时仍需要 `snapshots/session/ask-data-sample/` 与 `snapshots/web/ask-data-onboarding/`。
