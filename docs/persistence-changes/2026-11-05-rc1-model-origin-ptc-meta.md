---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-05-rc1-model-origin-ptc-meta

English | [中文](2026-11-05-rc1-model-origin-ptc-meta.zh.md)

## Summary

Records optional model-selection origin and cancelled nested-tool result metadata.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-05-rc1-model-origin-ptc-meta
baseline: false
changes:
  - root: "event:model/selection"
    previous: "2026-09-11-initial"
    after: "0c037e23a3d0620697e09e3de3b218de6d154ec13e3d2c362c1b7a06b12b1d42"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-16-session-format-v4"
    after: "d66e11dddf5dfa3c71547e2cbd7b0608824cd8d6243fc16f532017ff28e8fba5"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing Session records remain valid and the writer format stays unchanged. A model/selection event with absent origin remains an explicit choice; a request header without a selection event is not a user pin. Derived modelSelection cache version4 refolds older cache data to recover that distinction. Optional tool/ptc-dispatch meta retains known applied changes after a started call is cancelled; missing metadata makes no claim about effects or rollback. Frozen compatibility generations and required fork events are preserved.

<a id="verification"></a>
## Verification

Independent model-selection and PTC executor tests:24 passed; full core/Node/skill source run:1540 passed and1 skipped; cold catalog and entry tests:75 passed; all seven filesystem/SSH owner suites including cancellation and nested images:665 passed and3 skipped. Broader filesystem coverage exposes2 unchanged formatter gaps, recorded separately; changed executable source counters are all covered. Built Node provider smoke:4 passed. Full Host bundles compile; Client and installed integration acceptance remains separate.

<a id="dev-note"></a>
## Dev Note

None.
