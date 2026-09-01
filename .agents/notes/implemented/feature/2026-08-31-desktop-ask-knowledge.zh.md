# Agent Note: Desktop ask-knowledge overlay

Status: implemented

[English](2026-08-31-desktop-ask-knowledge.md) | 中文

## Problem

octopus_DSH 已经有问数。企业三件套还缺问知识：一份会变厚、可挂到标准会话、换工作文件夹之后还能找回的库。octopus-kb 已有入库、propose、两阶段 apply 和子串检索。这条管道还没进桌面产品；只靠 skill 或用 TypeScript 重写，会丢掉审计链，或被迫改官方桌面组合。

## Decision

官方 Service Definition `@deepseek-ai/dsh-host-ask-knowledge`（`ctx.askKnowledge`）加私有 overlay `@deepseek-ai/dsh-experimental-desktop-ask-knowledge`。活库在 Tauri `app_data_dir`（`OCTOPUS_APP_DATA`）。`catalog.json` 是唯一户口本。octopus-kb 通过 Python sidecar 运行。默认助理仍是 `standard`。chip 打开选库面板，不占用 `conversation.askData.gate`。官方 `desktop-app` / `desktop-companion` 产品逻辑不变，只允许 Tauri spawn 注入 `OCTOPUS_APP_DATA` 和 `OCTOPUS_SIDECAR_HOME`。

propose 从 `ctx.credentials.resolve` 取 `DEEPSEEK_API_KEY`，只注入该次 sidecar 子进程。检索入口是 `terms[]`，不是整句。完整工具结果有界。入库走 `beginIngest` / `appendIngestChunk` / `finishIngest`，因为桌面 carrier 上限是 256KiB。仅本会话抽取走 `beginExtract` / `appendExtractChunk` / `finishExtract` 和 sidecar `convert-file`，不写户口本（[会话抽取](2026-09-01-session-document.zh.md)）。`removeLibrary` 先握 catalog，再握每会话互斥，最后握 library 锁；冷会话在复判仍为冷之后走 `sessionPersistence.append`。`attach` 在 recover 前放开 catalog，并在会话锁和 library 锁都释放之后才写 `lastUsedAt`。

sidecar 运行时是可迁移的 PyInstaller 树，路径为 `Contents/Resources/resources/kb-runtime/`。`build-dmg.sh` 在 codesign 前写入，组装后再验证。octopus-kb 钉在 `d4852698caedbb37f4c370bc339da22a38db1367`，并带 MIT `LICENSE` 与 `SOURCE.txt`。

## Alternatives considered

**只靠 skill 调 CLI。** 否决：进度、defer、recover 和首次 Python 环境对普通用户不可控。

**用 TypeScript 重写 propose / validate / 审计。** v1 否决：两阶段审计和 YAML 规则就是这个库，重写等于再做一款产品。

**问数那样锁 preset、藏 composer。** 否决：知识库是跨会话资产，挂上不得藏输入框，也不得替换 `standard`。

**活库放在工作文件夹。** 否决：换工作目录会藏库或复制库。工作文件夹只放可选 symlink。

## Consequences

新的标准会话显示「知识库」chip；从名单点已有库会挂上 `libraryId`，preset 不变。若当前是已绑表的数据模式会话，点库名会按同一 cwd 新开一个标准会话再挂上；数据模式的 `tools.restrict` 会禁掉 `ask_knowledge_retrieve`。未绑表的数据模式会话在挂库前切回 `standard`。propose 会给每条 `create_page` 补上缺的 `role` / `layer` / wiki `summary`，避免 page-meta 把 apply 拒掉。挂库后的检索段要求模型先检索再按库回答；数据模式会话不带这一段。每一行还有「添加文档」，往这个库再入库，不新建户口；「删除」调用 `removeLibrary`，从名单去掉这一行。点「+ 新建知识库」会在同一次点击里打开本机文件对话框，取消选文件不写户口本；选中文件或「先空着，直接提问」才建库。接受 `.md`、`.txt`、`.html`、`.pdf`、`.csv`、`.json`、`.xlsx`，拒绝 `.xls`。CSV 按 charset-normalizer、utf-8-sig、gb18030 解码。`.xlsx` 用 openpyxl 转表，不装 pandas。PDF 走 `markitdown[pdf]` 抽文字；冻结时带上 magika 模型，转换才能跑。抽空按扫描件失败。选库文案提醒表格更适合走问数。默认名是「未命名知识库」；入库成功后只给未命名行按文件名去扩展名改名，已有命名库保持原名。失败的 `finishIngest` 带回 `error`；Host 把 `LLM returned non-JSON output` 映射成中文，选库面板显示这段原文。propose 把原文截到 12 000 字，要求 `create_page` 正文最多 800 字，能拆掉围栏 JSON，并在 `finish_reason` 为 `length` 时重试。冻二进制的 propose/apply 通过 `OCTOPUS_KB_ROOT`（其次源码树，再次 onedir 的上一级）打开 `proposal.json` 和 `builtins.yaml`；`self-test` 走包装模块加载这两份文件，不只看 `sidecar.py` 自己的资源根。「先空着，直接提问」挂空库；若是往已有库添加，则挂上那个库。composer 一直可见。在工作文件夹 W1 建库 A 后，W2 的新会话按 `lastUsedAt` 把 A 排在第一位。只在 `.credentials.yaml` 有 Key 时 propose 仍成功。`retrieve` 在执行器拒绝整句；只有 raw 命中也算成功。检索对查询、标题和正文做 NFKC 折叠，PDF 兼容区字符能对上用户输入的汉字。`ask_knowledge_retrieve` 把正文渲染给模型；只渲染页数会逼模型去 lookup。propose 就是 digest：写出标准汉字的 wiki 词条。apply 会补 page-meta；retrieve/lookup 会把 `schema.page_meta_invalid` 拒件再 apply，让 digest 落地。lookup 在输入不是精确词条名时，按标题、别名、标签或 retrieve 命中解析。`build-dmg.sh` 嵌入 `kb-runtime/`，验证组装后的 `.app`，sidecar 自检或可迁移检查失败则不出 DMG。打包进 companion 的 `dsh-session` 用 `KNOWN_SESSION_EVENT_TYPES` 读日志；`verify-desktop-bundle.sh` 拒绝漏掉 `ask-knowledge/bound` 的 harness 缓存。

桌面带可迁移的 Python 运行时，而不是构建机 venv。中文整句在 octopus-kb 里检索为空，所以执行器拒绝。sidecar 资源路径优先 `OCTOPUS_KB_ROOT`。锁序保持 catalog → session → library，避免 `removeLibrary` 和进行中的 retrieve 对锁。`session/finishAskKnowledgeIngest` 等 180 秒；`session/finishAskKnowledgeExtract` 等 90 秒。4 页 PDF 转换大约 2 秒，默认 30 秒会在 Host 仍在 propose/apply 时把客户端掐掉。
