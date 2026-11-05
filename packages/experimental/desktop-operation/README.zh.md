---
description: "桌面操作预设：通过固定的 agent-desktop MCP 服务器独占一台 macOS 桌面会话。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-operation

[English](README.md) | 中文

## 概述

`desktop-operation` 是专用 Agent 预设，独占一台 macOS 桌面。选中它的 Agent 会启动自己的 mcp-client，连接固定的 agent-desktop 1.2.0 二进制，并挂上随包的 `agent-desktop` 技能。共享的预设树不启动服务器。standard 预设保持不变，本包也不在 profile 根插入 MCP client。

## 目录

- [使用此包](#use-this-package)
- [配置](#config)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

桌面 profile 播种安装本包。注册器把预设复制到用户预设目录，并在现有 Agent 预设名册上登记 `desktop-operation`。在搭载 Apple 芯片的 macOS 上，它可能运行一次 `agent-desktop status`，并从 `desktopOperationCopy` 发布一句状态。不支持的宿主不拉起进程，并发布平台句。登记预设不会启动 MCP 服务器。`agent/created` 只给预设为 `desktop-operation` 的 Agent 启动一个客户端。卸载注册器会释放它仍然拥有的每个客户端，包括尚未完成启动的客户端。后来的注册器启动的客户端不会因为更早的 Agent 被释放而关掉。`AgentPresetSection` 按原文显示该说明，预设挂载审计失败时显示 `row.broken`。`presetDisplayText` 只本地化内置预设 id，因此这个具名预设不会在卡片上切换语言。

监督进程对 `<appDataDirectory>/agent-desktop.lock` 取得排他 flock，并且从不删除该文件。它把同一描述符作为 stdio fd 3 交给 `agent-desktop`，所以监督进程被杀死后，只要子进程仍持有描述符，桌面就不会被释放。第二个监督进程在启动前退出，并写出 `desktop-operation: shared desktop lease is held`。进程入口必须带 `--lock` 和 `--binary`；`--` 之后是子进程命令，缺少路径时在取锁之前以退出码 1 结束。`AGENT_DESKTOP_HOME` 始终是 `<appDataDirectory>/agent-desktop`。适配器不修改 `HOME`。

固定的 `agent-desktop`、`agent-desktop-macos-helper`、`LICENSE`、`PIN.json` 和 `skills/agent-desktop/SKILL.md` 离线放入已播种插件的 `native/` 目录。`scripts/build-dmg.sh` 核对归档 sha256，写入这些文件，并在第一次 codesign 之前只运行一次 `verify-agent-desktop-digest.ts --unsigned`。签名后的 Mach-O 字节不与 pin 比较。本包不下载发行包，也不依赖 npm 上的 `agent-desktop`。

<a id="config"></a>
## 配置

```yaml
- id: desktop-operation
  name: '@deepseek-ai/dsh-experimental-desktop-operation'
  config:
    appDataDirectory: ''
    assetDirectory: ''
    statusTimeoutMs: 5000
```

`appDataDirectory` 是状态目录和锁文件的绝对父目录。留空时使用绝对路径 `OCTOPUS_APP_DATA`。支持的系统上，缺失或相对路径仍会登记预设。选中它的 Agent 在创建时失败，因为监督进程在拉起前退出，失败的不是整个应用。`assetDirectory` 覆盖已安装的 `native/` 目录。留空时解析插件旁边的 `../native`。

<a id="model-experience"></a>
## 模型体验

### 共享桌面目录

#### 模型看到什么

选中 `desktop-operation` 的 Agent 会得到固定的 agent-desktop MCP 目录，从 `desktop_snapshot` 到 `desktop_trace_export` 共 67 个工具，以及随包的 `agent-desktop` 技能。另一个仍在运行的 Agent 拿不到这些工具。工具结果是服务器自己的信封。合成的权限拒绝和 `error.code` 为 `STALE_REF` 由本包分类，本包不重试。本包不新增会话事件，也不在核心循环上挂监听。

#### Token 影响

选中该预设期间，工具定义和技能文本进入请求。目录比 standard 预设大，因为 67 个工具一次挂上。结果留在工具调用路径上；除了当前 mcp-client 已经发布的 MCP 服务器说明，本包不把结果再复制进额外提示段。

#### KV Cache 影响

目录和技能在这次预设选择的生命周期内保持稳定。第二个桌面会话被拒绝时，工具列表不变。取消的调用和断开的连接只去掉该次结果，不去掉定义。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **一台桌面** — flock 只允许该应用数据锁上有一个存活的 agent-desktop 子进程。第二个 Agent 的客户端在拉起前退出，该次创建失败。第一个 Agent 释放后，后来的 Agent 可以取得这把锁。卸载注册器要等该客户端清理结束后才放开这把锁。
- **Apple 芯片的 macOS** — 其他平台登记预设并且不启动客户端。注册器从 `desktopOperationCopy` 发布中文平台句。
- **权限** — `granted` 和 `unknown` 不是拒绝。其他权限状态从同一词典发布中文拒绝句。状态缺失、损坏或超时会发布不可用句，预设仍然登记。本应用不修改 TCC。具名预设还没有显示键挂钩，卡片不能切换这句的语言。`statusTimeoutMs` 默认 5000。
- **签名前核对一次** — `PIN.json` 里的二进制哈希是 codesign 之前的字节。打包检查不对签名后的二进制做哈希。
- **首次启动不下载** — 缺少归档时 `build-dmg.sh` 失败。二进制不进 git。
- **调用超时** — 每个 Agent 的客户端保留预设文件中的 `toolCallTimeoutMs`，由 mcp-client 校验。重连仍关闭，启动失败会使该 Agent 的创建失败。
- **不重连** — mcp-client 不会在服务器崩溃后重新拉起。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
