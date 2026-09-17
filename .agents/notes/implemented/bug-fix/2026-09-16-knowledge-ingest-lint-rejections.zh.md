# Agent Note: 知识库入库不再打回多页提案

Status: implemented

[English](2026-09-16-knowledge-ingest-lint-rejections.md) | 中文

## Problem

用户往知识库加的每一份文档都只回一句「整理词条没有写出可检索的页面。」，原文仍留在 `raw/` 里，没有可检索的页面。库里那些拒件记录是 `rule_id: null`、`reason: "post-apply lint failed"`，且完全没有 `rule_results` —— 磁盘上和线上都没有任何东西说明原因。

拿冻结的 sidecar 对真实库的副本重跑，逐字复现：`{"ok": true, "status": "rejected_post_lint", "verdict": "pass"}`。声明式规则是通过的；写入之后出现了新的严重 lint 发现，`apply.py` 于是把整份提案回滚。把那套 lint 重算一遍，就得到了拒件丢掉的那些发现：

- 三份文档里有两份引入了 `ALIAS_COLLISION`，来自它们自己两个页面共享的 tag（`pytorch`、`multiagent`、`specificationgaming`、`generativeai`、`mlops`）。
- 有一份是拿文档自己的名字撞车：源页标题取自 slug 化的文件名（`A_Hands-On_Guide_…`），摘要页用的是真标题，而冲突键是按**标题字符串**去重而不是按归一化后的键。

这背后是三个各自独立的机制，外加藏在后面的第四个缺陷。

`fill_create_page_frontmatter` 把**每个** tag 都提升成该页的 `aliases`。一个别名指向多个页面就是 `ALIAS_COLLISION`，属于严重项，所以只要一份文档的两个页面共享任何 tag（英文技术文档几乎必然如此），整份提案就被打回。而 tag 检索从来不需要这个提升：`lookup.py` 直接读 `frontmatter["tags"]`。

别名冲突检测把每个页面都算了进去，包括入库的源文件。源页和由它整理出的 wiki 页本来就共用文档名，所以它们共享的那个键是明确的解析目标，不是冲突。多页提案此前是过还是挂全看标点：早先能过的中文文档，只是因为文件名 slug 恰好与摘要标题字符串完全一致，去重把两者折叠了。

`apply_proposal` 把发现丢掉了。`_introduces_severe_lint` 比较两个发现集合却只返回布尔值，拒件又以 `rule_results=[]` 写入，于是记录里没有规则、没有路径，sidecar 只回一个状态。

接着日志追加因为自己的原因失败。某份提案把 `append_log` 写到 `wiki/log.md`，而 vault 里是 `wiki/LOG.md`。在不区分大小写的文件系统上它们是同一个文件，追加确实读到了真日志，但暂存记录带的是另一种拼法，那个页面既有的发现于是看起来像是新引入的。

最后，把一份真实文档重新 propose 又暴露了一个静默问题：模型给 `append_log` 操作打了 `confidence: 0.6`，声明式链把整份提案 defer，于是**什么都没写** —— 词条进了 `.octopus-kb/inbox/`，`recover` 对它回 `nothing_to_recover`，既没有 accept/review 命令，也没有任何界面会读它。而选择器把这份文件报成「已入库」。

## Decision

tags 就是 tags。`fill_create_page_frontmatter` 不再把它们提升进 `aliases`；页面保留模型自己写的别名，tag 保持为 tag —— 这本来就是 `lookup.py` 读的东西。这一改动消灭的是整类冲突（提案内与跨次入库），而不只是观测到的那几对。

别名冲突检测跳过 source 页。`_collect_alias_targets` 增加 `include_sources` 参数，`find_alias_collisions` 传 false，而 `build_alias_index` 仍然包含它们：源页依旧是 wikilink 与 lookup 的目标，只是不再让由它自己整理出的摘要显得含糊。

`apply.py` 把打回的理由报出来。`_introduced_severe_lint` 返回发现集合，`_severe_lint_rule_results` 把它整形成 audit 已在使用的 `rule_id` / `verdict` / `reason` 行，拒件记录与 `ApplyResult` 都带上 —— 于是 sidecar 响应带着规则和路径到达 Host。Host 把每条严重 code 映射成操作者中文，并原样附上线上 detail，因为 detail 里写着是哪个页面。

append 或 alias 操作会沿用 vault 自己对同一路径的既有大小写拼法（`ObsidianStore._vault_spelling`），所以 `wiki/log.md` 落进 `wiki/LOG.md`。vault 里不存在的路径不做改写，因此在区分大小写的文件系统上，真正新建的文件仍然是新发现。

deferred 的提案报成「没写进去」。`ingestOne` 返回 `applied` / `deferred` / `failed`，而不是「原因或 undefined」；批次行把 deferred 文件标成未写入，且不计入已落地，所以只有真的写进去了才会挂库。

入库不再 defer：`builtins.yaml` 删掉 `confidence.tier_gate_defer` 规则。defer 会把操作停进 `.octopus-kb/inbox/`，没有任何界面读那个队列，`recover` 对它的条目回 `nothing_to_recover`，所以在这套产品里这条规则只会丢文档。低于 0.4 的 `confidence.tier_gate_reject` 仍然保留，schema、lint、规范名、路径等规则一概未动。

被拒的提案是被「修复后重跑」，而不只是重跑。原先只会改写 page-meta 的 heal，现在在拒件记录了 post-apply lint 失败时，还会去掉退役 fill 从该页自己的 tags 复制出来的别名 —— 这正是让本次改动之前被拒的文档能落地的东西。改动之前写下的拒件记录只有原因、没有 rule_results，所以判定同时接受两种形态。

## Alternatives considered

**只在恰好一个页面认领某 tag 时才提升它。** 否决：这只能修观测到的那几对，下一份文档照样坏 —— 更早一次入库用过的 tag 会在跨次比较时撞车，而要做到正确还得知道 vault 的现状。删掉提升才是治因，而 tag 检索本来就读 tags，什么都没损失。

**别名索引只保留 wiki 页。** 否决：源页是合法的 wikilink 与 lookup 目标，把它从解析里拿掉会让指向它的链接失效。只有「歧义判定」排除它。

**比较 lint 签名时把路径大小写折叠。** 否决：在区分大小写的文件系统上 `wiki/log.md` 确实是第二个文件，折叠会掩盖真实的新发现。把操作解析到 vault 自己的拼法在两种系统上都正确。

**让 Host 在被打回后自行重算 lint 发现。** 否决：那等于用 TypeScript 复刻 sidecar 的页面记录、别名索引和规范名折叠，并且会与它们漂移。

**像以前那样把 deferred 当成功。** 否决：什么都没写却报成已加入，比这份 note 修掉的拒件更糟。这条规则随后被直接删掉：既然没有复核台，defer 就没有读者，留着它只会养出一个只增不减的队列。

**保留统一的一句话，把细节写进日志。** 否决：只有操作者能对它采取行动，而一个会静默吞掉文档的知识库没有第二个观察者。

## Consequences

当一份多页提案的页面共享 tag 时它现在能入库了 —— 这是英文文档的常态 —— 而且同一份文档可以入库第二次，不会与第一次撞车。tag 仍留在每个页面上，tag 检索不变；只是派生别名没了，所以原先靠 tag 别名命中的查询现在通过 `tags` 命中。

被打回的提案会在拒件记录、sidecar 响应和选择器的错误行里注明规则与页面。`SOURCE.txt` 记录了这四条 vendored 补丁，且必须重建冻结 sidecar 才能出货（`scripts/build-kb-sidecar.sh`；`build-dmg.sh` 会就地校验该 runtime）。

deferred 的提案不再报成已入库；用户会看到这份文件需要一次目前还没有界面提供的人工确认，词条会留在 inbox 里直到有为止。

deferred 的提案不再报成已入库，而中等置信度的提案也不再 defer：它会直接入库 —— 这正是报告里那几份文档需要的。

在这次改动之前被拒的文档，会在其所在库下一次被挂上时被修复并重跑：heal 会去掉它磁盘上的提案仍然带着的、由 tag 派生的别名，所以不需要重新上传。在报告所用 vault 的副本上实测，这让可检索页面从 0 变成 9 份文档。验证见 `tests/ingest-alias.spec.ts` 驱动 `tests/helpers/ingest-alias-check.py`（共享 tag、源名摘要、vault 的日志拼法，以及真实冲突仍被 `ALIAS_COLLISION` 打回）、`tests/propose-json.spec.ts`（fill 的字段）、`tests/ingest.spec.ts`（报出的规则与页面，以及救援只摘除 tag 别名）、`tests/library-picker.client.spec.tsx`（deferred 行）。
