---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-12-fork-session-events

[English](2026-10-12-fork-session-events.md) | 中文

## 概述

记录分支已有的数据、知识、商户和媒体会话事件，以及队员可选的模型选择字段。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-12-fork-session-events
baseline: false
changes:
  - root: "event:ask-data/bound"
    previous: null
    after: "2a67e58ae681bcc316e9ec0499adef6a39ee48370bcca0a258dc046976bb8a4b"
    decision: same-version
  - root: "event:ask-knowledge/bound"
    previous: null
    after: "93ccbd84f34655bcdf6bbf1f5dbef7f8d95ab51e5f4d800982da99a7cc353684"
    decision: same-version
  - root: "event:ask-knowledge/unbound"
    previous: null
    after: "794cbc52faab61299d1138ada1ade5039591e160de3f4c762f2324e916dedb6f"
    decision: same-version
  - root: "event:commerce/bound"
    previous: null
    after: "f395569ea0ea07ae5c51db8f09f1d53fa4e940bdcc8830e9aba04bd6a411f9df"
    decision: same-version
  - root: "event:media/approval"
    previous: null
    after: "7c10e657417c1ea1305461fc3b4338fd2f2f508a70ddb941f2702c09f398caf4"
    decision: same-version
  - root: "event:media/artifact"
    previous: null
    after: "04416393d3f112ad4c9ce58c80c97ba1d595c230a8f47f669ce0790f9dca78e8"
    decision: same-version
  - root: "event:media/request"
    previous: null
    after: "004db5896647b3b64baca0623c7ba8527ff436fc046b2e016edc0b3e79867cd5"
    decision: same-version
  - root: "event:media/stop"
    previous: null
    after: "c29b5a5712793fdcdd18c997bbf35f60ef55947ddc132f2087542447662dacf1"
    decision: same-version
  - root: "event:media/task"
    previous: null
    after: "4f180121fb561d10cc362989276eb5d7a2a1ff95a749009a531b95b11b107e48"
    decision: same-version
  - root: "event:team/member"
    previous: "2026-09-11-initial"
    after: "0bff5e9256cf33b10e27a092105d23885a2f68bbe449ed1a68df551d449d619b"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

不含这些事件或可选模型字段的已有记录仍然有效。读取含这些必需事件的日志时，读取器必须识别分支事件类型。本次确认不改变写入版本，不迁移记录，也不提供降级支持。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/session/session-persistence-jsonl/tests/v3-restart-migration.spec.ts packages/session/session-persistence-jsonl/tests/catalog-migration.spec.ts：86 个测试通过，一个平台限定测试跳过。pnpm run verify-upstream-intake 通过。

<a id="dev-note"></a>
## 开发备注

无。
