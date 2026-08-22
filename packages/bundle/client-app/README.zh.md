# `@deepseek-ai/dsh-client-app`

[English](README.md) | 中文

传输无关的交互式客户端组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.zh.md) 之上，插入共享 Host（宿主）服务与 Client Plugin（客户端插件）名册，并把面向模型的配置项移到按会话划分的 Agent Preset（智能体预设）之后。它负责 ApiProxy、持久化与工作区支持、Client 模块发现、Client runtime（运行时）、共享 `ui-*` 插件和 preset 名册。它不负责物理连接提供方、服务器、静态前端、浏览器下载、目录选择器或界面启动行为；后续界面组合包提供这些配置项。随发行版交付的 Web profile 在 [`dsh-web-app`](../web-app/README.zh.md) 之前组合本包；VS Code profile 可以组合相同客户端行为，而无需继承浏览器服务器。

本组合包保持共享配置项的顺序稳定。后续界面层追加自己的配置项，因此激活顺序由依赖与 Cordis 注入决定，而不依赖跨组合包配置项交错。

## 模型体验

本包通过插入的配置项间接影响模型：选择 coding persona、共享交互式工具呈现设置、按会话划分的 preset 组装和 Client Plugin 名册。本包自身不贡献模型可见文本。

#### KV Cache 影响

无直接影响；每个插入的配置项自行负责其影响。

## 已知限制与延期工作

- **必须搭配界面组合包**：本包刻意不提供连接载体或用户界面壳，不能独立运行。
