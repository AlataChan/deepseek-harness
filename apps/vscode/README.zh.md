# `@deepseek-ai/dsh-vscode`

[English](README.md) | 中文

Harness 客户端的 workspace extension（工作区扩展）外壳。活动栏 `WebviewView` 仅在受信任的视图完成解析后才启动 companion（伴随进程），从当前 VS Code 窗口选择一个文件夹，并在隐藏期间保留存活的 Client 树。视图销毁和扩展停用会排空 companion；更换所选根目录会重启 companion，并在中断运行中的轮次前请求确认。

扩展使用 workspace extension host（工作区扩展宿主）上已安装的 `@deepseek-ai/dsh` runtime（运行时）。发现过程接受包根目录、包 manifest（元数据清单）、已发布 JavaScript bin 或已识别的 npm/pnpm shim（垫片）作为线索，随后解析包声明的 VS Code companion 和真实 Node 可执行文件。启动过程直接调用带 IPC channel 的 `child_process.fork`，绝不执行 shell shim。这样，Local、SSH Remote 与 Dev Container 进程都与其 workspace 文件共置。Web extension host 不受支持。

companion 握手会公布 Client Plugin（客户端插件）图与 bundle（包）哈希。扩展把校验后的字节复制到按修订号划分的全局存储中，只向 Webview 授予该缓存与固定扩展媒体的访问权，并通过严格的 content security policy（内容安全策略）启动既有 Client 外壳。唯一一次 `acquireVsCodeApi()` 调用始终封装在经过校验的载体端口与 IDE 端口之后，不向外暴露。companion 代际变化会结束活跃 Client stream，但不会永久关闭 Webview API 客户端，因此共享 connection controller 可以重新连接持久会话。

Workspace Trust（工作区信任）会阻止 runtime 发现与执行。可执行文件路径设置在不可信 workspace 中受限。进程输出经过有界凭据遮盖；carrier record 与编辑器快照没有日志 API。companion 负责 Harness home 的独占 lease（租约），当另一进程可能正在使用同一个持久存储时报告 `home-busy`。

## 配置

- `harnessClient.runtimePath` 使用已安装包的位置或已识别的发现线索覆盖 runtime 发现。
- `harnessClient.nodePath` 选择用于直接 fork 的真实 Node 可执行文件。
- `harnessClient.context.*` 限制显式编辑器捕获；编辑器集成由 VS Code Client Plugin 提供。
- `harnessClient.runtime.restartAttempts` 与 `harnessClient.runtime.shutdownTimeoutMs` 限制自动恢复与强制关闭。

运行 `pnpm --filter @deepseek-ai/dsh-vscode run build` 可生成 `dist/extension.js` 与 Webview 产物。[`manifest.vscode.json`](manifest.vscode.json) 是扩展暂存打包的源 manifest；其 publisher 仍为显式占位符，因此不构成可发布的 Marketplace 身份。

## 模型体验

无。本外壳只选择 workspace 并传输既有 Client 消息；面向模型的 VS Code 界面说明由 [`@deepseek-ai/dsh-vscode-app`](../../packages/bundle/vscode-app/README.md) 负责，显式编辑器快照由上下文 Client Plugin 负责。

#### KV Cache 影响

无；本包不组装提供方请求。

## 已知限制与暂缓事项

- 未发送草稿与上下文 chip 可跨隐藏和再次显示保留，但无法跨视图销毁、窗口重载或 extension host 重启保留。
- SSH Remote 与 Dev Container 属于人工发布检查项；自动化集成任务在每个受支持操作系统上覆盖本地 extension host。
- Session 导出仍是浏览器功能；文件位置改为在编辑器中打开。
