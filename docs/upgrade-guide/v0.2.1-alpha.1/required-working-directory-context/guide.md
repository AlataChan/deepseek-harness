---
kind: upgrade-guide
description: "Required execution-directory context remains visible when optional runtime context is disabled."
---

# Session execution directory

English | [中文](guide.zh.md)

## Change

includeRuntimeContext: false and suppressRuntimeContext() suppress optional runtime facts. They retain required directory text. PromptContext adds required and interpolate; interpolate: false preserves literal paths. Admission refresh evaluates registered runtime-context providers after route preparation, while accepted sections, tools and variables remain captured. The resulting model request is reconstructed from committed Session events.

## Migration

1. Keep optional-context suppression settings if desired; they no longer hide the directory used for execution.
2. Custom runtime-context providers may set required: true only for operational facts needed despite suppression; set interpolate: false for literal paths.
3. Verify cwd changed during pre-step or prepareCall appears in the first dispatched request and its logged runtime-context message. Do not rerun prompt-section or tool providers at admission.
