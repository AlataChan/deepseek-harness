# Octopus, DuMate and AgentBridge: capability assessment

English | [中文](2026-11-11-octopus-dumate-capability-assessment.zh.md)

<a id="summary"></a>
## Summary

Octopus has substantial overlap with the agent execution capabilities described in the supplied decks. The evidence does not establish equivalence to DuMate’s enterprise operating platform or AgentBridge’s business-application development and publishing platform. Position Octopus as a customizable local agent workbench built on DeepSeek Harness, especially for teams able to develop and qualify their own integrations.

<a id="contents"></a>
## Contents

- [Evidence and version scope](#scope)
- [What to learn from the decks](#structure)
- [Detailed capability matrix](#matrix)
- [Material gaps and acceptance conditions](#gaps)
- [Positioning and next steps](#position)
- [Repository evidence index](#evidence)
- [Dev Note](#dev-note)

<a id="scope"></a>
## Evidence and version scope

Source review began November 10 and was finalized November 11, 2026. Sources are the 51-page supplied DuMate private-enterprise deck and the 16-page supplied AgentBridge deck. Page references below use one-based PDF page numbers, including covers. Vendor features, customer counts, certifications and efficiency figures are claims in those materials; this review does not independently validate the vendor products or benchmarks.

Repository scope: inspect the working tree on `feature/im-expansion-tui-local-qualification` and read `master` for newer merged features. The working tree is dirty and older than `master`; do not treat the absence of a master-only package here as a product gap. Desktop-operation, worktree-review and Agent-Reach are checked against master-owned manifests and READMEs. No checkout, merge, deployment or product code change is part of this assessment.

An Available entry means a relevant implementation exists, not that the complete vendor promise has passed packaged acceptance. Partial means the primitive exists but scope, integration or governance differs. Not established means no equivalent was demonstrated in the inspected owners; it is not a proof of absence across every branch or external service. Integration means a deployment-specific adapter or qualification is required.

The real server WeChat delivery test observed earlier in this conversation is an environment-specific integration: a scheduled producer/worker test reached verified Moments and private-message receipts. It does not establish a native, general-purpose WeChat feature in the Octopus desktop distribution, a production SLA or an enterprise customer case. No new runtime, model, Windows or multi-user acceptance was run for this comparison.

<a id="structure"></a>
## What to learn from the decks

DuMate’s effective sequence is: business change and pain (pp. 4–9), product panorama (11–13), personal assistant and role-based employee (15–21), reusable assets (23–30), enterprise governance (32–36), deployment (38–40), evidence and scenarios (41–49), then FAQ (50). Reuse the progression from a buyer’s problem to delivery evidence; write our own claims and diagrams.

AgentBridge adds a different story: barriers in existing systems (pp. 2–3), an overlay between systems and AI capabilities (4–7), a scoped comparison with RPA and generic agents (8), scenario/solution/evidence pairs (9–14), and a field-delivery method (15). Learn its connection to a concrete workflow and its delivery discipline. Do not reuse its customer logos, quantitative benefits, or unsupported claims of deterministic end-to-end execution.

Keep important vendor qualifications: DuMate’s skill/security-center capabilities are optional or delivery-version dependent (pp. 23, 35); external model/tool connections require separate data-flow assessment (33, 50); client-only deployment does not require its cloud agent compute nodes (39). This is not a comparison against an imagined always-on maximum configuration.

<a id="matrix"></a>
## Detailed capability matrix

D = DuMate deck; A = AgentBridge deck. Evidence identifiers resolve in the repository index below.

| ID | Capability and source pages | Assessment | Octopus implementation and material difference | Evidence |
| --- | --- | --- | --- | --- |
| 01 | Desktop and browser entry; D20–21 | Available | Tauri desktop and Web Host/Client exist. This does not establish enterprise single identity or cross-device state synchronization. | E01 |
| 02 | Private or compatible model endpoints; D13,33 | Available | Provider adapters support compatible gateways and self-hosted endpoints. Models, GPU capacity and offline dependencies are separately provisioned and qualified. | E02 |
| 03 | Automatic primary/backup model takeover; D33 | Not established | Multiple routes and model selection are not automatic failover. An external gateway could provide this, but continuity and tool-call compatibility require testing. | E02 |
| 04 | Plan, use tools, code and deliver files; D17–18 | Available | Core agent execution, filesystem, shell, deliverables and SDKs provide the foundation. Output quality and business acceptance remain scenario-specific. | E01 |
| 05 | Human clarification and durable questions; D17,35 | Available | Session-decisions saves expiring questions and queues authenticated answers. Tools require the selected preset; this is not a corporate approval workflow engine. | E03 |
| 06 | Multi-agent collaboration; D12,18,27 | Available | Named teammates, durable mail, shared tasks and standing teams exist. Native Team uses a shared workspace; a worktree plugin does not automatically isolate every teammate. | E04,E12 |
| 07 | Long tasks survive failures; D18 | Partial | Goal state and sessions persist. Goal continuation authority is process-local; persisted state is not proof of automatic restart or exactly-once side effects. | E05 |
| 08 | Periodic execution and notifications; D20,49 | Available | Schedule and qualified server services can trigger work. The execution host must remain online; delivery and business completion need their own receipts. | E05,E06 |
| 09 | Feishu/DingTalk/WeCom access; D20,50 | Partial | Desktop settings and server services support Feishu/DingTalk, with explicit credentials and bindings. A matching native WeCom integration was not established. | E06 |
| 10 | One identity/session across all entries; D20 | Partial | Desktop IM free text goes to its bound IM session; decision buttons target the originating question. These are not universal cross-device session continuity. | E03,E06 |
| 11 | Personal assistants and reusable roles; D15–16 | Available | Persistent profiles, role prompts, scoped memories, model choices and saved teams exist. This is reusable configuration, not an organization account directory. | E04 |
| 12 | Digital-employee HR identity and shared governance; D15–16 | Partial | A named assistant is not a separately provisioned employee ID, mailbox or service account with organizational grants and suspension. Those require enterprise integration. | E04,E06 |
| 13 | Author and load Skills; D23 | Available | Skill loading, bundled skills and developer-authored plugins exist. A skill is guidance; required action restrictions must be enforced by tools and policy. | E07 |
| 14 | Enterprise Skills store and organization rollout; D23,30 | Partial | Profile plugin installation and bundle pins exist. Central department grants, approval of every release and enterprise-wide rollout/revocation were not established. | E07 |
| 15 | Six-engine skill inspection and trusted-source enforcement; D23,35 | Not established | Plugin-manager approval and package inspection are not a malware or prompt-injection scanning center. Install scripts may execute code. | E07,E10 |
| 16 | MCP tool and resource connections; D24 | Available | The MCP client discovers tools/resources and supports configured connections. A protocol client alone supplies no ready-made ERP/CRM semantics or credentials. | E08 |
| 17 | Central credential vault and tool-specific enterprise grants; D24 | Partial | Credential references, authorization flows and tool policies exist. A tenant-wide vault, key rotation and organizational grants with verified non-disclosure require qualification. | E08,E10 |
| 18 | Local knowledge/document retrieval; D25 | Available | Ask Knowledge ingests supported documents, stores originals and supports page/passages and keyword retrieval. OCR completeness and format limits remain explicit. | E09 |
| 19 | Enterprise KB permissions and retrieval console; D25 | Partial | A personal library is not organization/user-group ACL enforcement, semantic/hybrid/rerank configuration and a centralized pre-release hit-test console. | E09,E10 |
| 20 | Central files and automatically attributable outputs; D26 | Partial | Workspace browsing, attachments and session deliverables exist. A shared enterprise result library with quotas, grants and immutable origin-only directories was not established. | E01,E09 |
| 21 | Persistent role/team memory; D19,27 | Available | Scoped revisioned entries, prompt injection and bounded per-turn review exist. They do not establish organization-wide memory governance. | E04 |
| 22 | Admin memory history, rollback and Dreaming; D19,27 | Partial | Entry revisions and conversational extraction are not an equivalent reviewed history rollback UI or offline historical-task Dreaming service. | E04 |
| 23 | Automatic evaluation optimizes/releases Harness; D19 | Not established | Tests, snapshots and self-evolving guidance are development assets. No equivalent autonomous evaluation-to-approved-runtime-release product loop was established. | E01,E04 |
| 24 | Data and commerce workbench; D9,44,48 | Available | Ask Data imports supported tables; commerce supports fixed local tables and staged CSV export. It does not perform live ERP/shop transactions or arbitrary joins by default. | E09 |
| 25 | Developer and specialist-agent ecosystem; D12–13,44 | Partial | Cordis plugins, Host/Client overlays and SDKs support extension. No equivalent no-code enterprise designer or pre-integrated Baidu Comate/Miaoda specialist-agent ecosystem was established. | E01,E07 |
| 26 | Read and operate existing browser pages; D28; A5–7 | Partial | Browser providers and the dedicated master desktop-operation preset offer primitives. Support depends on browser/provider, platform, permissions and target qualification. | E11,E12 |
| 27 | Installable page buttons, sidebars and URL-scoped plugins; D28; A6–7 | Not established | No equivalent managed runtime for injecting, versioning, enabling and revoking per-site business UI plugins was demonstrated. Browser automation does not supply it. | E11,E12 |
| 28 | Record/replay and visual application composition; D28; A6 | Not established | Code can automate a known procedure, but a business-user recorder, reusable flow editor and qualified replay lifecycle were not established. | E01,E11 |
| 29 | Cross-system application with page/API/SQL data; D28–29; A5–7 | Integration | MCP, shell, browser and local data tools can support custom applications. Domain adapters, login/session policy, schemas, writeback and failure recovery must be built and tested. | E08,E09,E11 |
| 30 | Deterministic low-token business replay; D28; A8 | Partial | Fixed scripts can reduce repeated reasoning. There is no general product promise of deterministic LLM-driven execution, UI stability or exactly-once external actions. | E01,E05,E11 |
| 31 | App approvals, organizational publishing and owner operations; D30; A6 | Not established | Installing profile bundles is not an enterprise application store with review, organizational visibility, release history and revocation. | E07,E12 |
| 32 | Enterprise SSO and account provisioning; D11–12,32,50 | Not established | Authenticated IM operators and local settings exist. A matching enterprise IdP/directory synchronization and account provisioning console was not demonstrated. | E06,E10 |
| 33 | Organization-wide RBAC and resource grants; D25,32,35 | Partial | Workspace/session policies, assistant scopes and tenant bindings exist. They are not an enterprise policy model spanning department, group, user and all shared assets. | E04,E06,E10 |
| 34 | Elastic instance pool, quotas, sleep/wake; D34,38 | Not established | Team/turn budgets and service resource limits are local controls. They do not create a scheduler for an elastic employee-instance fleet. | E04,E06 |
| 35 | Tracing and operational dashboards; D32,36 | Partial | Session logs, trajectories, usage and optional telemetry exist. Enterprise DAA/DAV, organization/resource dashboards and searchable managed audit were not established. | E13 |
| 36 | Complete audit retention and evidence governance; D35–36 | Partial | Logged model-visible actions are useful evidence. They do not prove immutable storage, logging of every OS/network/plugin action or enterprise retention/access enforcement. | E10,E13 |
| 37 | Per-task memory/file/network isolation; D18,35 | Partial | Platform sandbox providers confine configured execution paths. Local sandbox shares host kernel/filesystem; partial enforcement and unconfined provider paths must remain visible. | E10 |
| 38 | Injection defense, DLP and centralized skill security; D23,35 | Partial | Approvals, guards, scoping and some secret screening exist. They are not proof of a centrally managed anti-injection/DLP scanning suite or universal plugin safety. | E04,E07,E10 |
| 39 | Linux private server and IM isolation; D38–39 | Available | Explicit profiles, ingress/tenant separation and systemd deployment examples exist. One working host does not establish multi-node high availability or all desktop features on Linux. | E06 |
| 40 | Kubernetes fleet operation and managed upgrades; D38–39 | Not established | Desktop packaging and plugin lifecycle do not establish the equivalent cluster control plane, multi-replica operation and managed fleet rollout/rollback. | E01,E06,E07 |
| 41 | Domestic hardware/OS certifications and benchmarks; D40–42 | Not established | No matching certificates or independent benchmark results were established. Source portability is not certification and vendor case metrics cannot become ours. | E01 |
| 42 | Media/social-platform discovery and reading | Available in master | Agent-Reach is lightweight and lazily installs dependencies on qualified macOS Apple Silicon. It excludes posting/messaging and does not replace AgentBridge. | E12 |

<a id="gaps"></a>
## Material gaps and acceptance conditions

- Enterprise governance: prove two users in different groups cannot read each other’s protected knowledge, credentials or outputs through UI, IM, SDK, inherited sessions or tools. Include revocation and negative tests; an organization tree screenshot is insufficient.
- AgentBridge-style integration: qualify a real target page, URL rules, login/session ownership, versioned scripts, writeback validation, page-change failures and release rollback. A browser agent that clicks a page is an execution primitive, not this complete product.
- Private operation: verify actual network routes for model, search, browser, MCP, telemetry, package install and IM; identify what must leave the network and what runs fully inside it. Local placement alone does not establish confidentiality or plugin trust.
- Operational reliability: test logout, process/host restart, expired human decisions, lost acknowledgements and uncertain external writes. Preserve uncertainty and prevent unsafe duplicate submission. Separate a saved objective from durable authority to resume it.
- Commercial proof: label functional demonstrations and internal integrations as such. Obtain scenario-specific user acceptance and measured baselines before claiming time savings, customer coverage, industry readiness or contractual service levels.

<a id="position"></a>
## Positioning and next steps

Recommended statement: “Octopus is a local agent workbench built on the open-source DeepSeek Harness project. Teams can inspect the code, choose model endpoints, develop plugins, and qualify their own execution and data policies.” Do not claim that it is already the same complete enterprise suite as DuMate, that intranet placement guarantees safety, or that every vendor ecosystem is less extensible.

Use the [introduction script](2026-11-11-octopus-enterprise-introduction.md) for customer discussions. Its main story is business fit, a visible workbench, reusable capabilities, explicit data/execution choices and a qualified pilot. A proposed browser integration module stays a proposal; an organization governance platform becomes a separate scope only when a customer needs centrally managed multi-user deployment.

Learn the field-delivery method without promising a generic implementation duration: choose one workflow, inspect its real data and permissions, build the smallest connector, observe user operation, fix actual failures, and hand over the plugin, configuration, tests and responsibility list. Agree acceptance metrics before expansion.

<a id="evidence"></a>
## Repository evidence index

- **E01 — Architecture, supported SDKs, desktop carrier and license:** [docs/architecture.md](../../docs/architecture.md); [sdk/README.md](../../packages/sdk/README.md); [desktop/README.md](../../apps/desktop/README.md); [LICENSE](../../LICENSE)
- **E02 — Model protocol adapters and local/custom routes:** [llm-pi-ai/README.md](../../packages/llm/llm-pi-ai/README.md); [llm-deepseek/README.md](../../packages/llm/llm-deepseek/README.md)
- **E03 — Persistent questions, preset mounting and Feishu callback routing:** [session-decisions/README.md](../../packages/experimental/session-decisions/README.md); [src/index.ts](../../packages/experimental/session-decisions/src/index.ts)
- **E04 — Team ownership, assistant profiles, memory entries and bounded review:** [agent-team/README.md](../../packages/experimental/agent-team/README.md); [assistant-registry/README.md](../../packages/experimental/assistant-registry/README.md); [src/types.ts](../../packages/experimental/assistant-registry/src/types.ts); [src/review-prediction.ts](../../packages/experimental/assistant-registry/src/review-prediction.ts)
- **E05 — Goal continuation and Schedule delivery semantics:** [goal/README.md](../../packages/goal/goal/README.md); [schedule/README.md](../../packages/schedule/schedule/README.md)
- **E06 — Desktop IM and administrator-provisioned server profiles:** [desktop-im/README.md](../../packages/experimental/desktop-im/README.md); [im-feishu/README.md](../../packages/experimental/im-feishu/README.md); [im-service-bundle/README.md](../../packages/experimental/im-service-bundle/README.md); [examples/README.md](../../packages/experimental/im-feishu/examples/README.md)
- **E07 — Skills, installer permissions and desktop pins:** [skill/README.md](../../packages/skill/README.md); [plugin-manager/README.md](../../packages/boot/plugin-manager/README.md); [src/tools.ts](../../packages/boot/plugin-manager/src/tools.ts); [scripts/desktop-profile-plugins.json](../../scripts/desktop-profile-plugins.json)
- **E08 — MCP discovery, credentials and authorization flows:** [mcp-client/README.md](../../packages/mcp/mcp-client/README.md); [credentials/README.md](../../packages/credentials/credentials/README.md); [authorization/README.md](../../packages/credentials/authorization/README.md)
- **E09 — Local libraries, table imports, fixed commerce schema and workspace browser:** [desktop-ask-knowledge/README.md](../../packages/experimental/desktop-ask-knowledge/README.md); [desktop-ask-data/README.md](../../packages/experimental/desktop-ask-data/README.md); [commerce-mode/README.md](../../packages/experimental/commerce-mode/README.md); [desktop-files/README.md](../../packages/experimental/desktop-files/README.md)
- **E10 — Sandbox enforcement scope and policy ownership:** [sandbox-local/README.md](../../packages/sandbox/sandbox-local/README.md); [sandbox-policy/README.md](../../packages/sandbox/sandbox-policy/README.md)
- **E11 — Browser ownership and provider selection:** [browser-use/README.md](../../packages/browser-use/browser-use/README.md); [browser-use-runtime/README.md](../../packages/experimental/browser-use-runtime/README.md)
- **E13 — Durable sessions, usage and limited telemetry export:** [session-persistence-jsonl/README.md](../../packages/session/session-persistence-jsonl/README.md); [session-stats/README.md](../../packages/session/session-stats/README.md); [session-telemetry-otel/README.md](../../packages/session/session-telemetry-otel/README.md)
- **E12 — Master-only additions:** read `git show master:packages/experimental/desktop-operation/README.md`, `git show master:packages/experimental/worktree-review/README.md`, `git show master:packages/experimental/agent-reach/README.md` and `git show master:scripts/desktop-profile-plugins.json`. These packages are not present in this checkout; source presence and seed membership are not new installed-platform acceptance.

<a id="dev-note"></a>
## Dev Note

This is a dated reference assessment and a basis for introduction copy, not a product implementation plan or a security certification. Do not copy vendor slides, artwork, customer identities or performance figures into the Octopus introduction. Keep the source decks outside the repository; retain page-level references and private local extraction/render evidence.
