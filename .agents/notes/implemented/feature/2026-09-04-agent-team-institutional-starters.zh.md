# Agent Note: 机构向 Agent Team 启动话术

Status: implemented

[English](2026-09-04-agent-team-institutional-starters.md) | 中文

## 问题

团队面板原先填入通用的 researcher / writer / 列出队友话术。公益与机构用户需要贴合文书、案例沉淀、传播流水线的小队提示；同时队友 `name` 必须保持 lower-kebab-case。

## 决策

三枚填入按钮改为 `document` / `case` / `comms`。正文使用英文 kebab 的 `name=` 与中文职责，要求共享任务串行、禁止编造指标，主控只分派收口不写终稿。实时图与 Archify 仍为独立层；Archify 仅可选安装 `@tt-a1i/archify-dsh`，不进桌面默认种子。

## 备选

- **中文直接做 teammate name**：否决（校验为英文 kebab）。
- **仅公益 preset 显示机构话术**：延后；机构文案对所有用户更清晰。
- **按钮直接 spawn**：否决；创建仍由对话里的 Lead 完成。

## 后果

- 仍只填入输入框，不自动发送。
- 后续：同 TeamView 的瘦实时图；可选 Archify 事后总结图。
