---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-14-persistent-assistants-stage-c

English | [中文](2026-10-14-persistent-assistants-stage-c.zh.md)

## Summary

Adds durable auxiliary inference request/outcome events and optional keyed round attribution to team-message sources.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing records remain valid. This adds event vocabulary without changing the session encoding or writer version. Logs containing assistant/auxiliary require an assistant-registry-capable reader; auxiliary events do not enter the primary conversation surface. Optional round, slot, and attempt fields retain legacy team-message sources.

<a id="verification"></a>
## Verification

The five feature package suites pass 532 tests; focused controls verify auxiliary request reconstruction, deduplicated billing after cold restart, keyed ownership and interrupted reply recovery.

<a id="dev-note"></a>
## Dev Note

None.
