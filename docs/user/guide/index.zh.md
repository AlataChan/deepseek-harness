# 开始使用 Octopus DSH

[English](index.md) | 中文

Octopus DSH（小绿鲸）是本仓库基于 DeepSeek Harness 构建的桌面应用。桌面安装包提供完整打包体验，Web 启动器用于浏览器访问。[根目录 README](../../../README.zh.md#run)提供安装与源码准备入口。

## 打开应用

桌面安装包已包含 Node 和 Harness 运行时。打开 Octopus DSH 即可进入首页；首次启动不要求先选择 Node 或项目。桌面准备与发行限制见[桌面 README](../../../apps/desktop/README.md)。

使用 Web 时，先按照根目录 README 启动服务器，再打开命令打印的 URL。全新的 Web UI 需要先添加并选中工作区，才能输入任务。该 Web profile 不会自动启用桌面扩展。

## 配置模型

打开**设置 → 模型**，配置服务商与 API Key 并保存。[模型配置指南](./providers.zh.md)介绍 DeepSeek、其他服务商和自定义 OpenAI 兼容端点。服务商调用可能产生费用。

## 开始对话

选择包含目标文件的工作区，再开始对话。Web UI 中通过**选择工作区**添加并选中项目目录。桌面版初始可使用用户主目录；处理项目文件时，请选择对应的工作区。

首次使用可以发送：

> Summarize this repository and identify its main packages.

Agent（智能体）可以读取和编辑工作区文件、运行命令、委派工作并维护计划。需要审批的操作遵循当前权限策略。

## 选择桌面入口

- **问数据：**选择或上传 Excel/CSV 数据源，再开始围绕数据提问。
- **问知识：**将文档导入知识库并查看转换状态。由模型辅助的 wiki 丰富处理需要单独审批；仅完成转换并不代表知识覆盖完整。
- **助手与常驻团队：**保存可复用的角色、选择模型，并明确启动任务。仅打开已保存的成员列表不会运行团队。对话中的临时委派是另一项能力。
- **语音与媒体：**使用转写，或在对话中请求媒体。MiniMax 生成需要单独配置凭据；视频合成还需要用户安装媒体运行时。准备方法与限制见[媒体插件](../../../packages/experimental/desktop-media/README.zh.md)。

<a id="local-data-and-coexistence"></a>

## 本地数据与共存

除非启动环境设置不同的 `DSH_HOME`，Octopus 与其他 DSH 安装默认使用同一个 Harness 主目录 `~/.dsh`。对话保存在 `$DSH_HOME/sessions`，设置和 profile 也使用 Harness 主目录。两个安装使用此目录时，看到相同历史记录并不代表对话在应用之间发生了转移。

不同的应用名称、可执行文件或安装文件夹不会隔离这些数据。同一主目录的租约被持有时，第二个桌面 companion 无法同时使用它。若要主动分离安装，请先停止相关进程并备份现有主目录。新配置的主目录独立开始，不会自动迁移历史记录。桌面知识库和日志还会使用 Tauri 应用数据目录；移动文件前请阅读[桌面存储说明](../../../apps/desktop/README.md#local-data-and-coexistence)。

## 继续使用

- [配置模型](./providers.zh.md)
- [使用 Python SDK](./python-sdk.zh.md)
- [在反向代理之后发布 Web UI](./public-deployments.zh.md)
- [使用其他 CLI 模式](../../../apps/cli/README.zh.md)
- [开发插件](../develop/basic/index.zh.md)
