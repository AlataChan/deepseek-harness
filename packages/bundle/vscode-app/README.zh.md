# `@deepseek-ai/dsh-vscode-app`

[English](README.md) | 中文

叠加在 [`dsh-client-app`](../client-app/README.md) 之上的 VS Code 界面组合包。它的 [`cordis.patch.yml`](cordis.patch.yml) 保留共享交互式 Host 与完整的 `ui-*` 名册，将 API 网关的 `nativeOpen` 能力设为 false，挂载适用于远程环境的浏览式目录选择器，解析 extension 选中的 workspace 根目录，注册 VS Code 界面上下文，挂载 [`connection-vscode`](../../client/connection-vscode/README.md) 进程 IPC 载体，并添加 [`ui-vscode`](../../client/ui-vscode/README.md) 编辑器上下文控件。它有意不挂载 HTTP 服务器、静态前端适配器、Web connection、客户端插件 HMR、Host 原生目录选择器或浏览器 Session 下载操作。

[`src/startup.ts`](src/startup.ts) 持有 companion 唯一的参数 `--workspace-root <path>`。该值必须是绝对路径，并通过 `ctx.vscodeStartup` 提供；运行时行与载体行会先注入该服务再读取它。安装后的 `@deepseek-ai/dsh` 应用负责进程发现、独占 home lease 和已发布的 companion 入口。

## 模型体验

### VS Code 界面上下文

#### 模型看到的内容

当 `surfaceContext` 为 true 时，`harness:source` 段落标识 Harness 实现 checkout，`app:vscode-surface` 段落则说明 Visual Studio Code、所选 workspace 根目录、编辑器相关指代的含义，以及系统不会隐式获得选区、已打开文档、诊断或未保存文本。该段落还要求将文件打开请求交给现有编辑器。当 `surfaceContext` 为 false 时，这两个段落均不注册。

#### Token 影响

每个 session 包含一行源码说明和一段简短的界面定位文字；在 companion 进程生命周期内保持恒定。

#### KV Cache 影响

两个段落都位于系统提示词前部，并使用启动时不可变的 workspace，因此在各轮之间保持稳定。

## 已知限制与暂缓事项

- **只支持一个选中的 workspace 根目录**：更换根目录需要重启 companion；尚未实现多根目录聚合。
- **不包含浏览器专属集成**：Session 归档下载、Host 原生文件夹对话框和 Web HMR 不属于本界面。
