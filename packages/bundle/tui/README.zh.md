---
description: "dsh TUI 组合包：基于 dsh-base 的交互式终端用户界面应用层。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui-bundle

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-tui-bundle` 是在 `dsh-base` 之上组装交互式终端用户界面（`@deepseek-ai/dsh-tui`）的组合包层。它挂载 TUI 适配器并为 `dsh --profile tui` 配置终端友好执行标志。

## 目录

- [使用本包](#use-this-package)
- [组合结构](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

该组合包自动包含在 `tui` profile 模板中。通过启动器启动 TUI：

```sh
dsh --profile tui
```

<a id="composition"></a>
## 组合结构

本组合包在 `cordis.patch.yml` 中声明 patch 层，插入 `@deepseek-ai/dsh-tui` 并配置执行环境属性。

<a id="model-experience"></a>
## Model Experience

Indirectly, through each inserted row's package, which owns that row's model-facing behavior.

#### KV Cache effect

The bundle itself adds no request prefix; each inserted row's package owns any cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **仅限 profile 层**——本组合包专用于在 profile 内基于 `dsh-base` 叠放组装，不支持作为独立根启动。
- **平台验收**——安装产物 profile 已通过本地 macOS 评审；Linux PTY、Windows ConPTY 和生产发布尚未验证。见[两份方案完成情况](../../../.plans/feature-expansion-2026-10-24/completion-status.md)。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
