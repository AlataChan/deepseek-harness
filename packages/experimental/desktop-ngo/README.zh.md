---
description: "安装并注册 octopus_DSH 公益项目助手预设。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-ngo

[English](README.md) | 中文

## 概述

本 fork 包把 公益项目助手 预设安装到 Harness home，并注册到 agent-preset 名册。预设随包提供项目书、台账周报、案例提取、传播初稿与脱敏等 Markdown 技能。激活时只补齐缺失的预设文件、绝不覆盖已有文件，并修复当前运行时无法挂载的 composition。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

桌面 profile 通过 `scripts/desktop-profile-plugins.json` 播种安装本包。激活时把预设写入 `<DSH home>/.agent-presets/env-ngo-project-assistant`：composition（`agent.cordis.yml`、`preset.yml`）以及带模板的技能树。目录不存在时整份拷贝；目录已存在时保留其全部现有文件，只补齐缺失的文件——用户的修改得以保留，新随包的技能也能送达。安装后的预设以 `env-ngo-project-assistant` 注册，显示名为 公益项目助手，出现在 专项助手 入口。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>维护者细节 — 点击展开</summary>

`installNgoPreset` 把「composition 仍指向已被移除的包」或「persona 行仍使用旧 `text` 键」的目录视为需要修复，并从包内重写这两个文件；其余一律为增补。注册时通过 `entryListSchema` 读取已安装的 composition，解析失败则记录日志并跳过注册。

</details>

<a id="model-experience"></a>
## Model Experience

None, as the preset definition owns every model-visible persona, instruction, and skill this installer registers.

#### KV Cache effect

无；本包只改变 composition。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **只做增补刷新** —— 从已有预设目录中删除的文件会在下次激活时被补回；若要支持逐文件删除并保持删除状态，需要显式的标记文件。
- **没有卸载入口** —— 卸载需手动进行：删除预设目录，名册条目会在下次激活时消失。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者视角 — 点击展开</summary>

随包的预设目录是技能的唯一来源；`installNgoPreset` 只修复当前运行时无法挂载的 composition，随后补齐缺失文件。已随旧版本安装、后来从包内移除的技能，会在用户磁盘上保留到出现显式的逐文件删除规则为止。

</details>
