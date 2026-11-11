# Octopus capability investment decisions

English | [中文](2026-11-11-octopus-capability-investment-decisions.zh.md)

<a id="summary"></a>
## Summary

Recommendation: reuse agent-desktop/browser/MCP execution and invest first in a qualified business adapter, narrow permissions and visible results. Do not start a second computer-use engine or copy a full enterprise platform. Central identity, shared knowledge authorization, application publishing and fleet operation are conditional investments tied to customer requirements.

<a id="contents"></a>
## Contents

- [Decision basis](#basis)
- [Build, reuse and defer decisions](#decisions)
- [First pilot and acceptance](#pilot)
- [How to present our strengths](#claims)
- [Dev Note](#dev-note)

<a id="basis"></a>
## Decision basis

This is a scope decision for review, not authorization to implement every row. The [42-item assessment](2026-11-11-octopus-dumate-capability-assessment.md) describes existing mechanisms and remaining product gaps. Effort classes below compare owned scope: Low = configuration/tests/documentation around an existing capability; Medium = a bounded business plugin and integration; High = a multi-user platform or new lifecycle. They are not time or budget estimates.

AgentBridge’s enterprise-browser product and our native desktop executor solve overlapping execution needs but have different packaging. Batch execution and action traces already exist; visual business-flow authoring, durable replay and organizational application operations are separate concerns. Require a real workflow before selecting its interaction model.

<a id="decisions"></a>
## Build, reuse and defer decisions

| Scope / assessment IDs | Decision | Existing reuse and incremental work | Trigger and acceptance | Effort |
| --- | --- | --- | --- | --- |
| Desktop/browser executor; 04/06/26/28 | Reuse now; no second engine | Use the existing preset, semantic tools, browser providers, batch/wait and MCP/API. Add only domain orchestration. | Qualify the actual app, permissions, stale-ref handling and desktop lease. A catalog alone is not acceptance. | Low–Medium |
| One domain connector; 16/24/29 | First pilot | Package a fixed workflow with input schema, authorized read/write targets, output checks, receipts and an owner. | One customer-selected workflow. Test normal operation, changed fields, login expiry and ambiguous writes. | Medium |
| Private operation; 02/17/37/38 | Qualify now | Use model routes, sandbox/approval and profile configuration. Map egress and separate credentials from model-visible inputs. | Required for a sensitive-data pilot. Prove denied paths and external routes, including MCP, install and IM. | Low–Medium |
| Unattended operation; 07/08/09/10/39 | Reuse and harden | Use existing server profiles, timers and delivery records; document restart, offline and uncertainty semantics. | A scheduled test, restart/logout tests and duplicate checks must pass for each enabled deployment. | Medium |
| Business-layer scripts; 30 | Reuse in the pilot | Move stable steps into qualified scripts/batches; retain action observation and delivery-aware recovery. | Compare model calls, latency, correction rate and failed writes against the interactive baseline. | Low–Medium |
| Page buttons and sidebars; 27/29 | Conditional thin module | Reuse existing browser capabilities. Add a URL-scoped UI only if users need a stable embedded action entry. | Test allowed URLs, session ownership, writeback checks, page changes, disable and rollback on one system. | Medium |
| Visual recorder/workflow builder; 28 | Defer until repeatability is proved | Do not confuse traces with replay. A builder requires a workflow schema, fresh target resolution and recovery rules. | Several stable workflows need business-user maintenance; replay must refuse stale identity and unsafe repetition. | High |
| SSO and organization RBAC; 12/32/33 | Conditional; mandatory before shared access | Integrate an existing IdP and explicit resource authorization, rather than writing a new identity platform. | A multi-user customer requires it. Prove two-user isolation and revocation through UI, IM, SDK and tools. | High |
| Shared KB/file permissions; 19/20/33 | Conditional; gate shared deployment | Personal libraries stay local. Shared services need enforcement at retrieval/read/write and inherited-context paths. | Do not share protected data until cross-user and cross-group denial tests pass. | Medium–High |
| Shared secrets and rotation; 17 | Conditional | Use existing credential references and an established vault when shared connectors need centrally managed identities. | Test rotation, revocation, redaction and that a model cannot retrieve another user’s connector secret. | Medium–High |
| Cross-entry continuity; 01/10 | Conditional | Keep current explicit IM/question routes. Add a reviewed conversation/workspace association only for the required entry pair. | Require identity consistency, queued human authority, cold restore and stale-answer handling. | Medium |
| Model failover; 03 | Use a gateway when justified | Prefer a qualified private gateway; do not scatter backup-provider retries across tools. | Recurring outages justify it. Test tool-call continuity and refuse fallback that violates data policy. | Medium |
| Audit and monitoring; 35/36 | Basic evidence now; central governance conditional | Use session/action records and deployment monitoring. Enterprise search, retention and access policy are separate services. | Add central operations for multiple operators or an audit requirement; prove redaction and retention behavior. | Low to High by scope |
| Skill scanning and enterprise publishing; 14/15/31/38 | Improve qualification first; platform conditional | Reuse pinned manifests, trusted registries, dependency checks and code review. A manager list is not a security scanner. | Multiple maintainers need approved distribution/revocation. Test version admission and rollback; reuse specialist scanners. | Medium–High |
| Elastic fleet, quotas and HA; 34/40 | Defer until scale/SLA requires it | Use service limits and explicit operators on current hosts. Do not introduce Kubernetes just to match a diagram. | Measured concurrency or contractual availability requires a control plane; test isolation, recovery and capacity. | High |
| Dreaming and automatic Harness optimization; 22/23 | Defer autonomous release | Keep scoped memory and reviewed skill improvements. Use offline evaluation and human-reviewed changes before any release. | Only add after a dataset, feedback budget, independent evaluation and rollback owner exist. | High |
| Certifications and proprietary agents; 25/41 | Customer/procurement driven | Do not clone a vendor’s proprietary ecosystem. Integrate licensed APIs or adapters where commercially justified. | A named contract or deployment standard requires it. Certification needs target-environment evidence. | External/High |
| Platform expansion; 26/39/42 | Qualify by demand | Keep the current macOS native qualification scope visible; source portability is not Linux/Windows acceptance. | A real customer target justifies a platform recipe; test packaging, permissions, lifecycle and actual workflows. | Medium–High |

<a id="pilot"></a>
## First pilot and acceptance

- Choose one recurring workflow with known input, one or two systems and a named acceptance owner. Reuse the desktop preset for GUI work and MCP/API where authorized.
- Ship a versioned plugin/skill/configuration package with explicit allowed actions and evidence. Add no general UI builder or enterprise control plane to this first scope.
- Prove exact output, intended destination, correct identity, unknown-result handling, duplicate prevention, shutdown/restart behavior and denied targets. Keep environment-specific limits explicit.
- Measure task correctness, user correction, runtime/model cost and maintenance after a target change. Expand only after the customer accepts those results.

<a id="claims"></a>
## How to present our strengths

Say: “We already have a capable desktop/browser execution layer. Our emphasis is inspectable code, selected per-agent capabilities, lightweight optional components, domain workbench entries and qualified delivery.” Show the actual preset, tool catalog, plugin manifest, workflow and receipt. Say “proposed” for a new business interface or organization platform until it is built and accepted.

<a id="dev-note"></a>
## Dev Note

This document changes no execution engine or default permissions. It records which missing product layers are worth considering, rather than treating every vendor feature as mandatory. The [introduction script](2026-11-11-octopus-enterprise-introduction.md) uses these distinctions.
