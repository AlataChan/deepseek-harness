# @deepseek-ai/dsh-experimental-desktop-ask-knowledge

[English](README.md) | 中文

私有 octopus_DSH overlay：[`ctx.askKnowledge`](../../host/ask-knowledge/README.zh.md) 的 Provider，以及 `conversation.hero.askKnowledge` 的 Client 占位。官方 `dsh-desktop-app` 和默认 `standard` 助理不点名本包。桌面 profile 种子复制构建树（[scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json) 里 `source: "workspace"`）。

活库在 Tauri `app_data_dir`（`OCTOPUS_APP_DATA` / `knowledgeHome`）。`catalog.json` 是唯一户口本。工作文件夹可以放可选 symlink，那不是索引。propose 从 `ctx.credentials.resolve` 取 `DEEPSEEK_API_KEY`，只注入该次 sidecar 子进程。sidecar 可执行文件按 `sidecarRuntimePath` 再 `OCTOPUS_SIDECAR_HOME` 解析。检索使用官方 SD 的 `terms[]`。完整工具结果有界。上传走 `beginIngest` / `appendIngestChunk` / `finishIngest`。`finishIngest` 会跑转换、LLM propose 和 apply；桌面 carrier 只给这一条方法 180 秒。仅本会话抽取走 `beginExtract` / `appendExtractChunk` / `finishExtract`；`finishExtract` 只跑 sidecar `convert-file`，等 90 秒，不写户口本。选库面板点库名挂上已有库，点「添加文档」往同一个库再放一份材料，点「删除」从名单去掉。若当前是已绑表的数据模式会话，点库名会新开一个标准会话再挂上；数据模式会禁掉检索工具。propose 会在 apply 前补上 `create_page` 缺的 `role` / `layer` / wiki `summary`，并把 tags 写进 aliases。apply 也会补这些字段；retrieve/lookup 会把只因 page-meta 被拒的提案再 apply 一次，让 wiki digest 落地。检索对查询、标题和正文做 NFKC 折叠；`ask_knowledge_retrieve` 把命中页正文渲染给模型。lookup 在词条名和输入不完全相同时，按标题、别名、标签或 retrieve 命中解析。新建在同一次点击里打开本机文件对话框，取消选文件不会写户口本；选中文件或点「先空着，直接提问」才建库。默认名是「未命名知识库」，不是按钮文案；第一次入库成功后按文件名去扩展名改名，往已有命名库添加不改名。`finishIngest` 失败时显示 `error`，并把 sidecar 里已知的英文映射成中文。propose 会截短过长原文，并要求短的 `create_page` 正文。composer 一直可见。加号菜单的「添加到知识库」通过 `conversation.input.attachKnowledge` 打开同一选择器，「看这份文档（仅本会话）」通过 `conversation.input.attachSessionDocument` 把抽出正文贴进草稿。

缺少 `OCTOPUS_APP_DATA` 或 `OCTOPUS_SIDECAR_HOME` 时，只有问知识方法失败。companion 聊天仍能启动。octopus-kb 放在 `python/`，并带 MIT `LICENSE` 与 `SOURCE.txt`。冻二进制的 propose/apply 按 `OCTOPUS_KB_ROOT`、源码树、onedir 上一级解析 `prompts/` 和 `schemas/`。

## Config

```yaml
- id: desktop-ask-knowledge
  name: '@deepseek-ai/dsh-experimental-desktop-ask-knowledge'
  config:
    knowledgeHome: ''
    sidecarRuntimePath: ''
```

空的 `knowledgeHome` 使用 `OCTOPUS_APP_DATA`。空的 `sidecarRuntimePath` 使用 `OCTOPUS_SIDECAR_HOME`。`cordis.patch.yml` 插入这一行 Host。Client 半边在 Host fiber 就绪后从 `dsh.client` 发现。

## 模型体验

### 挂库后的检索提示

#### 模型看见什么

已有 `askKnowledgeBinding` 时，Provider 注册 `ask-knowledge:retrieve` system-prompt 段。文件字节和 API Key 不进会话日志。

##### 检索段

```markdown
这个会话已经挂上知识库。用户问文档、政策或材料里的内容时，必须先调用 ask_knowledge_retrieve。
检索时使用 ask_knowledge_retrieve 的 terms 数组，填写 1 到 6 个专名，不要整句。
每个专名去掉首尾空白后不超过 16 个字，且不得含 ?？。！! 或换行。
ask_knowledge_retrieve 的返回里已有命中页的正文。先根据这些正文回答。
不要用工作区文件、bash 或问数工具代替知识库检索。只有检索结果为空时，才能说库里没有这份材料。
仅当需要打开检索结果里某一条 wiki 词条页时，再调用 ask_knowledge_lookup，term 用该页标题或路径。
不要用 write、edit 或 bash 修改知识库目录或 .octopus-kb/。
```

#### Token 影响

会话保持挂库时，每轮请求成本固定。未挂库的会话不带这一段。

#### KV Cache 影响

挂库后前缀稳定。attach 或 detach 可能从第一处变化的 prompt token 起让复用失效。

### 检索与查阅工具

#### 模型看见什么

存在 `ctx.tools` 时，overlay 注册 `ask_knowledge_retrieve` 和 `ask_knowledge_lookup`。实验工具不进官方 tool catalog。执行器接受 `terms[]` 或一个 `term`，并拒绝整句。retrieve 的 render 带上每页正文，模型不必再为同一页空转 lookup。

#### Token 影响

工具保持注册时 schema 成本固定。结果随数据变化，并受 `maxResultItems` / `maxResultChars` / `maxResultTokens` 限制。

#### KV Cache 影响

工具集不变时前缀稳定。HMR dispose 会摘掉两个 schema，可能从第一处变化的 schema token 起让复用失效。

## 已知限制与延后工作

- **扫描件 PDF 抽不出字** — 文字 PDF 走 markitdown[pdf]；纯图页不做 OCR
- **不接受 .xls** — Excel 须是 `.xlsx`。表格更适合走问数
- **没有收件箱审核台，也没有 ingest-url**
- **不改官方 desktop-app 组合** — 本 overlay 是 profile pin
