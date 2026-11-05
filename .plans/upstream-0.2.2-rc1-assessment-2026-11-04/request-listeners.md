# agent/request migration inventory

Four live source listener registrations were found; event declarations, dispatch, generated catalogs and tests are not counted as listeners.

| Source | Current responsibility | Migration disposition |
| --- | --- | --- |
| packages/core/agent/src/model-selection.ts:97 | Route/effort from the assembly-captured ModelSelectionRef; switch notices | Replace request-time routing with Agent-owned durable selection and early step capture; reuse current projection/notices/tests |
| packages/experimental/assistant-registry/src/route-override.ts:168 | Bound-assistant provider/model/effort and image-capability validation | Select before the upstream capture point; preserve image validation, user selection, retries and cold restore |
| packages/experimental/assistant-registry/src/rounds.ts:1232 | Per-round remaining output-token cap; throws on exhaustion | It does not reroute. Retain compatible maxTokens-only control or move it with equivalent per-request budget tests; do not delete it with routing listeners |
| packages/webhook/webhook/src/session.ts:93 | First-request explicit reasoning-effort override | Initialize Agent-owned selection before step preparation; preserve absent effort and persisted effort behavior |

The current helper has useful per-assembly selection capture but still applies it via agent/request. Upstream exposes Agent.model.current()/select(), persists model/selection, folds pending/lastUsed and fixes selection in the driver before assembly. This is an incremental migration, not an already-compatible public API. The existing API modelSelection projection must map to the upstream core-owned projection instead of registering two owners under the same key.
