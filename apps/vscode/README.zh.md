# `@deepseek-ai/dsh-vscode`

[English](README.md) | 中文

Harness 客户端的 workspace extension（工作区扩展）外壳。活动栏 `WebviewView` 仅在受信任的视图完成解析后才启动 companion（伴随进程），从当前 VS Code 窗口选择一个文件夹，并在隐藏期间保留存活的 Client 树。视图销毁和扩展停用会排空 companion；更换所选根目录会重启 companion，并在中断运行中的轮次前请求确认。

composer 菜单和对应的扩展命令可以显式附加当前非空选区、包含未保存修改的当前文档，或当前文档的诊断。每次捕获都限制在所选根目录内，并形成不可变引用 chip；扩展绝不会隐式添加编辑器内容。

Harness 文件位置操作继续使用既有 `host.openPath` RPC。扩展会通过 VS Code 打开文件、在 Explorer 中显示目录，并接受可选的 1-based `:line[:column]` 或 `#Lline[:column]` 后缀。文件系统路径和 URI 必须解析到所选根目录之内，并使用相同的 URI scheme 与 authority；符号链接、缺失目标和位于根目录之外的目标会返回普通 Host RPC 失败，绝不会回退到桌面打开程序。转发后的 `host.describe` 响应会通过 `canOpenPath` 报告这个 VS Code 打开能力。

扩展使用 workspace extension host（工作区扩展宿主）上已安装的 `@deepseek-ai/dsh` runtime（运行时）。发现过程接受包根目录、包 manifest（元数据清单）、已发布 JavaScript bin 或已识别的 npm/pnpm shim（垫片）作为线索，随后解析包声明的 VS Code companion 和真实 Node 可执行文件。启动过程直接调用带 IPC channel 的 `child_process.fork`，绝不执行 shell shim。这样，Local、SSH Remote 与 Dev Container 进程都与其 workspace 文件共置。Web extension host 不受支持。

companion 握手会公布 Client Plugin（客户端插件）图与 bundle（包）哈希。扩展把校验后的字节复制到按修订号划分的全局存储中，只向 Webview 授予该缓存与固定扩展媒体的访问权，并通过严格的 content security policy（内容安全策略）启动既有 Client 外壳。外壳启动前，Webview 会安装共享 registration facade，并从已验证缓存依次执行图中的模块系统与 runtime bootstrap 行；随后它会在任何图 entry 激活前，把私有 carrier 与 IDE port 提供到新建的 Client context。唯一一次 `acquireVsCodeApi()` 调用始终封装在这些经过校验的端口之后，不向外暴露。companion 代际变化会结束活跃 Client stream，但不会永久关闭 Webview API 客户端，因此共享 connection controller 可以重新连接持久会话。

Workspace Trust（工作区信任）会阻止 runtime 发现与执行。可执行文件路径设置在不可信 workspace 中受限。进程输出经过有界凭据遮盖；carrier record 与编辑器快照没有日志 API。companion 负责 Harness home 的独占 lease（租约），当另一进程可能正在使用同一个持久存储时报告 `home-busy`。

[VS Code 用户指南](../../docs/user/guide/vscode.md)介绍源码安装、远程放置、上下文隐私、恢复和当前限制。

## 配置

- `harnessClient.runtimePath` 使用已安装包的位置或已识别的发现线索覆盖 runtime 发现。
- `harnessClient.nodePath` 选择用于直接 fork 的真实 Node 可执行文件。
- `harnessClient.context.maxSelectionBytes` 限制“将选区加入提示词”捕获的 UTF-8 文本字节数。
- `harnessClient.context.maxFileBytes` 限制“将当前文件加入提示词”捕获的 UTF-8 文本字节数，以及序列化后的“将问题加入提示词”载荷字节数。
- `harnessClient.context.maxDiagnostics` 限制“将问题加入提示词”捕获的诊断记录数；诊断仅来自当前文件。
- `harnessClient.runtime.restartAttempts` 与 `harnessClient.runtime.shutdownTimeoutMs` 限制自动恢复与强制关闭。

运行 `pnpm --filter @deepseek-ai/dsh-vscode run build` 可生成 `dist/extension.js` 与 Webview 产物。[`manifest.vscode.json`](manifest.vscode.json) 是扩展暂存打包的源 manifest。它把扩展名固定为 `harness-client`、显示名称固定为 **Harness Client for VS Code**、图标固定为 [`media/icon.png`](media/icon.png)，并使用 pre-release 渠道；只有 Marketplace publisher 仍是显式占位符。

获得授权的发布负责人应通过 [Marketplace 官方流程](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)创建中性 publisher，然后运行 `DSH_VSCODE_PUBLISHER=<publisher-id> pnpm run package:vscode` 与 `pnpm run verify:vscode` 暂存并验证 VSIX。验证器会拒绝占位符、打包进去的 Harness 或 Node 代码、source map、测试、凭据、缺失的 locale 资源和未声明文件。未经授权不得使用 DeepSeek AI publisher 身份。

## 模型体验

无。本外壳只选择 workspace 并传输既有 Client 消息；面向模型的 VS Code 界面说明由 [`@deepseek-ai/dsh-vscode-app`](../../packages/bundle/vscode-app/README.md) 负责，显式编辑器快照由上下文 Client Plugin 负责。

#### KV Cache 影响

无；本包不组装提供方请求。

## 已知限制与暂缓事项

- 未发送草稿与上下文 chip 可跨隐藏和再次显示保留，但无法跨视图销毁、窗口重载或 extension host 重启保留。
- SSH Remote 与 Dev Container 属于人工发布检查项；自动化集成任务在每个受支持操作系统上覆盖本地 extension host。
- Session 导出仍是浏览器功能；文件位置改为在编辑器中打开。
