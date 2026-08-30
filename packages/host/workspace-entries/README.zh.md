# @deepseek-ai/dsh-host-workspace-entries

[English](README.md) | 中文

web GUI 宿主的单层项目文件列举是一项能力 seam。抽象的 `WorkspaceEntries` 服务（`ctx.workspaceEntries`）是其 Service Definition。该服务只提供一个方法：`list({ root, path? }, signal)`，在宿主持有的项目根内列举一层目录。Provider 实现文件系统篱笆与行种类（`file`／`directory`／`broken-symlink`）。Consumer 是官方的 `session.listEntries`：它从指定会话的 `cwd` 推导 `root`，并把 `WorkspaceEntriesError` 映射到协议。服务缺失时失败为 `session/entries-unavailable`。客户端不能发送 root。

列举失败会抛出带类型的 `WorkspaceEntriesError`（`entries-unreadable`／`entries-outside-root`）。行上的 `hidden` 采用 POSIX 点前缀约定，展示策略留在客户端。每一行的 `path` 都是宿主绝对路径。

octopus_DSH 桌面文件树是实验 Provider 加上 Client 占座（`@deepseek-ai/dsh-experimental-desktop-files`）。官方 web 组合不挂载该包，因此 `sidebar.files` 保持空，也不绘制「文件」页签。

## 模型体验

无。该 seam 服务于 GUI 宿主的文件树；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **没有应用内编辑器或预览**——点击文件走已有的 `session.openWorkspacePath` 系统打开。
- **每次调用只列一层**——展开是对该行绝对路径的另一次 `list`，仍围在同一会话 `cwd` 内。
