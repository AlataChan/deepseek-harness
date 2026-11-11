# 为 Octopus DSH 做贡献

[English](CONTRIBUTING.md) | 中文

本仓库维护 AlataChan 的 DeepSeek Harness fork：Octopus DSH。桌面、打包及随附插件的问题请在[本 fork 的问题跟踪器](https://github.com/AlataChan/deepseek-harness/issues)反馈。请提供操作系统、应用版本、复现步骤和脱敏诊断信息；不要附带 API Key 或私密对话日志。

## 开发

请从[开发指南](docs/development.zh.md)、[架构文档](docs/architecture.zh.md)和 [AGENTS.md](AGENTS.md)开始。桌面贡献者还需阅读 [Tauri 构建与运行时指南](apps/desktop/README.md)和[发行准备](docs/cookbook/desktop-releases.zh.md)。

将 fork 的桌面扩展保留在所属插件中，修改受保护的上游路径时更新[上游引入登记表](scripts/upstream-intake-registry.ts)。源码包名保留 `@deepseek-ai/dsh-*`；仅凭该命名空间不能判断是否属于 DeepSeek 官方发行版。

## 修改与验证

保持修改范围明确，同步所属文档及双语版本，并运行与受影响行为相符的检查。推送前遵循[推送前工作流](.agents/skills/dsh-pre-push-checks/SKILL.md)。Fork 工作提交到本仓库，不要将 Octopus 特有修改直接提交给上游。

## 生态

插件可以扩展共用的 Harness 运行时。可使用 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题提高可发现性，并准确描述兼容性。[上游项目](https://github.com/deepseek-ai/deepseek-harness)拥有自己的贡献与品牌政策；本 fork 不代表 DeepSeek 发言。
