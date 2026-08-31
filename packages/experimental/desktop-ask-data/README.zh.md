# @deepseek-ai/dsh-experimental-desktop-ask-data

[English](README.md) | 中文

octopus_DSH 私有 overlay：[`ctx.askData`](../../host/ask-data/README.zh.md) 的 Provider，以及 `conversation.hero.askData` 与 `conversation.askData.gate` 的 Client 占位。同时占用 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark` 和 `conversation.hero.headline`，桌面显示为 octopus_DSH，首页口号是「先选工作文件夹，再提问」。侧栏「设置」的通用页有「工作文件夹」一行，用来打开隐藏的桌面设置面板。问数 chip 与工作区、模式控件同一套几何。官方 `dsh-desktop-app` 与默认 `standard` 助理不点名本包。桌面 profile 种子会复制构建后的目录（[scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json) 中 `source: "workspace"`）。

路径是先有数据。点「问数」会 `hold` 住 `data-agent` 并打开数据源页。空白页主按钮是 **先用示例试一次**，另有 **下载填写模板**，其次上传 `.xlsx` / `.csv`，再次 **连接已有数据库**。选文件前先列出填写避坑。模板按钮会复制 CSV（Tauri WebView 没有下载栏）并提示已复制，或给出可复制文本。**连接已有数据库** 会关掉数据源页并打开数据模式会话，好让工作台按钮露出来；该会话不会自动再打开数据源页。用户保存连接后，再点「问数」，从名单里选这份库。导入只把 sqlite 写到已解析的 profile home `data-sources/`，不开会话。名单行只负责点选，行上没有「开始提问」。用户点选一行，或用示例/上传导入之后，页上才出现唯一的「开始提问」，并且只提交这份源。`commitAskData` 只在当前会话空白且未绑定时带上 `sessionId`；当前已绑另一份源时会新建会话；点到当前已绑的那份源则直接打开该会话。绑定后启动 Catalog 扫描，避免第一次 `catalog-search` 因目录为空报错。最近用过的行不会在「全部数据源」里再出现；名单里的行如果都已在最近使用中，就不画全部数据源这一段。普通用户在顺畅路径上不用输入 SQLite 路径。

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
