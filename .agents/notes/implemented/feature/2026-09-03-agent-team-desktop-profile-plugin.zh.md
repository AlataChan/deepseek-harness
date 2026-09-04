# Agent Note: 把 Agent Team 打进 octopus_DSH 桌面 profile plugins

Status: implemented

[English](2026-09-03-agent-team-desktop-profile-plugin.md) | 中文

## 问题

Agent Team 只存在于 `packages/experimental/` 以及 headless/Web profile overlay。octopus_DSH DMG seeding 读取 [scripts/desktop-profile-plugins.json](../../../scripts/desktop-profile-plugins.json)，并要求每个 pin 都是 dual-face 包（`dsh.bundle.patch` + `dsh.client` + 磁盘上的 `./client`）。`agent-team-profile` 与 `agent-team-web-profile` 只是 Host patch bundle，无法通过 seed 校验，因此从未进入 `Resources/resources/profile-plugins/`。安装 DMG 的用户用不了新开发的 Team tools 与 roster UI。

## 决策

让 `@deepseek-ai/dsh-experimental-client-ui-agent-team` 成为桌面 seed pin。新增 `cordis.patch.yml`：禁用重叠的全局 continuable-child 控件，插入 Host Team service 与 tools，再插入本包以挂载 Client half。在 `desktop-profile-plugins.json` 以 `source: "workspace"` 钉住。Headless 与源码 Web 仍使用 `agent-team-profile` + `agent-team-web-profile`；新 patch 只作桌面 seed 文档。Host 包继续通过 CLI harness collect 解析（`agent-team` / `tool-agent-team` 已是 CLI 依赖）。

## 考虑过的替代方案

- **新建 `desktop-agent-team` dual-face 包并 re-export Client UI。** 否决：client feature plugin 不得 runtime-import 或 re-export 另一个 feature plugin；薄包装要么违规，要么复制 UI。
- **只钉 `agent-team-profile`。** 否决：seed 校验要求 `dsh.client` 与 `./client` export。
- **先把 Agent Team 从 experimental 晋升。** 否决：超出「让 fork 桌面能用」的范围；晋升保留既有 checklist。

## 后果

- 首次桌面启动会为仍携带 seeded bundle 的 profile 安装 Team Host tools 与页头 roster UI。
- 用户若已从 profile 删掉该 bundle，heal 不会重新插入（与其他 overlay 相同）。
- 若 `src/*.js` 残留盖住 TypeScript 源，Vitest 会解析到过期产物并弄坏 `SessionLogOffset` / `SessionSeq`；混乱合并后应先清掉再信本地 Agent Team 测试。
