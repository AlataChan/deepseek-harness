# term-glossary

本地术语词表：把用户的大白话描述对应到准确术语（前端、AI、Git 等），供桌面端技能使用，不依赖外部站点可达性。

- `SKILL.md` — 模型侧规则：何时顺带点出术语、怎么措辞、每轮最多 1-3 个。
- `data/inventory.json` — 词条名称/别名/分类/链接清单，来自 VibeHub（vibe-hub.org）公开接口，仅事实信息，不包含其解释文案。
- `data/plains.json` — 每条词条的白话解释，本项目自写。
- `data/glossary.json` — 合并产物（`lookup.mjs` 运行时读取这个文件）。
- `scripts/lookup.mjs` — 本地查询 CLI，无网络请求。
- `scripts/self-check.mjs` — 一条可跑的检查：数据完整性 + 口语查询命中。

刷新清单：`node scripts/fetch-inventory.mjs`
写/改解释：编辑 `data/plains.json`，然后 `node scripts/build-glossary.mjs`。
验证：`node scripts/self-check.mjs`

`fetch-inventory.mjs` 与 `build-glossary.mjs` 只在维护词表时运行（抓取会联网），用户机器上不需要执行。

来源说明：上游 vibe-hub-skill 仓库为 MIT（仅代码）；vibe-hub.org 站点内容无授权声明，故本项目只取名称/别名/分类/链接这类事实清单，解释文案全部自写。
