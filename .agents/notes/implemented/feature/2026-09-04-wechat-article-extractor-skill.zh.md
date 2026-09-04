# Agent Note: 上架微信公众号提取 skill 并加软限流

Status: implemented

[English](2026-09-04-wechat-article-extractor-skill.md) | 中文

## Problem

fork 本机已有 `~/.agents/skills/wechat-article-extractor` 可读公众号文章，但未入库、未随 octopus_DSH 分发，也没有防止大规模 URL 抓取触发平台 1004 的事前限流。

## Decision

1. 将 skill 提交到 `.agents/skills/wechat-article-extractor/`（project-agents），`SKILL.md` 以中文说明为主。
2. 在 `scripts/rate-limit.js` 增加本地软限流（宽松默认：每小时 8 次 URL 抓取、间隔 ≥20 秒、遇 1004 冷却约 15 分钟），并由 `extract.js` 在 URL 抓取时包装。
3. 通过 `Resources/resources/bundled-skills/` 打进 DMG（`scripts/seed-desktop-bundled-skills.mjs` + `scripts/desktop-bundled-skills.json`）。启动时 `install_bundled_skills` 拷入 `~/.dsh/skills/`（user-dsh），并保留 `.rate-limit-state.json`。

## Alternatives considered

- **只靠 Prompt 限流。** 否决为唯一手段：模型仍可能连发请求。
- **新建 Cordis 工具包。** v1 否决：现有 skill 脚本已可用；正式 Host 工具改动面过大。
- **只放进仓库 `.agents/skills`。** 不足：桌面用户工作区往往不是本仓库。

## Consequences

- 仓库协作者在本 fork 工作区可见该 skill；桌面用户安装含 `bundled-skills` 的 DMG 后会在 `~/.dsh/skills` 得到副本。
- 计数器与 skill 同目录并在刷新后保留；`node_modules` 在打 DMG 时安装，不入库。
- 大规模抓取仍被劝阻；闸门是本地软限制，不是微信 API 契约。
