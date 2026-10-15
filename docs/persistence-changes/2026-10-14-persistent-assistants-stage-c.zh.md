---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-14-persistent-assistants-stage-c

[English](2026-10-14-persistent-assistants-stage-c.md) | 中文

## 概述

增加辅助模型请求与结果的持久化事件，并为团队消息来源添加可选轮次、席位与尝试标识。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-14-persistent-assistants-stage-c
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "8d6d169e0686e16e4100c89d63c428ad0a5f22cea30f6f53ad6b9afa825d1e02"
    decision: same-version
  - root: "event:assistant/auxiliary"
    previous: null
    after: "79e3fc324e191d383cf1c75b769a2227541a7e0fbb72109b4ca46f44be170961"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "c86d1887b96de0786b9856d58442d1201dd0ae3c260f18b83732d3497da3f9e3"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "e6f5f5cc201eee7bf373160824e2880e58e3e59f86c94d046b0943bfe3d8c03e"
    decision: same-version
  - root: "event:team/message/delivered"
    previous: "2026-09-11-initial"
    after: "7eacb833004f621660b4fb891ade6e5db35e328e35ab090d95ff280df6ff2f41"
    decision: same-version
  - root: "event:team/message/queued"
    previous: "2026-09-16-session-format-v4"
    after: "44d9bbe3954084b0b53b14f62583f242a0cb3b0de465a93395e0812169289976"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "4c1b79b5d35c4da155a13a1f8a73d166d66e8e641432876ea9bedb47e6d48c85"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍然有效。本次只扩展事件词汇，不改变会话编码或写入版本。包含 assistant/auxiliary 的日志需要支持 assistant-registry 的读取端；辅助事件不进入主会话展示。轮次、席位与尝试字段均为可选，保留既有团队消息来源。

<a id="verification"></a>
## 验证

五个功能包的测试共 532 项通过；专门验证了辅助请求重建、冷重启后计费去重、带标识的执行权与中断回复恢复。

<a id="dev-note"></a>
## 开发备注

无。
