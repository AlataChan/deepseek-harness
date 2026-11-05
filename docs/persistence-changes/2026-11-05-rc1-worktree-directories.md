---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-05-rc1-worktree-directories

English | [中文](2026-11-05-rc1-worktree-directories.zh.md)

## Summary

Adds required working-directory/change events, a working-directory message source and workingDirectory projection. Adds required worktree/record request, cancel, created, restoring and restored records with forgeWorktree projection.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-05-rc1-worktree-directories
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-14-persistent-assistants-stage-c"
    after: "589c40dfcf75db2f53f7b8dad956a5cee91218496f007ecfbe136f83df50e25a"
    decision: same-version
  - root: "event:assistant/auxiliary"
    previous: "2026-10-14-persistent-assistants-stage-c"
    after: "38033a3c71f48f43420b9d2eee6f1d5b702e3d4f53628a9509759d1a77b2c649"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-14-persistent-assistants-stage-c"
    after: "a30e4bb3c1e8878e52a6a7c7614bfcb941f76957d74f37951b773091ef8dca30"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-14-persistent-assistants-stage-c"
    after: "6d7de69faba4defbdf9c384671401b6c67fa5ecf0fc38630055c8265c3eb4965"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-14-persistent-assistants-stage-c"
    after: "2e9dc9eb417abe5c021c31782f5e510f8f063db0cac9e34f1c5fe5a608644b4c"
    decision: same-version
  - root: "event:working-directory/change"
    previous: null
    after: "124aa62078ca3311353b39cc3bf6c75da281338be6bbf672f8b361d828cddca3"
    decision: same-version
  - root: "event:worktree/record"
    previous: null
    after: "e77034285cded4066f8070cb67d6f7ade6da3a625e97996fc4c92d5596ab83ca"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing format-4 logs remain valid and are not rewritten. These new event types are required on read, not ignorable. Older builds without their declarations refuse logs that contain them. Header.cwd remains the original project; projection-cache domain version 7 and SQLite schema version remain unchanged. Frozen historical generations and nine existing required fork event types are preserved.

<a id="verification"></a>
## Verification

Independent root direct-Node Vitest run: 11 new-owner files and 92 tests passed, covering real Git creation/restoration, sandbox refusal, directory admission, cold Host controllers and actual dual-face discovery. Hooks/workflow/question-guard regression run: 261 tests passed. The current type classifier reports exactly two new required event roots and five attribution-only source expansions, all same-version; historical Session generations and SQLite version remain unchanged. These focused results do not establish final shipping acceptance.

<a id="dev-note"></a>
## Dev Note

None.
