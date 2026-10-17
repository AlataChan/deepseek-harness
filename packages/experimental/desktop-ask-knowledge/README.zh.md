---
description: "octopus_DSH 问知识 overlay：Tauri app-data 下的文档库、Python sidecar 流水线，以及 conversation.hero.askKnowledge 的 Client 占位。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-ask-knowledge

[English](README.md) | 中文

## 概述

`desktop-ask-knowledge` 在应用数据目录提供文档知识库。上传时保留不可覆盖的原件，为每次导入生成独立文本，并对完整原始文本和手写 wiki 条目建立索引。转换和检索不会调用模型；知识整理须先展示并批准完整文档的持久化请求清单和保守 token 预算。桌面 profile 安装本 overlay，不修改官方应用包。 文档请求清单、检查点和转换诊断均显式使用 UTF-8 读写，不依赖 Host 的系统编码。

## 目录

- [配置](#config)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="config"></a>
## Config

```yaml
- id: desktop-ask-knowledge
  name: '@deepseek-ai/dsh-experimental-desktop-ask-knowledge'
  config:
    knowledgeHome: ''
    sidecarRuntimePath: ''
    extractionChunkChars: 1500
    extractionContextChars: 2000
    extractionOutputTokens: 2048
    extractionTimeoutMs: 1800000
```

空的 `knowledgeHome` 使用 `OCTOPUS_APP_DATA`。空的 `sidecarRuntimePath` 使用 `OCTOPUS_SIDECAR_HOME`。`cordis.patch.yml` 插入这一行 Host。Client 在注册界面前挂载生成的文档 Remote。可选文档方法通过 Cordis 命名空间服务查询访问。设置页区分文档加载中、加载失败与成功读取后的空库；刷新失败时保留已加载文档。每个库的 `.octopus-kb/config.toml` 统一配置整理模型；批准绑定该 profile、模型、端点、源文范围、提示版本和额度上限。每块执行时再选择 Wiki 上下文；路由、提示版本或更高额度需要重新估算和批准。缺失或结果不明的响应会暂停处理，不会自动重复付费推理。

`ctx.askKnowledgeDocuments` 是由本 overlay 的 `DocumentsServiceImpl` 提供、以接口声明的 Host 服务，负责按文档库管理原件存储、完整性校验和文档记录。 文档处理使用独立的 `DocumentJobId`，任务标识符以字符串持久化。

配置的 HTTP(S) 代理 URL 及其认证信息通过子进程环境传递，其他环境凭据仍会被过滤。保留用户的代理绕过条目，并合并本地回环地址。

`extractionContextChars` 限制完整序列化 Wiki 上下文的字符数，包括页面路径和 JSON 封装。运行时会裁剪页面文本以满足该限制；规划时按每个序列化字符最多四个 UTF-8 字节预留，并计入外层请求封装。同一提案的全部操作共享冲突页面路径预留，防止不同事实互相覆盖。索引链接根据已保存的提案意图恢复；发布时先暂存并刷新完整替换文件，检查已观察到的并发编辑，再原子替换索引。

模型生成的页面分类不在 PageMeta 枚举内时，会在严格校验前规范为 `note`，包括拒绝后恢复的已保存提案。该修复保留原始响应、调用标识和已报告用量，不会重新推理该区间。其他发布失败会报告拒绝规则，并保持提取暂停。

<a id="model-experience"></a>
## 模型体验

### 挂库后的检索提示

#### 模型看见什么

已有 `askKnowledgeBinding` 时，Provider 注册 `ask-knowledge:retrieve` system-prompt 段。文件字节和 API Key 不进会话日志。

##### 检索段

```markdown
这个会话已经挂上知识库。用户问文档、政策或材料里的内容时，必须先调用 ask_knowledge_retrieve 进行检索。
检索时使用 ask_knowledge_retrieve 的 terms 数组，填写 1 到 6 个专名，不要整句。每个专名去掉首尾空白后不超过 16 个字，且不得含 ?？。！! 或换行。
检索默认优先查询 Wiki 词条、别名、主题索引与正文。返回的 Wiki 内容为未核实摘要（unverified-wiki-summary）。
【原文核实规则】凡回答中包含数字、日期、义务要求、例外条款或直接引述作为已确认事实的，必须在同一轮中通过 ask_knowledge_read 或 mode="source" 读取原文片段并核实出处。仅凭 Wiki 引用不能断定事实已核实；未读原文时必须明确注明该结论来自未核实的 Wiki 摘要，不得冒充确认事实。
需要核验引用、排查矛盾或 Wiki 未命中时，可使用同一轮获得的 wikiAttemptId 进行原文兜底（ask_knowledge_retrieve 的 mode="source" 或 ask_knowledge_read）。上一轮的凭据无效，换轮后必须重新发起 Wiki 尝试。
关键词未命中或受限检索只表示这些专名未检索到，绝不能据此断言整库没有相关材料或材料不存在。
仅当需要打开检索结果里已有命中页的正文或 wiki 词条页时，调用 ask_knowledge_lookup，可携带 cursor 继续翻页。
返回 cursor 表示还有未读内容；用相同 terms 继续检索或翻页。不要用工作区文件、bash 或问数据工具代替知识库检索。
不要用 write、edit 或 bash 修改知识库目录或 .octopus-kb/。
```

#### Token 影响

会话保持挂库时，每轮请求成本固定。未挂库的会话不带这一段。

#### KV Cache 影响

挂库后前缀稳定。attach 或 detach 可能从第一处变化的 prompt token 起让复用失效。

### 检索与查阅工具

#### 模型看见什么

存在 `ctx.tools` 时，overlay 注册 `ask_knowledge_retrieve`、`ask_knowledge_read`、`ask_knowledge_lookup`、`ask_knowledge_session_document` 及其别名 `ask_knowledge_attachment_read`。响应额度包含完整文本内容包装、external-data 围栏及安全转义。模型可见 JSON 保留段落 ID、续读游标、转换诊断和核实标签。知识库原文操作要求同一会话、同一知识库、同一轮中已有成功落盘的 Wiki 工具结果；Wiki 不可用也必须先记录，再另行读取原文。凭据校验支持标准 external-data 安全围栏内的权威 JSON，同时保留会话、轮次、知识库和来源工具调用的校验。读取 Wiki 仍标为未核实摘要。原文结果包含索引源文版本和本次返回的段落偏移。查阅词条先分页再返回，不会再次裁掉已交付的范围。实验工具不进官方工具目录；`terms[]` 和 `term` 接受专名，不接受整句。

#### Token 影响

工具保持注册时 schema 成本固定。结果随数据变化，并受 `maxResultItems` / `maxResultChars` / `maxResultTokens` 限制。

#### KV Cache 影响

工具集不变时前缀稳定。HMR dispose 会摘掉五个 schema，可能从第一处变化的 schema token 起让复用失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 纯图片 PDF 页需要 OCR；文字与图片混合页无法确认图片内文字是否完整，因此保留“部分文本”状态，不调用云端 OCR。
- 系统能够限制网络时，DOCX 使用隔离的原生转换器；内置回退报告“部分提取”和遗漏部件。旧版 `.doc`、`.xls` 不受支持，表格一般更适合问数据。
- macOS 通过操作系统禁止原生转换器联网；无法建立限制时拒绝启动。Windows 原生转换等待等效网络策略。macOS 的进程组托管无法约束任意主动逃离进程组的后代。
- 会话文档根据模型可见历史中的官方 FileBlock 授权，包括继承历史。原件由官方附件存储保留；本模块将校验字节流写入私有暂存区，超出 `maxIngestBytes`（默认 20 MiB）时明确拒绝转换。转换文本可通过有界游标读完超过 32,000 字符的内容。游标绑定操作，进程重启后重新读取即可获取新游标。转换策略变化会重建经过完整性校验的缓存；清理缓存不删除原件，不增加独立的 24 小时留存策略。
- 设置页展示真实保留、转换、检索和分段进度。“批准”执行显示的计划；“取消”停止所属工作并保留原件与已提交历史；“重试”只生成新的待批准估算。付费结果不确定时，界面提供单独确认按钮，说明重新调用会再次消耗额度；普通继续操作不会自动重放。

<a id="dev-note"></a>
### 开发备注

`catalog.json` 管理知识库身份。原件以私有流式文件写入并 fsync，不覆盖已发布对象，通过可重放意图完成登记；启动时先修复登记，再恢复任务。共享短文件锁将启动世代、取消和 wiki／审计发布串行化，模型推理在锁外运行。只有明确的整理调用获得配置的凭据；调用方等待托管进程退出，转换结果使用私有且有上限的文件。删除知识库会删除该库保留的原件和处理记录。Windows 原生安装态验收仍是独立的发行条件。

登记文档的转换结果只有在持久化处理计划发布后才能进入自动原文索引；取消转换后可能保留原文文件，但这些文件不可检索。原文证据偏移采用完整 SHA-256 来源修订中的 Unicode 码点范围。表格保持连续，不重复插入合成表头。附件工具共用一份实现，`ask_knowledge_attachment_read` 是兼容别名。转换缓存包含原生转换器版本与内置转换器世代，文件名使用 `_v2.json`。默认 `maxResultTokens` 按每个序列化 UTF-8 字节估算一个 token（最多 6,000 字节，包含元数据）；长文通过游标分次读取，不丢弃尾部。
