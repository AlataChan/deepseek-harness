---
kind: upgrade-guide
description: "Plugins that route models through agent/request must select through Agent.model before step preparation."
---

# Select the model before preparing a step

English | [中文](guide.zh.md)

## Change

Plugins could previously change provider, model, or reasoning effort in `agent/request`. Those fields are now captured before tool resolution, prompt assembly, and `agent/pre-step`. A request listener that changes the captured selection is rejected. Request listeners may still constrain `maxTokens`, including round-budget enforcement.

`Agent.model.current()` reads the durable pending choice, then the last recorded request, then `AgentOptions`. An absent reasoning effort leaves the provider default unpinned. Resuming a Session therefore does not replace its recorded choice merely because different `AgentOptions` are supplied.

`Agent.model.origin()` distinguishes an explicit choice, an inherited profile selection, and a header/options-only fallback (`null`). Profile synchronization calls `select(selection, 'inherited')`; user choices omit that argument. Selecting the same route with a different origin records that intent, including clearing an override. Historical selection events without origin remain explicit; a historical request header alone is not an explicit choice. Origin metadata stays out of provider request configuration.

This affects plugins and custom entry integrations that selected a route during request assembly. Desktop model selection continues through its existing Host controller. Session logs remain readable; an incompatible cached model-selection projection is refolded from the log rather than treated as a current value.

## Migration

1. Find route mutations in `agent/request` listeners. Replace provider, model, and effort changes with `agent.model.select(selection)` before the intended step begins preparation. Keep unrelated request constraints and call `next()` in waterfall listeners.
2. Read the captured `modelSelection` from prompt assembly or pre-step context when rendering model-dependent instructions or checking capabilities. A selection made after capture affects a later step; it does not reroute an in-flight request or its retries.
3. Replace `ModelSelectionRef` and the two-argument `installModelSelection` helper. The helper now receives only the Agent context; durable selection belongs to `Agent.model`. Custom Agent implementations and typed fixtures implement its `current()`, `origin()`, and `select()` methods.
4. To override the selection of a restored Session, call `agent.model.select()` explicitly before the next step. Pass no `reasoningEffort` property when the selected provider should choose its default.
5. Verify the actual request provider, model, and effort during a model switch, retry, and cold restore, including explicit choices equal to the profile default and an override that was subsequently cleared. Confirm that prompt variables and capability checks use that same selection, and that round-budget `maxTokens` limits remain effective.
