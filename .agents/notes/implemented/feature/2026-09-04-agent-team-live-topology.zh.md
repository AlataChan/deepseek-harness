# Agent Note: Team 面板实时协作关系图

Status: implemented

[English](2026-09-04-agent-team-live-topology.md) | 中文

## 问题

已约定的 Agent Team 分层需要空间视图展示谁在跑、待投递消息与任务依赖。若继续推迟，只剩名单/任务 CAS 面板，与「对话 / 面板 / 实时图 / Archify」的健康拆法不一致。

## 决策

在既有 `agentTeams.view` 的 `TeamView` 上增加瘦 `interactions` 边（待投递 mailbox 跳转、负责人之间的任务依赖；不含消息正文）。Team 面板内用同一 load/refresh 路径渲染可折叠固定布局关系图。面板打开时默认显示；可用 sessionStorage 隐藏；不轮询、不新增第二套 Host API。

## 备选

- **单独拓扑 Remote**：否决（重复投影权威）。
- **力导向/持续动画**：否决（成本高且不增加事实）。
- **仅 Client 推导消息边**：否决（pending mailbox 只在 Team journal）。

## 后果

- 已投递消息离开 pending 队列后不再出现在实时图；事后叙事仍交给 Archify。
- 真正的推送更新仍依赖 Client 投影流；在此之前，关系图随面板刷新（打开、手动刷新、任务变更）前进。
