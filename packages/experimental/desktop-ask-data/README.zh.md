# @deepseek-ai/dsh-experimental-desktop-ask-data

[English](README.md) | 中文

octopus_DSH 私有 overlay：[`ctx.askData`](../../host/ask-data/README.zh.md) 的 Provider，以及 `conversation.hero.askData` 与 `conversation.askData.gate` 的 Client 占位。官方 `dsh-desktop-app` 与默认 `standard` 助理不点名本包。桌面 profile 种子会复制构建后的目录（[scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json) 中 `source: "workspace"`）。

路径是先有数据。点「问数」会 `hold` 住 `data-agent` 并打开数据源页。空白页主按钮是 **先用示例试一次**，其次上传 `.xlsx` / `.csv`，再次 **高级连接**。导入只把 sqlite 写到已解析的 profile home `data-sources/`，不开会话。「开始提问」调用 `commitAskData`，创建或复用一个已经通过 data-agent 0.1.3 绑定的会话。普通用户在顺畅路径上不用输入 SQLite 路径。

硬限制集中在 `src/limits.ts`，出现在页首、上传旁、预览、失败恢复和模型可见段落。本机没有 `sqlite3` 时只禁用上传；`importSample` 复制 `samples/sample-sales.sqlite`。向该文件提问仍需要 data-agent 的 `sqlite3` CLI。

## 配置

```yaml
- id: desktop-ask-data
  name: '@deepseek-ai/dsh-experimental-desktop-ask-data'
  config:
    dataHome: ''
```

空的 `dataHome` 使用 `{dshHome}/profiles/desktop/data-sources`。`cordis.patch.yml` 插入这一条 Host 行。Client 半面在 Host fiber 就绪后从 `dsh.client` 发现。

## 模型体验

已有 `askDataBinding` 时，动态 `ask-data:limits` system-prompt 段写出同一套规则 id。冷恢复在第一次 assemble 就能看到。表格字节不会进入会话日志。

#### KV Cache 影响

绑定后该段文本稳定，不会在 bind 之后搅动前缀。

## 已知限制与延后工作

- **不做 `.xls`、Numbers、Google 表格、多表连接或 ETL**
- **点「问数」不创建空 SQLite**
- **不改写仍列出 `dsh-context` 的用户 profile** — companion 启动必须把失败亮给窗口
