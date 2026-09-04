# Agent Note: 将 self-evolving-skill 装入 project-agents

Status: implemented

[English](2026-09-04-self-evolving-skill-project-agents.md) | 中文

## Problem

修订后的 Agent Self-Evolution 方案只存在于 Sisyphus 设计与本机 `~/.dsh/skills/self-evolving-skill/SKILL.md`。fork 协作者与 octopus_DSH checkout 拿不到该 skill，frontmatter 缺 `whenToUse`，且方案夸大了默认对 `session_search` 的可用性。

## Decision

把 prompt-only skill 提交到 `.agents/skills/self-evolving-skill/SKILL.md`（project-agents，rank 200），补上 `whenToUse`，并写明仅在组合挂载 `tool-session-query` 时 `session_search` 才可选可用。保持零新包、无 promote/distill 工具。更新 `.sisyphus/plans/agent-self-evolution.md` 记录该放置。

## Alternatives considered

- **只保留 user-dsh。** 否决：个人安装对 fork 不可复现。
- **把 `tool-session-query` 挂进默认桌面/headless。** 延期：超出 skill 落地范围；skill 不得依赖该工具。
- **加 `validate_skill` / Stop hook。** 延期：按修订方案等观察到痛点再加。

## Consequences

- clone 本 fork 的协作者在 project-agents 下即可看到该 skill，无需手动装到 home。
- 没有 `session_search` 的默认 profile 仍可从当前对话蒸馏。
- §4.2 真实冒烟（2026-09-04）：隔离临时工程 + headless 返回 `SMOKE_RESULT=PASS`——多步 greet 脚本、经 `self-evolving-skill`/`write` 蒸馏到 `.dsh/skills/smoke-greet-distill/SKILL.md`，再用 `skill` 确认加载。`whenToUse` 一度因 YAML 冒号未加引号注册失败，模型自行修正后成功。
