---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-12-fork-session-events

English | [中文](2026-10-12-fork-session-events.zh.md)

## Summary

Records the existing fork events for data, knowledge, commerce, and media sessions, plus the optional team member model selection.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing records without these events or the optional model field remain valid. Readers must know the fork event vocabulary to read logs containing these required events. This acknowledgement does not change the writer version, migrate records, or introduce downgrade support.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/session/session-persistence-jsonl/tests/v3-restart-migration.spec.ts packages/session/session-persistence-jsonl/tests/catalog-migration.spec.ts: 86 passed and one platform-specific test skipped. pnpm run verify-upstream-intake passed.

<a id="dev-note"></a>
## Dev Note

None.
