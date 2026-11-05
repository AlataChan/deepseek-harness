# Selected-item prerequisites

These are bounded fork adaptations, not permission to copy complete upstream commits or packages. Each implementation freezes its exact file list, proves the adapter against current APIs and stops for reclassification if a new runtime seam is required. No item starts before checkpoint P0.

| ID | Item | Classification | Current-API constraint / reason |
| --- | --- | --- | --- |
| RC1-01 | Separate instruction-chain budgets | Portable on current API | Adapt existing config/render/discovery; keep current events and model-selection hooks. Source 114da79e42 is provenance, not a whole-commit import |
| RC1-02 | Unreadable skill-root isolation | Portable on current API | Use existing SkillProviderObservation completeness path; preserve catalog/event format rather than importing new upstream persistence fields |
| RC1-03 | Full-history Markdown copy | Portable by bounded adaptation | Reuse current session-log-export Host/archive access and HeaderAction menu. Adapt formatter to current SessionEvent vocabulary. No new shared context-menu, Session subscriptions or projection API |
| RC1-04 | apply_patch | Portable by bounded adaptation | Add parser/controller/tool/presentation over current fs/tools services, with existing observation policy and explicit disabled activation. No working-directory or executor API migration in this item |
| RC1-05 | Quoting | Needs migration first | Deliver with the coordinated Host-confirmed input/draft/quote handling; no partial composer import |
| RC1-06 | Composer admission, retained drafts and prompt retry/deduplication | Needs migration first | Client input state and Host admission must agree; preserve canonical question-answer identities and never discard admitted input |
| RC1-07 | Full mobile/tablet input adaptation | Needs migration first | Includes focus, virtual-keyboard, viewport and send handling. Pure CSS could be a separately reviewed future item, but is not a hidden subset authorized here |
| RC1-08 | Trajectory/subcall/answered-batch folding and related sidebar/menu changes | Needs migration first | Port with the selected current-to-new read-model and slot/menu adapters, preserving question card and Team view |
| RC1-09 | Plugin update/rollback and complete diagnostics | Needs migration first | Qualify loader/config/install transaction changes and fork native pins together; no wholesale plugin-manager replacement |
| AD-01 | Approved focused agent-desktop plugin | Portable; independent third-party feature | Reuse current MCP client only. No sessionProjections registration, agent/request listener, new Session event or generic input-controller change. Keep snapshots session-scoped and avoid enabling 67 tools in ordinary chat |

AD-01 is not an upstream DSH backport and must not be falsely assigned sourceTag dsh-v0.2.2-rc.1. Pin its upstream release/digest in its own plugin/native-asset manifests. Every implemented RC1 item receives an individual BackportEntry, with sourceTag dsh-v0.2.2-rc.1 and basePin dsh-v0.2.1-alpha.1. Migration sub-items, Forge and Schedule receive distinct entries too. Directory-wide paths and advancing UPSTREAM_PIN are forbidden.
