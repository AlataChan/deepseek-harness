# bundle/ — profile 插件组合包

[English](README.md) | 中文

Profile 组合包：在 manifest（元数据清单）中声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的 npm 包，因此可作为 patch 层安装进 `dsh --profile` 组合（[profile 约定](../boot/app-boot/README.zh.md#profiles)）。组合包的实体是它的 patch 列表；有些组合包还附带由其 patch 挂载的运行时粘合插件。

Bundle 身份由 manifest 声明决定，而不是由本目录决定。领域包可以携带自己的可选 Profile 层；[Codex 与 Claude Code subagent 包](../subagent/README.zh.md)就是可直接安装的例子。

| 包 | 职责 | ctx key |
|---|---|---|
| [`base/`](base/README.zh.md) | 每个 profile 最先应用的共享 dsh 核心 | —（仅 patch） |
| [`client-app/`](client-app/README.zh.md) | 传输无关的交互式 Host 与 Client Plugin 组装 | —（仅 patch） |
| [`web-app/`](web-app/README.zh.md) | 浏览器载体、集成与运行时粘合插件 | 挂载多条配置行 |
| [`vscode-app/`](vscode-app/README.zh.md) | VS Code 进程 IPC 载体、远程安全集成与界面上下文 | 挂载多条配置行 |
| [`headless/`](headless/README.zh.md) | 直接运行在 base 之上的一次性任务模式，不含 Host 或 Web 层 | 挂载 `headless-runner` |
| [`tui-app/`](tui-app/README.zh.md) | 直接运行在 base 之上的进程内 Ink 终端客户端 | 挂载 `tui-startup` 与 `tui` |

内置组合包从 dsh 安装目录解析；树外（out-of-tree）组合包通过 `dsh plugin --profile <name> add <package>` 安装进 profile。
