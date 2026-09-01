# @deepseek-ai/dsh-host-ask-data

[English](README.md) | 中文

Web GUI Host 的问数列表、导入与会话绑定是一条 capability seam。抽象服务 `AskData`（`ctx.askData`）是其 Service Definition。Provider 实现 overlay 账本与 data-agent 连接簿。Consumer 是官方 `session.listAskDataSources` / `importAskDataSpreadsheet` / `importAskDataSample` / `commitAskData` / `askDataBinding`：只调用这些方法，并把 `AskDataError` 映射到线上。服务缺失时失败为 `session/ask-data-unavailable`。

Client 聚合通过 `@deepseek-ai/dsh-host-ask-data/client` 取得 `askDataBinding` 投影合并；该出口转述 `./types`，不加载 Host `AskData` 服务。

`listSources` 返回 overlay 管理行加上未匹配的 data-agent 连接。`importSpreadsheet` / `importSample` 只写 sqlite 与清单行，不套用 preset、不开会话，`connectionRef` 仍缺。`bind({ sourceId, sessionId })` 在目标 Session 已存在之后运行，返回同进程 `AskDataBindLease`，其 `rollback()` 恢复调用前快照。`ask-data/bound` 在此合并进 `SessionEventMap`（无 `@mode`）；`askDataBinding` 投影由 Provider 注册。

octopus_DSH 桌面入口是实验 Provider 加 Client 占位（`@deepseek-ai/dsh-experimental-desktop-ask-data`）。官方 Web 组合省略该包，因此 `conversation.hero.askData` 与 `conversation.askData.gate` 保持空。

## 模型体验

None, as this Service Definition owns only the capability vocabulary.

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延后工作

- **不自动生成空库** — bind 要求已经导入或已保存的数据源。
- **没有第二本连接账** — data-agent 0.1.3 拥有 profile 与会话绑定。
