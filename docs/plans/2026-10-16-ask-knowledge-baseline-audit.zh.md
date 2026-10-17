# 问知识：任务 1 基线审计

[English](2026-10-16-ask-knowledge-baseline-audit.md) | 中文

**状态：** 任务 1 的审计、测量与既有发现复核已完成。本审计为暂定状态，不宣称基线验收通过，因为已审批抽取这条验收路径在默认的知识子进程环境中会被拦截，且该拦截存在下文具名的产品侧共同成因（见「任务 1 处置结论」）。对产品代码只读：本审计没有在 `packages/`、`apps/`、`scripts/` 或本方案集之外的 `docs/` 下创建、修改或删除任何文件。

**被审代码树：** `fix/assistant-lifecycle-2026-10-15` 分支工作区，提交 `a4b448d733`，其中包含尚未提交的问知识整改改动。2026-10-16 的计数由两条限定范围命令给出：`git status --porcelain | wc -l` 报告 278 项（88 项 ` M`、190 项 `??`），`git status --porcelain -- packages/experimental/desktop-ask-knowledge | wc -l` 报告其中 75 项。改写前检查点记录了它自己的限定范围清单（275 项：88 项已修改、187 项未跟踪；共 478 个检查点文件），并由 `.plans/desktop-ask-knowledge/baseline-checkpoint-2026-10-16/README.md` 统一承载代码树清单。

## 摘要

归档的独立控制项大多已通过：第一轮 Python 控制 13/13 通过，第二轮 Python 控制 9/9 通过，Host/Client 控制 9/11 通过。上传审批闸门、同名导入保留、来源索引新鲜度、Unicode 偏移映射、PDF 混合内容分类、符号链接拒绝和完整响应字节上限都已复现为已修复。

唯一看似成立的失败属于环境问题，并且它带有产品侧的共同成因。所有已审批抽取控制项失败的原因，是本机对子进程发往回环地址的 HTTP 请求回了 `403` 与空响应体；子进程的客户端于是在 `python/kb/src/octopus_kb_compound/llm.py:63` 解析空内容并抛出 `Expecting value: line 1 column 1 (char 0)`。本次审计新写的控制项在不引入产品代码的情况下复现了该拦截，另一支诊断探针则说明子进程为何会被代理：`src/sidecar.ts:231-237` 没有给知识子进程任何代理环境变量，于是 Python 回退到 macOS 系统代理并丢失回环豁免，而其余所有 harness 子进程都会通过 `packages/subprocess/subprocess-local/src/spawn.ts:44-46` 拿到 `NO_PROXY=localhost,127.0.0.1,::1,[::1]`。同一个控制项在子进程获得该豁免后通过：退出 0、`completedChunks: 9`、`tokensUsed: 468`、9 次模型请求。

K3 与 R2-7 已被被审代码树取代：该树已暴露续读能力与段落读取工具，并已披露被截断的候选。R2-9 的按库私有游标密钥、以及对被篡改与跨库续读的拒绝，现已验证。第二轮审阅未重跑的三项必需控制项（K5、K7、R2-6）现有执行证据，其中 K7 与 R2-6 关闭。

100 MiB 上传上限暂不可采用。当前整文件路径处理 100 MiB 文件时进程 RSS 峰值 808.8 MiB，需要 640 次串行进程内分片调用，而现行 20 MiB 准入上限会在第 128 个分片处拒绝它。方案把 WebView 内存与传输吞吐定为决定性测量。传输吞吐现已在 Node 中测得（见测量 A）；WebView 内存无法在浏览器之外测得。

## 范围与方法

本审计覆盖 K1–K15 与 R2-1–R2-10 的清单、方案要求的三组测量，以及归档独立控制项的重跑。它不修复产品代码，也不宣称验收通过。

处置结论的用词从严。`verified closed` 表示该发现的全部提名控制项及其第二轮结论中剩余义务都在本次运行中被实际执行过。`still open` 表示至少一项义务没有执行证据，并注明已通过的探针。`superseded` 表示被审代码树已不再包含所报告的缺陷，并有源码与已执行控制项为证。`environment-blocked` 表示本仓库之外的某一层在默认环境中拦截了控制项，因此该义务只在显式豁免下被观测到，或完全未被观测。`unverified` 表示完全没有任何执行证据。辅助测试通过或整改报告均不能关闭发现；只有重跑提名控制项或实测才可计入。

命令均在仓库根目录执行。测量脚本以相对路径按 `node --import tsx/esm` 导入生产 TypeScript，因此通过根 `tsconfig.json` 的 paths 解析工作区包，无需构建。Python 控制项使用 `/opt/homebrew/bin/python3`。全程未使用付费推理、网络模型调用、`DEEPSEEK_API_KEY`，未构建 DMG，未运行 Windows 工作流，未运行全仓库测试。

## 发现清单

| 发现 | 结论要点 | 提名控制项或探针 | 处置 | 实际执行结果 | 证据 |
| --- | --- | --- | --- | --- | --- |
| K1 | 将真实摄入接入完整已审批处理流程 | `production-controls.spec.ts`（审批前无推理；末尾内容送达抽取）；`controls/child-network-control.mjs`；`prove-extraction-failure.mts` | environment-blocked；已具名产品侧成因 | 未审批控制项通过。末尾内容控制项在被拦截的子进程 HTTP 路径中失败，该拦截在不引入产品代码的情况下复现。子进程获得回环豁免后同一路径完成：退出 0、`completedChunks: 9`、`tokensUsed: 468`、9 次模型请求 | `controls-rerun.log`、`child-network-control.log`、`extraction-failure-diagnosis.log` |
| K2 | 索引就绪状态独立于数据库是否存在 | 第一轮 3 个 + 第二轮 2 个 Python 控制项；Host `retrieveBundle reaches late text after source retention` | still open | 五个 Python 控制项全部通过；Host 控制项通过。冷启动与激活中断未演练 | `adversarial-controls-rerun.log`、`followup-controls-rerun.log`、`controls-rerun.log` |
| K3 | 保留段落身份并向模型工具暴露续读能力 | Host `retrieveBundle preserves multiple matched sections in one file`；第二轮有界段落控制项；`passage-search.spec.ts` 分页用例 | superseded | 已被被审代码树取代。`src/tools.ts:40,54` 声明了检索的 `cursor`，`src/tools.ts:167-190` 注册了带 `passageId` 与 `cursor` 的 `ask_knowledge_read`，`src/index.ts:197` 将二者接入生产。各控制项通过，包含带续读的分页，以及对被篡改游标与跨库游标的拒绝 | `controls-rerun.log`、`k3-cursor-continuation.log` |
| K4 | 将文档 UI 控件接入真实远端与持久状态 | `actions-controls.client.spec.ts`（2 个）与 `review-wiring.client.spec.ts`（1 个） | still open | 三者均通过：无 Host 远端时取消操作会拒绝；旧版 raw 页面不会被伪造成可用原件；已注册设置槽暴露文档回调。每个动作在真实远端下的外部效果仍未验证 | `controls-rerun.log` |
| K5 | 以真实已配置推理替换伪造富化 | `controls/k5-synthetic-extractor.py`；第二轮审批控制项 | still open | 伪造一半已关闭：`generate_chunk_proposal` 抛出 `Synthetic extraction was removed; plan and approve real document inference`，且 `python/sidecar.py` 与 `python/documents/pipeline.py` 均未提及 extractor。真实推理一半与 K1 同属被环境拦截的路径 | `k5-synthetic-extractor.log` |
| K6 | 为 wiki 写入加围栏并保留终态取消 | `test_cancelled_job_cannot_be_finished_as_completed`；`test_restart_between_last_attempt_check_and_apply_cannot_publish` | still open | 二者均通过。校验与发布之间是否存在共享提交锁未被任何控制项断言，也未以其他方式演练 | `adversarial-controls-rerun.log`、`followup-controls-rerun.log` |
| K7 | 使用受管子进程所有权并等待结算 | `process-ownership.spec.ts`（5 个测试） | verified closed | 5/5 通过：清理环境中的凭据与代理变量、被拒任务返回前中止并汇合后代进程、卸载时结算活动工作、以及通过 `offlineConverterArgv` 实施的网络约束。`src/sidecar.ts:327` 与 `src/document-jobs.ts:449` 将所有子进程都交给 `withKnowledgeProcessRunner`，`src/converters/anydoc.ts:29-35` 在 macOS 与 Linux 上禁止网络，并在其他平台直接拒绝 | `k7-process-ownership.log` |
| K8 | 在来源与文件结果访问处拒绝符号链接 | `test_raw_symlink_cannot_leak_outside_vault`；`test_raw_directory_symlink_does_not_index_outside_source`；Host `file-result validation rejects a symlink outside the owned job directory` | still open | 三者均通过，包含祖先目录符号链接情形。保留来源的真实路径包含性未演练 | `adversarial-controls-rerun.log`、`followup-controls-rerun.log`、`controls-rerun.log` |
| K9 | 落实承诺的来源持久性、权限与不可变性 | Host `retained source files are owner-only`；`keeps both raw imports when filenames are identical` | still open | 二者均通过。注册失败恢复与一致性 SQLite 备份没有执行证据；不过 R2-6 下的 `source-durability.spec.ts` 现已覆盖分阶段写入与持久注册重放 | `controls-rerun.log`、`adversarial-controls-rerun.log`、`r2-6-source-durability.log` |
| K10 | 将预算绑定到真实序列化请求而非启发式 | `test_byte_fallback_does_not_divide_verified_byte_bound` | still open | 控制项通过。预算是否按真实序列化请求计数，在本次运行中没有任何控制项可观测 | `adversarial-controls-rerun.log` |
| K11 | 在有界候选选取之前先应用文档过滤并披露不完整检索 | `test_document_filter_is_applied_before_candidate_limit`；`test_candidate_limit_discloses_unsearched_matches` | verified closed | 二者均通过：101 篇文档加文档过滤返回过滤命中；105 篇匹配文档要么报告 105 条命中总数，要么给出告警 | `adversarial-controls-rerun.log`、`followup-controls-rerun.log` |
| K12 | 保留字面匹配与整串 Unicode 规范化 | `test_short_literal_percent_does_not_match_every_document`、`test_casefold_mapping_matches_whole_string_nfkc`、`test_nfkc_offset_map_handles_casefold_expansion_before_hit`、`test_unchanged_size_and_mtime_cannot_preserve_stale_hash`、`test_removed_raw_directory_does_not_leave_sources_searchable` | verified closed | 五项全部通过，包含 500 个 `ß` 前缀之后返回引文必须包含目标事实的情形 | `adversarial-controls-rerun.log`、`followup-controls-rerun.log` |
| K13 | 强制完整响应上限并将续读绑定到全部过滤条件 | `test_result_cap_includes_first_excerpt`、`test_cursor_is_bound_to_document_filter`、`test_bounded_single_passage_retains_hit_or_continuation`、`test_full_response_budget_counts_title_and_metadata` | verified closed | 四项全部通过，包含长 CJK 标题下 6,000 字节序列化上限。续读完整性由已执行的分页控制项覆盖：被篡改的游标与跨库游标都被拒绝 | `adversarial-controls-rerun.log`、`followup-controls-rerun.log`、`k3-cursor-continuation.log` |
| K14 | 移除基于夹具关键词的 PDF 完整性判定 | `test_same_scanned_image_without_cover_keyword_remains_partial`、`test_scanned_body_remains_uncertain_with_longer_caption` | verified closed | 二者均通过：把 `COVER` 改名为 `TITLE` 仍为 `partial`；把正文替换为四倍长的说明文字后仍不报告 `complete` | `adversarial-controls-rerun.log`、`followup-controls-rerun.log` |
| K15 | 交付实现并让安装包验收执行真实产物 | 安装产物验证器 | unverified，仅发布 | 未执行。本任务不得构建 DMG 或运行 Windows 工作流，因此产物模式验收与非法 worker 拒绝保持未验证。这仅阻塞发布验收，从不阻塞基线验收 | — |
| R2-1 | 摄入路径仍执行未审批的仅前缀推理 | `production-controls.spec.ts`；`controls/approval-flow-controls.spec.ts`；`controls/child-network-control.mjs` | environment-blocked；已具名产品侧成因 | 所报告的缺陷未复现：所有控制项中审批闸门在无审批时都不发送推理。完整内容义务只在被拦截的子进程 HTTP 路径中失败，并在显式回环豁免下完成，详见 K1 | `controls-rerun.log`、`child-network-control.log`、`extraction-failure-diagnosis.log` |
| R2-2 | 已注册文档动作是空实现且状态是伪造的 | `actions-controls.client.spec.ts`（2 个） | still open | 二者针对当前注册均通过。经真实 Host 远端的效果验证仍然缺失 | `controls-rerun.log` |
| R2-3 | 同名导入覆盖可检索源文本 | `keeps both raw imports when filenames are identical` | verified closed | 通过：两次名为 `same.md` 的上传使 `raw/` 下同时保留 `FIRST_SOURCE_9241` 与 `SECOND_SOURCE_9241`，与 `src/index.ts:533` 中按文档发布的 `raw/<documentId>-<revisionId>.md` 一致 | `controls-rerun.log` |
| R2-4 | 围栏仍是「先检查后写入」竞态；进程所有权不完整 | `test_restart_between_last_attempt_check_and_apply_cannot_publish` | still open | 控制项通过：在 apply 之前立刻推进启动代次，不再发布 wiki 页面。进程所有权一半已在 K7 下关闭 | `followup-controls-rerun.log` |
| R2-5 | 祖先目录符号链接仍能绕过来源授权 | `test_raw_directory_symlink_does_not_index_outside_source` | still open | 控制项通过：把 `raw/` 换成指向外部目录的符号链接后，不再返回外部夹具。保留来源的包含性仍未验证 | `followup-controls-rerun.log` |
| R2-6 | 来源持久性与不可变发布仍未实现 | `source-durability.spec.ts`（6 个测试）、`source-store.spec.ts`（7 个测试） | verified closed | 13/13 通过：物化之前先把已接收分片流式写入私有文件、拒绝覆盖已存在的损坏不可变修订、持久注册重放、原始对象尚未链接的持久意图恢复、损坏与截断检测、跨库拒绝。`src/source-store.ts:106` 与 `src/source-store.ts:210` 通过 `link()` 加目录 `fsync` 发布，随后读回并重新哈希 | `r2-6-source-durability.log` |
| R2-7 | 模型可见检索缺少续读，且检索隐藏被截断的命中 | `test_candidate_limit_discloses_unsearched_matches`、`test_bounded_single_passage_retains_hit_or_continuation`；`passage-search.spec.ts` 分页用例 | superseded | 已被被审代码树取代。检索在 `src/tools.ts:40,54` 声明 `cursor`；`python/documents/search.py:446` 的 10,001 行 SQL 候选上限在 `search.py:537-538` 产生 `candidate_limit` 告警；`src/tools.ts:213` 把该告警列表渲染进工具载荷。两个提名控制项与已执行分页控制项均通过 | `followup-controls-rerun.log`、`k3-cursor-continuation.log` |
| R2-8 | Unicode 引文偏移与索引新鲜度会产生错误答案 | `test_nfkc_offset_map_handles_casefold_expansion_before_hit`、`test_unchanged_size_and_mtime_cannot_preserve_stale_hash`、`test_removed_raw_directory_does_not_leave_sources_searchable` | verified closed | 三项全部通过，包含大小写折叠扩展前缀之后引文必须包含目标事实的情形 | `followup-controls-rerun.log` |
| R2-9 | 完整载荷上限与私有游标完整性仍然缺失 | `test_full_response_budget_counts_title_and_metadata`；`passage-search.spec.ts` 分页用例 | verified closed | 6,000 字节序列化上限通过。密钥是按库私有的 32 字节随机串，位于 `<vault>/.octopus-kb/cursor.key`，以 `0600` 创建并 fsync（`python/documents/search.py:30-48`）；`search.py:109-135` 以常量时间比较校验 HMAC，并拒绝跨库、过期代次、查询不匹配或文档过滤不匹配的续读。已执行控制项同时拒绝被篡改游标与跨库游标 | `followup-controls-rerun.log`、`k3-cursor-continuation.log` |
| R2-10 | PDF 与安装版验证仍接受非法结果 | `test_scanned_body_remains_uncertain_with_longer_caption`；安装 worker 控制项 | still open，仅发布 | PDF 部分已由通过的控制项关闭。非法 worker 拒绝与 AnyDoc 依赖需要安装产物，本任务无法构建；该一半仅阻塞发布验收 | `followup-controls-rerun.log` |

## 测量 A：整文件上传路径

当前知识库上传会把整个文件读入内存，并在首次远端调用之前编码全部分片：`packages/experimental/desktop-ask-knowledge/src/client/bytes.ts:25` 的 `readFileBytes` 调用 `file.arrayBuffer()`，`LibraryPicker.tsx:245` 把结果交给 `encodeIngestChunks`，`src/client/ingest-file.ts:80` 再切成 160 KiB 的 base64 分片。仅会话文档在 `src/client/extract-file.ts:39` 使用同一模式。

`measure-upload-path.mts` 在一个进程中复现该路径，并加入 Host 准入步骤：`src/upload-temp.ts:168` 的 `appendUpload`，默认上限 `DEFAULT_MAX_INGEST_BYTES`（`src/upload-temp.ts:16`）与 `src/index.ts:151` 的配置上限。

| 大小 | 客户端分片数 | 进程内 `appendUpload` 调用 | base64 字符数 | 膨胀率 | `encodeIngestChunks` | Host 准入 | RSS 峰值 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 MiB | 7 | 7 | 1,398,120 | 1.3334 | 32 ms | 接受 7 片 | 113.2 MiB |
| 10 MiB | 64 | 64 | 13,981,184 | 1.3333 | 248 ms | 接受 64 片 | 172.0 MiB |
| 25 MiB | 160 | 160 | 34,952,960 | 1.3333 | 645 ms | 第 128 片被拒 | 316.5 MiB |
| 50 MiB | 320 | 320 | 69,905,920 | 1.3333 | 1,235 ms | 第 128 片被拒 | 541.9 MiB |
| 100 MiB | 640 | 640 | 139,811,840 | 1.3333 | 2,524 ms | 第 128 片被拒 | 808.8 MiB |

分片数一列是客户端的分片数，也是生产路径中远端追加往返的次数。`appendUpload` 一列不是远端：`measure-upload-path.mts` 在进程内直接调用 Host 函数以隔离准入成本与拒绝顺序，而 `measure-transport.mts`（`transport-measurements.log`）测量真实的 Client → `ProcessTransport` → `StdioLinePort` → `VsCodeIpcChannel` → `VsCodeHostGateway` → `DesktopAskKnowledge` 传输与官方附件上传路由。在默认 20 MiB 上限下，`askKnowledge` 桌面 RPC 接受 1 MiB（双向各 `8` 条线上记录、C→H 线上字节 `1,400,453`、追加耗时 `64.9 ms`、`16.86 MiB/s`、RSS 峰值 `155.4 MiB`）、10 MiB（`65` 条记录、`14,000,048` 字节、`531.3 ms`、`18.82 MiB/s`、RSS 峰值 `267.9 MiB`）与 20 MiB（`129` 条记录、`27,999,792` 字节、`942.1 ms`、`21.23 MiB/s`、RSS 峰值 `462.5 MiB`），并在发送 `130` 条线上记录（C→H `28,218,538` 字节）后于第 `128` 片拒绝 25/50/100 MiB（`file exceeds 20971520 bytes`）。把 `maxIngestBytes` 提高到 100 MiB 以测完整传输容量时，50 MiB 在 `10,003.8 ms` 内完成（读取与编码 `4,662.6 ms` + 追加 `5,334.2 ms`，`321` 条线上记录，C→H 线上字节 `69,999,024`，`9.37 MiB/s`，RSS 峰值 `538.5 MiB`，增量 `+100 MiB`），100 MiB 在 `15,440.7 ms` 内完成（读取与编码 `8,700.3 ms` + 追加 `6,729.2 ms`，`641` 条线上记录，C→H 线上字节 `139,997,745`，`14.86 MiB/s`，RSS 峰值 `561.0 MiB`，增量 `+200 MiB`）。20 MiB 上传在 32 片后中途取消时，由于不存在 `abortIngest` RPC，`<knowledgeHome>/tmp/<uuid>` 在 Host 存活期间一直留在磁盘上（`remainingTmpDirsWhileLive: 1`），且异常崩溃后的冷重启不会清理 `<knowledgeHome>/tmp/<uuid>`（`tmpDirsBeforeRestart: 1`、`tmpDirsAfterColdRestartInit: 1`）。相比之下，官方附件 HTTP 流式上传（`POST /api/upload/file` → `saveFileStreamVerbatim`）以 `8.19–378.25 MiB/s` 流式写入 1–100 MiB（100 MiB 耗时 `264.4 ms`、RSS 增量 `+0.4 MiB`），并在中途取消时立即清理暂存文件（`stagingFilesRemaining: 0`）；而经由 `ProcessTransport` 的一元 `fileUploads/upload` 因 `ProcessTransport.fetch` 拒绝非 JSON 请求体（`desktop API request body must be JSON text`），会将 1–50 MiB 切分为 `10–358` 条线上记录，吞吐为 `7.48–11.59 MiB/s`（50 MiB 时 RSS 峰值 `1,085.9 MiB`）。

三点对任务 2 至关重要。100 MiB 文件的 RSS 峰值达到 808.8 MiB，约为载荷的八倍，因为解码缓冲区、切片视图与 base64 字符串同时存在。线上开销恒为文件大小的 4/3，分片本身不改变这一点。默认 20 MiB 准入上限（`file exceeds 20971520 bytes`）要到第 128 次成功分片调用之后才拒绝 25 MiB 及以上上传，因此被拒的 25 MiB 上传已经完成了 160 次分片调用中的 128 次。

**WebView 未被测量，也不作任何声称。** 这些数字来自带 `--expose-gc` 的 Node 24 进程。`file.arrayBuffer()`、base64 编码器、渲染进程内存压力与 Cordis 远端传输在 WebView 中表现不同。方案把 WebView 内存峰值与传输吞吐列为 100 MiB 上限的决定性测量，因此本表无法回答该问题。

## 测量 B：转换与资源上限

`measure-caps.mts` 调用生产辅助函数，并对每个上限在边界值与超一字节处断言。

| 上限 | 位置 | 是否可配置 | 边界值 | 超一字节 |
| --- | --- | --- | --- | --- |
| 组装后上传 | `src/upload-temp.ts:16,168` | 可配置，`src/index.ts:151` 的 `Config.maxIngestBytes` | 接受 20,971,520 字节 | `AskKnowledgeError: file exceeds 20971520 bytes` |
| 摄入分片 | `src/upload-temp.ts:13,97`；客户端镜像 `src/client/ingest-file.ts:9` | 不可配置，两端均为固定常量 | 接受 163,840 字节 | `AskKnowledgeError: chunk exceeds 163840 bytes` |
| 转换输出 | `src/conversion.ts:79,198` | 存在 `maxBytes` 选项；无任何配置传入 | 52,428,800 字节文本转换 `complete` | `AskKnowledgeError: File size 52428801 exceeds maximum allowed 52428800 bytes` |
| DOCX XML 条目 | `src/extract-docx.ts:12,71` | 不可配置，模块私有常量 | 8,388,608 字节的 `word/document.xml` 抽出 8,388,586 字符 | `AskKnowledgeError: 这份 Word 太大，读不了` |
| 抽取截断 | `packages/host/ask-knowledge/src/index.ts:73` | 不可配置，仅导出常量 | 保留 32,000 个码点，未截断 | 32,001 个码点被截断为 32,000 |
| 文件结果载荷 | `src/document-jobs.ts:23,51` | 仅参数默认值 | 未演练 | 未演练 |
| 转换时限 | `src/extract.ts:15`、`src/conversion.ts:372`、`src/sidecar.ts:229` | 不可配置，字面量 90,000 ms；`sidecar.ts` 接受调用方传入的 `timeoutMs` | 常量无法由配置设定 | 缩放到 300 ms 的时限在 318 ms 后以 `knowledge child timed out` 拒绝 |
| 抽取任务时限 | `src/index.ts:149,825` | 可配置，`Config.extractionTimeoutMs`，默认 1,800,000 ms | 仅约束已审批抽取任务 | — |

有两个随部署变化的值是硬编码的，方案已把两者列为任务 2 工作：90 秒转换时限字面量，以及有选项但无配置入口的 50 MiB 转换输出上限。160 KiB 分片尺寸在 Client 与 Host 各有一份且注释要求二者一致，因此方案的流式改造必须同时移动两处。

## 测量 C：官方附件公开接口

`measure-attachment.mts` 通过公开接口驱动附件存储，`root` 设为 `<自有 home>/attachments/v1`，因为该存储用 `dirname(dirname(root))` 推导 `DSH_HOME`。

| 主张 | 位置 | 观测结果 |
| --- | --- | --- |
| `FileAttachmentRef` 身份为摘要、净化后的名字与字节数 | `packages/attachment/attachment/src/types.ts:39` | 每个存储文件均为 `{ attachmentId: 'sha256:<64hex>', name, bytes }` |
| 文件对象按内容寻址，跨显示名共享 | `attachment-local/src/file-store.ts:76,82` | 路径布局为附件根下的 `/files/<前2位>/<sha256>/<name>` |
| 存储无大小上限、无类型白名单 | `attachment/README.md`、`attachment-local/src/file-store.ts:95` | 25,165,824 字节文件成功保存，高于 20 MiB 知识库上限 |
| Windows 客户端路径被归约为单个叶名 | `file-store.ts` 净化器 | `C:\Users\x\报告 v2.docx` 存为 `报告 v2.docx` |
| `readFileStream` 流式读取并校验 | `attachment/src/index.ts:219`、`file-store.ts:152` | 精确返回 25,165,824 字节；等长被改动的对象以 `Stored file attachment failed integrity verification.` 拒绝；缺失对象以 `File attachment object is missing.` 拒绝 |
| `fileHostPath` 在本地后端返回宿主路径 | `attachment/src/index.ts:237`、`attachment-local/src/index.ts:244` | 返回存储对象路径；基础后端返回 undefined |
| 模型可见文件被投影为文本而非字节 | `packages/llm/llm/src/content.ts:151,185` | 每个文件块都变为确定性的句柄文本，含名字、大小、摘要前缀与只读路径 |
| 持久文件引用会被会话日志导出遍历 | `packages/session-query/session-log-export/src/archive.ts` | 消息事件中的文件块会被收集用于归档遍历 |
| 知识库上传准入与附件存储彼此独立 | `src/upload-temp.ts:168` | 同一个 25 MiB 文件被知识库准入拒绝，却被附件原样存储 |

方案所称「已接受附件可以保留，而其转换被明确拒绝」与上述测量一致：存储无上限且按内容寻址，而转换与知识库准入各自在自己的上限处拒绝。

同一组测量还推出一个约束任务 2 留存设计的结论。附件存储接受任意大小、无限期保留每个原件，并按摘要跨会话提供读取，而会话日志导出会遍历每个持久文件块。因此清除覆盖层缓存并不会删除文档：原件仍留在附件根下，并仍可通过任何引用了它的已导出会话日志读取。

## 归档控制项重跑

第一轮与第二轮的审阅控制项按原样重跑。Python 控制项从归档位置运行。四个 Host/Client Vitest 控制项复制到证据目录，仅改写相对导入说明符，因为归档副本假定自身位于包内 `tests/` 目录，而本任务不得写入该目录。

| 控制项 | 命令 | 结果 |
| --- | --- | --- |
| 第一轮 Python 控制项，13 个 | `/opt/homebrew/bin/python3 .plans/desktop-ask-knowledge/review-2026-10-15/adversarial-controls.py` | 退出 0；13 通过，0 失败 |
| 第二轮 Python 控制项，9 个 | `/opt/homebrew/bin/python3 .plans/desktop-ask-knowledge/review-round2-2026-10-15/followup-controls.py` | 退出 0；9 通过，0 失败 |
| 归档 Host/Client 控制项，11 个 | `pnpm exec vitest run --config .plans/desktop-ask-knowledge/baseline-audit-2026-10-16/controls/vitest.controls.config.ts` | 退出 1；2 失败，9 通过（11） |

通过的九个 Vitest 断言是：四个真实 Host 检索、符号链接与权限控制项，两个已挂载 Client 动作控制项，已注册设置槽控制项，审批前无推理控制项，以及同名导入控制项。失败的两个是归档的末尾内容控制项与下文描述的审批感知控制项。

有一处基准适配必须记录，已写入复制文件：归档 Client 基准提供的 `remote` 没有 `$mount`，而当前入口在 `src/client/mount.ts:288` 会先挂载生成的 Remote 贡献再注册 UI。副本补上了包内自带 `apply.client.spec.ts:63` 所用的同一个 `$mount` 桩。断言本身未改动。若不补该桩，三个 Client 控制项都会以 `ctx.remote.$mount is not a function` 中止，那是基准缺口，不是产品结论。

除归档控制项外，本次修订还执行了四项检查，它们对应第二轮审阅未重跑的必需控制项，或上文清单中新引用的证据。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 进程所有权与网络约束（K7、R2-4） | `pnpm exec vitest run packages/experimental/desktop-ask-knowledge/tests/process-ownership.spec.ts --maxWorkers=1` | 退出 0；5 通过，0 失败 |
| 来源持久性与不可变发布（R2-6、K9） | `pnpm exec vitest run packages/experimental/desktop-ask-knowledge/tests/source-durability.spec.ts packages/experimental/desktop-ask-knowledge/tests/source-store.spec.ts --maxWorkers=1` | 退出 0；13 通过，0 失败 |
| 续读、分页与游标拒绝（K3、K13、R2-7、R2-9） | `pnpm exec vitest run packages/experimental/desktop-ask-knowledge/tests/passage-search.spec.ts packages/experimental/desktop-ask-knowledge/tests/host-acceptance.spec.ts --maxWorkers=1` | 退出 0；9 通过，0 失败 |
| 已移除的合成抽取器（K5） | `/opt/homebrew/bin/python3 .plans/desktop-ask-knowledge/baseline-audit-2026-10-16/controls/k5-synthetic-extractor.py` | 退出 0；`RuntimeError: Synthetic extraction was removed; plan and approve real document inference`；无生产接口提及 extractor |

这些是生产方自有的包内测试，而不是独立审阅控制项。它们执行了被提名的义务，并按「已执行检查」报告，而不当作独立验证。

## 已审批抽取：环境拦截与产品侧共同成因

四个来源中的五个测试用例在同一处失败：归档 `production-controls.spec.ts` 的末尾内容用例、本次审计编写的 `controls/approval-flow-controls.spec.ts`、生产方自有的 `tests/upload-approval.spec.ts` 末尾内容用例，以及 `tests/document-enrichment.spec.ts` 的两个用例。四次独立运行记录了同一失败：`controls-rerun.log`、`package-enrichment.log`、`package-suite-bounded.log` 与 `upload-approval-late-content-fail.log`。

审批机制本身工作正常。在审批感知控制项中，审批被接受，计划写入 `budgetApproved: true` 与 `approvedTokens: 130288`，分片检查点写入 `state: "calling"`，冻结路由指向夹具服务器。夹具记录的模型请求数为 0，子进程返回 `Expecting value: line 1 column 1 (char 0)`。

该字符串是对空响应体的 JSON 解析失败，不是产品判定。`python/kb/src/octopus_kb_compound/llm.py:63` 返回 `response.status_code, response.json()`，空响应体正好抛出该错误。`src/sidecar.ts:127` 只是重新包装子进程打印到 stdout 的 JSON 错误，因此堆栈停在那里；`KnowledgeProcessExitError` 在 `src/sidecar.ts:264` 处携带子进程的 `stderr`，以便非零退出时报告子进程自身输出。

`controls/child-network-control.mjs` 在不引入产品代码的情况下定位了原因。它在 `127.0.0.1` 上绑定一个 Node HTTP 服务器，先从 Node 父进程发一次请求，再启动一个普通 `/opt/homebrew/bin/python3` 子进程，通过 httpx 向同一服务器发请求。

| 观测项 | 结果 |
| --- | --- |
| 父 Node 对回环夹具的 `fetch` | `200`，响应体 `{"ok":true,"path":"/parent"}` |
| 清除全部代理变量后子进程 python httpx 的 POST | `403`，空响应体，响应头 `connection: close`、`content-length: 0`、`cache-control: max-age=3600, public` |
| 继承环境变量时子进程 python httpx 的 POST | `ImportError: Using SOCKS proxy, but the 'socksio' package is not installed` |
| 夹具服务器实际服务过的路径 | `["/parent"]`；子进程的请求从未到达 |

子进程的请求由本仓库之外的一层应答。两种变体都因环境而失败：继承环境把子进程送往一个不可用的 SOCKS 代理，清空环境则被以可缓存的 `403` 拦截。父进程不受影响，因此该拦截作用于被启动的子进程，而不是回环服务器。

拦截层在本仓库之外，而产品的知识子进程环境是共同成因。`src/sidecar.ts:231-237` 用进程级墓碑加九个白名单名字——`PATH`、`HOME`、`TMPDIR`、`TEMP`、`TMP`、`SystemRoot`、`SYSTEMROOT`、`WINDIR`、`LANG`——构建该子进程的环境，因此子进程拿不到任何代理变量，包括 `NO_PROXY`/`no_proxy`。其余所有 harness 子进程恰好相反：`packages/subprocess/subprocess-local/src/spawn.ts:44-46` 通过 `scrubbedParentEnv()` 构建环境，保留代理名字并叠加 `packages/util/http-proxy/src/install.ts:262-279` 解析出的豁免，而该清理与叠加发生在 `packages/subprocess/subprocess/src/index.ts:66-80`。豁免从来不是可选项：`packages/util/http-proxy/src/policy.ts:33` 列出 `LOOPBACK_NO_PROXY = ['localhost', '127.0.0.1', '::1', '[::1]']`，`policy.ts:206-211` 把这些条目并入每一个解析后的策略，`packages/subprocess/subprocess/tests/egress.spec.ts:137` 断言结果 `NO_PROXY === 'localhost,127.0.0.1,::1,[::1]'`，并注释说明没有它子进程会把自己的 localhost 流量发给代理。

没有任何代理变量时，Python 的 `urllib.request.getproxies()` 回退到 macOS 系统配置。本机 `scutil --proxy` 报告 `HTTPEnable 1` / `HTTPProxy 127.0.0.1` / `HTTPPort 7897` 与 `SOCKSEnable 1` / `SOCKSPort 7897`，其 `ExceptionsList` 含 `127.0.0.1` 与 `localhost`。该回退返回代理地址，却不返回例外清单：把所有代理变量清空后，`/opt/homebrew/bin/python3` 打印 `{"http": "http://127.0.0.1:7897", "https": "http://127.0.0.1:7897", "socks": "http://127.0.0.1:7897"}` 且没有豁免条目，而同一解释器在环境变量存在时还会多打一项 `"no": "localhost,127.0.0.1,::1,.local"`。httpx 0.28.1 只从该 `no` 条目推导豁免挂载（`httpx/_utils.py:47`），因此子进程为回环 URL 装上 HTTP 与 HTTPS 代理挂载且没有豁免，把请求发给 `127.0.0.1:7897` 的代理，收到被缓存空 `403`。

`prove-extraction-failure.mts` 与它的日志 `extraction-failure-diagnosis.log`（两者均由同一任务 1 的另一个会话记录在本证据目录中）端到端记录了同一链条，并表明该义务在本机无需提权即可观测。第 1 步用 `src/sidecar.ts:231-237` 构建的环境运行已安装 sidecar：退出 1、`status: "uncertain"`、`completedChunks: 0`、`tokensUsed: 0`、记录到的请求为 0。第 2 步检查子进程自身的客户端：`defaultHttpxResponse` 就是带空响应体的 `403`，`defaultHttpxJsonDecodeError` 是 `JSONDecodeError: Expecting value: line 1 column 1 (char 0)`，而同一请求加 `trust_env=False` 就能到达夹具并返回 `200`。第 3 步只在子进程环境中加入 `NO_PROXY=127.0.0.1,localhost` 重跑，已审批抽取路径即完成：退出 0、`status: "completed"`、`completedChunks: 9`、`tokensUsed: 468`、记录到 9 次模型请求。

**具名整改项 —— 知识子进程拿不到解析后的代理豁免。** 应让知识子进程获得与其余所有 harness 子进程相同的、解析后的代理环境，使系统代理无法捕获它的回环流量。这是产品缺陷，而不只是本机状况：任何处于系统代理之后的用户都会遇到同一个 `403`，而同一个缺失的豁免也会拒绝回环上的模型端点，例如本地自托管的 OpenAI 兼容服务。模板修复已经存在：`packages/util/http-proxy/src/install.ts:262-279` 与 `packages/subprocess/subprocess-local/src/spawn.ts:44-46`，即像 `packages/subprocess/subprocess/src/index.ts:66-80` 那样通过 `scrubbedParentEnv()` 构建子进程环境并叠加 `proxyEnvironmentForChild()`，而不是把所有代理名字都设为墓碑。本审计不实施该修复，只把它具名留给任务 2 或一个独立的小范围修复。

对本清单的结论是：已审批抽取义务在默认子进程环境中受环境阻塞，在显式回环豁免下完成，并带有具名的产品侧共同成因。该行在子进程获得解析后的豁免后重跑同一批控制项即可为基线验收关闭，无需主机提权。harness 呈现的 `ingest-failed` 消息就是子进程自身的错误文本，因此该失败已可从 harness 日志诊断。

## 100 MiB 上限建议

**建议：暂不采用 100 MiB 知识库上传上限。** 保持 `DEFAULT_MAX_INGEST_BYTES` 为 20 MiB，先落地任务 2 的 `File.slice()` 流式改造，再谈更高默认值。

实测证据从三个方向支持这一拒绝。整文件路径处理 100 MiB 文件时 RSS 峰值 808.8 MiB，约为载荷的八倍，且该数字不含 WebView 与渲染进程。100 MiB 上传需要 640 次串行分片调用与 139.8 MB 的 base64 线上数据，即文件的 4/3，而这一切发生在转换开始之前。并且现行准入上限本来就会在第 128 片拒绝，因此不先做流式改造而抬高上限，只会让注定失败的上传跑得更远。

内存与传输是方案写明的通过条件。传输现已在 Node 中测得：`transport-measurements.log` 记录桌面 RPC 路径上的一次 100 MiB 上传，吞吐 14.86 MiB/s，RSS 增量为 200 MiB，取消与冷重启在同一日志里各有用例。WebView 内存峰值与渲染进程行为仍未测得，因为它们需要浏览器 harness。两种测量的方法也不同——本审计的表格在首次调用前就物化整份编码载荷，而传输运行按阶段报告耗时——因此任一数字都不能替代另一个。转换维度已测得且当前安全：50 MiB 转换输出上限与 8 MiB DOCX XML 条目上限在边界与超一字节处都会显式拒绝，没有静默裁剪。

因此任务 2 应以本基线为起点获得授权，上限决定推迟到任务 2 给出 100 MiB 以内各尺寸的 WebView 数据之后；它所需的 Node 传输数字已存在于 `transport-measurements.log`。

## 已验证与未验证

本次由执行命令完全验证：K7、K11、K12、K13、K14、R2-3、R2-6、R2-8、R2-9。

已被被审代码树取代，附源码与已执行控制项为证：K3 与 R2-7。

环境受阻（默认子进程环境），且带有已具名的产品侧共同成因：K1、R2-1，以及 K5 的真实推理一半。三者都在显式回环豁免下完成。

仍开放但探针通过、且留有具名剩余义务：K2（冷启动与激活中断）、K4 与 R2-2（每个动作经真实 Host 远端的效果）、K5 的伪造一半（已关闭）与其受阻的推理一半、K6（共享提交锁）、K8 与 R2-5（保留来源包含性）、K9（注册失败恢复与一致性 SQLite 备份）、K10（按序列化请求计数预算）、R2-4（校验与发布之间的围栏），以及 R2-10 的 PDF 一半（已关闭）与其安装一半。

仅属发布范围、不在基线范围：K15 与 R2-10 的安装 worker 一半。它们阻塞发布验收，从不阻塞任何基线行。

## 任务 1 处置结论

**本审计不宣称基线验收通过。** 审计因一次被搁置的验收运行——默认子进程环境下的已审批抽取控制项——而处于暂定状态，并具名一个产品缺陷。任务 2 在具名前置条件下获得授权。

已完成的部分。25 条发现全部给出处置结论，每条结论都引用了 2026-10-16 实际执行的命令。三组测量完整并带文件与行号引用。九条发现直接关闭，两条已被被审代码树取代，第二轮审阅未重跑的五个必需控制项中有三项（K5 的伪造一半、K7、R2-6）现有执行证据。方案的开放决策已有答复：上限维持 20 MiB，直到 WebView 内存测量落地，因为仅有 Node 传输数字并不能定论。

暂定的部分。A20 要求改写前检查点可恢复，且既有发现的处置有证据。检查点一半已满足。处置一半对每条基线发现都已满足，但 A20 的否定控制项还会因「有必需控制项未重跑」而触发，且有两个验收控制项超出本任务可及范围。已审批抽取控制项同时因两个原因失败：本机拦截被启动子进程的回环 HTTP（已在不引入产品代码的情况下复现），以及知识子进程拿不到其余所有 harness 子进程都会获得的那份解析后代理豁免。同一批控制项在子进程获得该豁免后即完成，因此该路径在这里既未被证明损坏、也未被验收通过；其共同成因已作为独立整改项具名于上。方案把基线验收定为「全部必需发现关闭」，因此本审计陈述该状态，而不宣称通过闸门。安装产物验收（K15、R2-10 的安装一半）需要本任务不得执行的 DMG 构建，且它只约束发布验收。

任务 2 的前置条件。

1. 先让知识子进程拿到解析后的回环豁免（这是产品侧修复，无需主机改动），或改在没有子进程 HTTP 拦截的环境中（例如收窄的主机提权）重跑已审批抽取控制项，之后再把该路径视为已验证或已损坏；两条路线都要落地已具名的代理豁免整改项。
2. 保持 `DEFAULT_MAX_INGEST_BYTES` 为 20 MiB，并在发布任何更高上限之前先落地 `File.slice()` 流式改造。
3. 把 K15 与 R2-10 的安装 worker 一半当作发布验收闸门；它们从不关闭基线行。
4. 把仍开放的发现及其具名剩余义务带入任务 2 的方案。

本审计不产生任何发布结论。

## 证据索引

全部原始证据位于 `.plans/desktop-ask-knowledge/baseline-audit-2026-10-16/`。下文列出该目录中的全部脚本、探针、日志与控制项。

测量脚本：`measure-upload-path.mts`（测量 A）、`measure-caps.mts`（测量 B）、`measure-attachment.mts`（测量 C）、`measure-transport.mts`（Node 中 Client → `ProcessTransport` → `StdioLinePort` 传输，含取消与冷重启）。

探针：`probe.mts` 与 `probe2.mts`（测量脚本之前的模块解析冒烟检查）、`prove-extraction-failure.mts`（K1/R2-1 三步诊断：默认子进程环境、子进程自身 httpx 行为、以及加入回环豁免后的同一运行）、`controls/child-network-control.mjs`（父进程与子进程对照的回环控制项）、`controls/k5-synthetic-extractor.py`（已移除的合成抽取器）。

日志：`upload-path-measurements.log`、`caps-boundaries.log`、`attachment-api-controls.log`、`adversarial-controls-rerun.log`、`followup-controls-rerun.log`、`controls-rerun.log`、`package-suite-bounded.log`、`package-enrichment.log`、`upload-approval-late-content-fail.log`（`upload-approval.spec.ts` 末尾内容用例的失败运行）、`child-network-control.log`、`extraction-failure-diagnosis.log`、`k5-synthetic-extractor.log`、`k7-process-ownership.log`、`r2-6-source-durability.log`、`k3-cursor-continuation.log`，以及 `transport-measurements.log`（12,424 字节，测得时间 2026-10-17T02:43:34Z，覆盖 `askKnowledge` 桌面 RPC 与官方附件上传传输）。

控制项：`controls/production-controls.spec.ts`、`controls/review-independent.spec.ts`、`controls/actions-controls.client.spec.ts`、`controls/review-wiring.client.spec.ts`（重跑的审阅控制项，仅改写相对导入说明符）、`controls/approval-flow-controls.spec.ts`（审批感知控制项），以及 `controls/vitest.controls.config.ts`。

改写前检查点及其承载的代码树清单位于 `.plans/desktop-ask-knowledge/baseline-checkpoint-2026-10-16/`。
