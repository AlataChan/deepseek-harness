---
description: "octopus_DSH 桌面问数据 overlay：先选或导入数据源再提问，把表格存进 SQLite，并通过 ctx.askData 把数据源绑定到会话。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-ask-data

[English](README.md) | 中文

## 概述

`desktop-ask-data` 是私有桌面 overlay：先选或导入数据源，再开始提问。它提供 `ctx.askData`、占用问数据 Hero、gate 与窗内品牌孔位，并拥有其他 workspace 包复用的表格解码器；数据源行来自 overlay 账本与未匹配的 data-agent 连接，只有「开始提问」才会把数据源提交到会话。桌面 profile 种子会安装本包；官方 `dsh-desktop-app` 与默认 `standard` 助理不点名它。

## 目录

- [复用表格导入](#reuse-spreadsheet-import)
- [配置](#config)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="reuse-spreadsheet-import"></a>
## 复用表格导入

其他 workspace 包从 `@deepseek-ai/dsh-experimental-desktop-ask-data/spreadsheet` 导入，而不使用源码路径。这个受支持入口公开表格解析、扩展名检测、SQLite 表写入与预览读取、SQL 标识符引用、`ParsedWorkbook` 与 `ImportedTable` 类型，以及允许扩展名、解码文件、总行数和解码单元格限制。解析与 SQLite 失败仍是 `AskDataError` 值，其错误码由 [`dsh-host-ask-data`](../../host/ask-data/README.zh.md) 声明；公开常量是问数据的解码器限制，而不是 Consumer 专属配置。

<a id="config"></a>
## 配置

```yaml
- id: desktop-ask-data
  name: '@deepseek-ai/dsh-experimental-desktop-ask-data'
  config:
    dataHome: ''
```

空的 `dataHome` 使用 `{dshHome}/profiles/desktop/data-sources`。`cordis.patch.yml` 插入这一条 Host 行。Client 半面在 Host fiber 就绪后从 `dsh.client` 发现。

<a id="model-experience"></a>
## 模型体验

### 绑定限制段

#### 模型看到的内容

已有 `askDataBinding` 时，动态 `ask-data:limits` system-prompt 段写出同一套规则 id。冷恢复在第一次 assemble 就能看到。表格字节不会进入会话日志。

#### Token 影响

会话保持绑定时，一段固定规则 id 常驻提示词；未绑定的会话不出现该段。

#### KV Cache 影响

绑定后该段文本稳定，不会在 bind 之后搅动前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **不做 `.xls`、Numbers、Google 表格、多表连接或 ETL**
- **点「问数据」不创建空 SQLite**
- **不改写仍列出 `dsh-context` 的用户 profile** — companion 启动必须把失败亮给窗口

<a id="dev-note"></a>
### 开发备注

`RULE_EXPLANATIONS` 以封闭规则 id 集合作键，所以新增限制或预览告警必须同时补上用户文案；面向用户的字符串不带规则 id，ask-data 失败都经 `session/ask-data-failed` 的 details code 到达窗口。其他 workspace 包走受支持的 `/spreadsheet` 入口而不是源码路径，其导出的 `AskDataError` 错误码必须与 `dsh-host-ask-data` 保持一致。
