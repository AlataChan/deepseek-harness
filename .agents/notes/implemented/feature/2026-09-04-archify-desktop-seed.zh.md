# Agent Note: Archify 桌面 bundled-skill 种子

Status: implemented

[English](2026-09-04-archify-desktop-seed.md) | 中文

## 问题

桌面用户需要开箱可用的 Archify，但 `@tt-a1i/archify-dsh` 是 skill-only，通不过 web `dsh.client` 的 profile-plugin 种子校验。

## 决策

通过 `Resources/resources/bundled-skills/` → `~/.dsh/skills/archify` 默认分发，而不是写入 `desktop-profile-plugins.json`。在 `scripts/desktop-bundled-skills.json` 钉 npm 源。实时协作仍是 Client Team 舱；Archify 只做事后。

## 备选

- **Profile-plugin 钉包。** 否决：校验要求 `dsh.client`。
- **继续纯 opt-in。** 否决：分发用户看不到 skill。

## Consequences

安装版桌面用户无需单独添加插件即可获得 Archify。该 skill 增加了随包文件和 npm 来源版本钉定，但不会进入默认 agent 组合，也不会在任务完成时自动运行。

## 验证

```bash
node scripts/seed-desktop-bundled-skills.mjs --out /tmp/dsh-bundled-skills-test
test -f /tmp/dsh-bundled-skills-test/archify/SKILL.md
```
