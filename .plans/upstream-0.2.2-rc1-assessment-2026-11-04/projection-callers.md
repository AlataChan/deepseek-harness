# Projection registration migration inventory

AST count: 29 direct calls in 24 current source files. Comments and tests are excluded. Each row must receive an implementation disposition, initialization/disposal proof, state compatibility disposition and owner test before the async registry can enter an integrated build. This list is a checkpoint, not a permanent count; regenerate it and audit aliases before migration. projection-callers.json also records 83 direct service calls. projection-references.txt retains the broader occurrence search.

| ID | Current source | Disposition required | Owner test filter |
| --- | --- | --- | --- |
| P01 | packages/api/session-controller/src/list.ts:84 | Fork/mixed owner: explicit adaptation or replacement mapping | packages/api/session-controller/tests |
| P02 | packages/api/session-controller/src/list.ts:93 | Fork/mixed owner: explicit adaptation or replacement mapping | packages/api/session-controller/tests |
| P03 | packages/api/session-controller/src/model-selection-projection.ts:82 | Fork/mixed owner: explicit adaptation or replacement mapping | packages/api/session-controller/tests |
| P04 | packages/context/time-context/src/index.ts:157 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/context/time-context/tests |
| P05 | packages/context/tmux-context/src/index.ts:230 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/context/tmux-context/tests |
| P06 | packages/core/agent-loop/src/index.ts:364 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/core/agent-loop/tests |
| P07 | packages/core/agent-loop/src/index.ts:365 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/core/agent-loop/tests |
| P08 | packages/experimental/agent-team/src/index.ts:176 | Fork/mixed owner: explicit adaptation or replacement mapping | packages/experimental/agent-team/tests |
| P09 | packages/experimental/commerce-mode/src/tools/index.ts:84 | Fork/mixed owner: explicit adaptation or replacement mapping | packages/experimental/commerce-mode/tests |
| P10 | packages/experimental/desktop-ask-data/src/index.ts:64 | Fork/mixed owner: explicit adaptation or replacement mapping | packages/experimental/desktop-ask-data/tests |
| P11 | packages/experimental/desktop-ask-knowledge/src/index.ts:199 | Fork/mixed owner: explicit adaptation or replacement mapping | packages/experimental/desktop-ask-knowledge/tests |
| P12 | packages/experimental/tool-agent-team/src/index.ts:545 | Fork/mixed owner: explicit adaptation or replacement mapping | packages/experimental/tool-agent-team/tests |
| P13 | packages/goal/goal/src/index.ts:258 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/goal/goal/tests |
| P14 | packages/host/commerce/src/index.ts:227 | Fork/mixed owner: explicit adaptation or replacement mapping | packages/host/commerce/tests |
| P15 | packages/interaction/permission-presets/src/index.ts:237 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/interaction/permission-presets/tests |
| P16 | packages/interaction/user-questions/src/index.ts:87 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/interaction/user-questions/tests |
| P17 | packages/llm/llm-retry/src/index.ts:125 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/llm/llm-retry/tests |
| P18 | packages/llm/token-meter/src/index.ts:114 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/llm/token-meter/tests |
| P19 | packages/llm/token-meter/src/index.ts:115 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/llm/token-meter/tests |
| P20 | packages/llm/token-meter/src/index.ts:116 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/llm/token-meter/tests |
| P21 | packages/plan/plan-mode/src/index.ts:226 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/plan/plan-mode/tests |
| P22 | packages/preset/agent-preset-registry/src/index.ts:68 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/preset/agent-preset-registry/tests |
| P23 | packages/sandbox/sandbox-policy/src/index.ts:133 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/sandbox/sandbox-policy/tests |
| P24 | packages/session/session-stats/src/index.ts:28 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/session/session-stats/tests |
| P25 | packages/session/session-title/src/index.ts:338 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/session/session-title/tests |
| P26 | packages/session/session-title/src/index.ts:340 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/session/session-title/tests |
| P27 | packages/session/session-turn-outline/src/index.ts:28 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/session/session-turn-outline/tests |
| P28 | packages/subagent/tool-subagent/src/index.ts:326 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/subagent/tool-subagent/tests |
| P29 | packages/todo/tool-todo/src/index.ts:123 | Reviewed upstream import or explicit adaptation; no implicit pass | packages/todo/tool-todo/tests |

A migrated package is not sufficient evidence by name. Record the accepted source hash and concrete replacement for every old caller, including the relocated model-selection projection. Importing a registry with unawaited synchronous callers or stale stateOf readers is a failed gate.
