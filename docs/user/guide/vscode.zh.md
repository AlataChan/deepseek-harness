# 在 VS Code 中使用 Harness 客户端

[English](vscode.md) | 中文

Harness Client for VS Code 是开发者预览阶段的 workspace extension（工作区扩展），在活动栏的保留型视图中运行现有交互式 Client。扩展不包含 Harness runtime（运行时）；它会在 workspace extension host（工作区扩展宿主）中使用真实 Node 可执行文件启动匹配的已安装 `@deepseek-ai/dsh` 包。

## 环境要求

- VS Code 1.96 或更高版本，运行于桌面、SSH Remote 或 Dev Container；不支持基于浏览器的 extension host。
- workspace extension host 上安装 Node.js `^22.19.0` 或 `>=24.0.0`。
- 匹配版本的已安装或从源码构建的 `@deepseek-ai/dsh` runtime。
- 受信任的 workspace。授予信任前，扩展不会发现 runtime，也不会捕获编辑器上下文。

## 安装开发版 VSIX

扩展尚未发布到由项目拥有的 Marketplace publisher（发布者）下。请从本 checkout 构建本地 VSIX：

```sh
pnpm install
pnpm run build
DSH_VSCODE_PUBLISHER=harness-client-local pnpm run package:vscode
code --install-extension .artifacts/vscode/harness-client.vsix
```

在 PowerShell 中，先单独设置打包身份，再运行最后两条命令：

```powershell
$env:DSH_VSCODE_PUBLISHER = "harness-client-local"
pnpm run package:vscode
code --install-extension .artifacts/vscode/harness-client.vsix
```

如需使用同一个源码 checkout，请打开 VS Code 的 Settings JSON，把扩展指向构建后的应用包：

```json
{
  "harnessClient.runtimePath": "/absolute/path/to/deepseek-harness/apps/cli"
}
```

如需使用已发布 runtime，请全局安装匹配版本的 `@deepseek-ai/dsh`，并将 `harnessClient.runtimePath` 留空，使发现过程使用 `PATH`：

```sh
npm install --global @deepseek-ai/dsh
```

## 启动会话

打开受信任的文件夹，并选择活动栏中的 Harness Client 图标。如果一个窗口包含多个 workspace 文件夹，扩展会要求选择一个；后续更换文件夹会重启 companion（伴随进程），若轮次正在运行，还会先请求确认。

在**设置 → 模型**中配置模型，新建会话并发送提示词。该面板与 Web UI 使用相同的会话、审批、提问、工具、plan（计划）、goal（目标）、skill（技能）和 subagent（子智能体）行为。

命令面板提供本地化的 Harness Client 命令，用于聚焦面板、新建会话、添加编辑器上下文、选择 workspace 根目录、重启 runtime 和显示 runtime 日志。

## 添加编辑器上下文

从输入框或命令面板使用“将选区加入提示词”“将当前文件加入提示词”或“将问题加入提示词”。每项操作都会捕获不可变快照，并添加可移除的引用 chip。当前文件快照包含未保存修改，诊断仅来自当前文件。

扩展绝不会隐式读取或附加编辑器内容。捕获范围限制在所选 workspace 内，并受 `harnessClient.context.maxSelectionBytes`、`harnessClient.context.maxFileBytes` 与 `harnessClient.context.maxDiagnostics` 约束。提交后的快照会作为普通提示词文本写入持久会话日志，并按照其他用户消息的相同策略发送给已配置的模型提供方。

所选 workspace 内的 Harness 文件位置会在 VS Code 中打开。缺失目标、符号链接、不同的远程 authority，以及 workspace 外路径都会被拒绝，不会回退到桌面打开程序。

## Runtime 发现与远程使用

`harnessClient.runtimePath` 接受已安装包根目录、包 manifest（元数据清单）、已发布 JavaScript bin 或可识别的 npm/pnpm shim（垫片）作为发现线索。`harnessClient.nodePath` 选择真实 Node 可执行文件。在 Windows 上，扩展绝不会执行 `.cmd` 或 `.ps1` 文件，而是解析包声明的 JavaScript companion，再使用 Node 直接 fork。

SSH Remote 与 Dev Container 会在远程环境中、workspace 文件旁运行 workspace extension、Node 和 Harness companion。请在远端安装 runtime 与 Node；如果 `PATH` 发现不足，再在该远程窗口中设置两个路径覆盖项。版本一仍把这两种远程模式作为人工发布检查项。

## 持久化与恢复

隐藏活动栏视图时，它会保留 Client 树、未发送草稿、上下文 chip 和 companion。窗口重载、extension host 重启或视图销毁会丢失未发送状态，但持久会话会从 Harness 日志重新连接。

可使用“Harness 客户端：显示运行时日志”查看已遮盖敏感内容的生命周期输出；修复路径或版本问题后，可使用“Harness 客户端：重启运行时”。版本或载体不匹配会在 Client 启动前失败。`home-busy` 表示另一个 VS Code companion 可能占用同一个 Harness home；请停止它，或配置独立的 `DSH_HOME`，然后重启。Web 与 CLI 进程不参与该 lease，因此 companion 使用同一个 home 前必须先停止它们。不支持多个写进程共享一个 home。

面板为空且 Harness runtime 日志没有内容，表示 Webview bootstrap 未运行。请重新安装通过 `pnpm run verify:vscode` 的 VSIX，执行“开发人员: 重新加载窗口”，然后重试。如果面板仍为空，请执行“开发人员: 切换开发人员工具”并截取 Webview 控制台中的第一条错误。

版本一只选择一个 workspace 根目录，不从编辑器导出 Session 归档，也不支持浏览器 extension host。需要下载 Session 时请使用 Web UI。

## Marketplace 发布身份

暂存产物已经使用扩展名 `harness-client`、显示名称 **Harness Client for VS Code**、中性的终端对话图标和 pre-release（预发布）渠道。只有 Marketplace publisher ID 尚未决定。

发布负责人应在 [Visual Studio Marketplace publisher 管理页面](https://marketplace.visualstudio.com/manage/publishers/)创建自己控制的中性 publisher。该 ID 全局唯一，且创建后不能更改；未经授权不得使用 DeepSeek AI 身份。随后使用这个准确 ID 打包并验证产物：

```sh
DSH_VSCODE_PUBLISHER=<publisher-id> pnpm run package:vscode
pnpm run verify:vscode
```

版本一应只上传到 pre-release 渠道。[VS Code 官方发布指南](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)负责 publisher 认证与 Marketplace 上传步骤；不得提交凭据或 publisher token。
