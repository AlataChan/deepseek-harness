# Octopus DSH — 小绿鲸

[English](README.md) | 中文

Octopus DSH（`octopus_DSH`）是 AlataChan 维护的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 桌面优先 fork；上游是 DeepSeek AI 开发的开源 agent harness（智能体框架）。应用内品牌为“小绿鲸”。本 fork 独立维护，并非 DeepSeek 官方桌面发行版。

运行时保留 DeepSeek Harness 由 [Cordis](https://github.com/cordiverse/cordis) 驱动的**一切皆插件**架构。Octopus 增加 Tauri 2 桌面外壳、随安装包交付的运行时，以及面向日常文档、数据和团队工作的桌面插件。

## 你可以做什么

- 使用已配置的模型对话，并处理所选工作区中的文件。
- 问数据：先选择或上传 Excel/CSV 数据，再开始对话。
- 问知识：将文档导入知识库、搜索转换后的内容，并单独审批由模型辅助的 wiki 丰富处理。
- 保存助手与常驻团队，编辑职责、模型选择和记忆，并在协作面板中查看团队活动。
- 使用语音转写和对话驱动的媒体工具。媒体生成需要相应服务商的凭据；视频合成需要另行安装媒体运行时。

这些能力通过桌面插件提供；Web profile 不会自动包含全部桌面功能。用户入口见[入门指南](docs/user/guide/index.zh.md)，运行时与打包细节见[桌面 README](apps/desktop/README.md)。

## 开发者预览

Octopus DSH 及上游运行时持续快速迭代，仍可能出现破坏兼容性的变更。在让 agent 操作本地文件或执行命令前，请阅读[安全说明](SAFETY.zh.md)。

## 扩展能力与 TUI 验收

两份实施方案均已在实际测试的本地范围内通过独立评审。这与桌面安装包的发布验收分别记录。

| 能力 | 已验证范围 | 待完成验收 |
|---|---|---|
| IM、租户隔离与远程 Worker | 本地实现；可丢弃 Linux 环境中的租户隔离与 SSH 测试 | 真实飞书/钉钉投递、生产主机、物理两主机 SSH 和 CI |
| 交互式终端 TUI | 本地 macOS PTY、独立安装产物、原生/Node PTC 审批和 keyless Session replay | Linux 原生 PTY、Windows ConPTY、跨平台 CI 和生产发布 |

TUI 通过 CLI 的 `tui` profile 使用，不是 DMG/EXE 默认插件。桌面 IM 通过 [IM 设置扩展](packages/experimental/desktop-im/README.zh.md) 提供“设置 → IM 接入”，飞书和钉钉分别管理连接；服务端 IM 仍需显式 profile 配置及授权操作者绑定。证据与限制见[两份方案完成情况](.plans/feature-expansion-2026-10-24/completion-status.md)、[扩展验收记录](.plans/feature-expansion-2026-10-24/expansion-completion.md)和[TUI 验收记录](.plans/feature-expansion-2026-10-24/codex-tui-acceptance.md)。本地文档与 hygiene 阻塞已修复，见[修复记录](.plans/feature-expansion-2026-10-24/local-merge-repairs.md)。Linux/Windows 原生验收仍暂缓；本地验收不代表生产就绪。

<a id="run"></a>

## 运行

### 桌面版

请在本 fork 的[发布页](https://github.com/AlataChan/deepseek-harness/releases)查看可用安装包及对应版本的验证情况。发行目标为 macOS arm64 DMG 和 Windows x64 NSIS EXE。安装包携带 Node 和匹配的 Harness 运行时；普通用户在设置中配置模型 API Key 即可。签名、平台验证及产物是否可用取决于具体版本；当前未启用自动更新。

<a id="run-from-source"></a>

### 从源码运行

贡献者需要 Node.js `^22.19.0` 或 `>=24.0.0` 以及 pnpm：

```sh
git clone https://github.com/AlataChan/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

Web 启动器使用已构建的产物。源码工作流见[开发指南](docs/development.zh.md)，Rust/Tauri 前置条件及安装包准备见[桌面构建说明](apps/desktop/README.md#build-and-run)。安装上游 `@deepseek-ai/dsh` 包不会安装本 fork 的 Octopus 桌面应用。

## 本地数据

Harness 主目录默认为 `~/.dsh`，可通过 `DSH_HOME` 配置。Octopus 不会自动将此目录与其他 DSH 安装隔离。使用同一主目录的应用可以看到相同的对话和设置；不同的应用名称或安装目录不会创建独立历史记录。同时使用两个安装前，请阅读[本地数据与共存](docs/user/guide/index.zh.md#local-data-and-coexistence)。

## 文档与支持

- 从[用户指南](docs/user/guide/index.zh.md)开始。
- 在[本仓库](https://github.com/AlataChan/deepseek-harness/issues)反馈 fork 特有的问题。
- 通用 Harness 概念可参考[上游文档](https://deepseek-harness.github.io/deepseek-harness/)；其中不包含全部 Octopus 桌面扩展。
- 工程开发请阅读 [CONTRIBUTING.md](CONTRIBUTING.zh.md)、[开发指南](docs/development.zh.md)和[架构文档](docs/architecture.zh.md)。Agent 遵循 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
