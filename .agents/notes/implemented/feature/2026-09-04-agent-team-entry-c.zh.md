# Agent Note: 浅化 Agent Team 顶栏入口（方案 C）

Status: implemented

[English](2026-09-04-agent-team-entry-c.md) | 中文

## 问题

协作关系图藏在「顶栏 → 面板 → 中段滚动」之后，用户不打开厚重下拉就看不到队友动态。

## 决策

仍用顶栏下拉（先 C、后右坞 A）。每个会话静默预取一次 `TeamView`，顶栏显示人数徽章（`count` 或 `running/count`）。打开面板时先展开并滚到协作关系，再是名单与任务。不轮询；刷新策略不变。

## 备选

- **立刻做右坞（A）**：延后（布局成本高；先用 C 验证入口）。
- **左栏队友列表**：否决（与会话/文件抢位）。

## 后果

- 切换会话会多一次静默 `view`。
- 日后右坞可复用同一 `TeamView` / interactions 投影。
