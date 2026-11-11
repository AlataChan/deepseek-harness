# Gamma Cloud Native Plugin Implementation Plan

> **For implementers:** Use `superpowers:executing-plans` after owner approval; execute each task as failing controls, minimal implementation, verification, and a scoped commit.

English | [中文](2026-10-18-gamma-cloud-plugin.zh.md)

**Status:** Proposed for review. Documentation only; no implementation, grant, deployment, installer build, or publication is authorized by this file.

**Goal:** Add an optional native Gamma module to DSH for manually authorized users to browse cloud reports and ask their configured model to explain selected report content.

**Architecture:** A dual-face experimental plugin owns native UI and a Host-only Gamma client. Gamma's current server grants authorize every report read; a local enable switch only controls DSH participation. Reuse DSH authorization, credential records, typed Remotes, slots, tools, and recorded-session infrastructure without changing the Tauri shell or agent loop.

**Tech stack:** TypeScript, Cordis, React, Typert, existing authorization/credential services, Node HTTP/crypto, Vitest, browser tests, and existing Tauri packaging gates. No Python strategy engine, market-data keys, payment SDK, or embedded password form.

## Summary

Users link an existing Gamma account in their system browser. An operator receives payment externally and grants or renews access in Gamma admin. DSH displays actual account/module access and report freshness; the selected DSH model can explain reports through bounded read-only tools. DSH does not certify payment or infer access from a local setting.

## Table of Contents

- [Ownership and dependencies](#ownership-and-dependencies)
- [User flow and safeguards](#user-flow-and-safeguards)
- [DSH implementation tasks](#dsh-implementation-tasks)
- [Verification and delivery](#verification-and-delivery)
- [Dev Note](#dev-note)

<a id="ownership-and-dependencies"></a>
## Ownership and dependencies

The Gamma server plan is `/Users/apple/Documents/2.1_AI_Journey/Cursor_projects/gamma_shock/docs/plans/2026-10-18-dsh-gamma-cloud-server.md`. It owns `gamma-desktop-v1`: endpoint/field definitions, token lifecycle, entitlement intervals, signed continuation, fixed errors, service-switch precedence, and shared acceptance A1–A12. Source paths in the two plans are repository-relative unless absolute. Review both plans together; copy the reviewed synthetic specification fixtures and their digest into DSH before implementation rather than inventing a second API.

| Gamma Shock must upgrade | DSH must upgrade |
|---|---|
| External-browser authorization code + PKCE, refresh/revoke, current-account checks | Host authorization adapter and temporary loopback callback; reuse `ctx.authorization` |
| Access periods distinct from session/token expiry | Accurate account, module, membership-date, and service-status presentation |
| Audited administrator desktop-service switch | Optional local enable switch; server remains authoritative |
| Protected versioned report lists/bodies/continuation | Validated Host API client, native viewer, bounded model tools |
| Existing manual grant/renew/revoke workflow verified; no payment integration | Contact/support flow and refresh-access action; no fake checkout or payment-success UI |

Gamma G0 fixtures are required before live DSH protocol work; DSH scaffold and fake-server tests may proceed while Gamma G1–G4 is implemented. End-to-end acceptance requires Gamma staging, isolated PostgreSQL/private report storage, and real HTTP/browser authorization. Neither mock tests nor a generic iframe establishes integration acceptance.

Start implementation in a clean worktree based on the accepted `codex/upstream-release-integration-20261018` lineage after recording the owner's chosen tip. Preserve the dirty canonical checkout. Keep this module in `packages/experimental/desktop-gamma`; do not add Gamma accounts to ordinary DSH onboarding or revive excluded upstream DeepSeek account/telemetry features. No new package launchers: applications still start through supported `dsh` profiles.

<a id="user-flow-and-safeguards"></a>
## User flow and safeguards

1. The user opens the optional Gamma settings section and explicitly enables the feature. Default `enabled=false`; ordinary DSH remains usable without Gamma or a Gamma account.
2. “Link Gamma account” starts a bounded Host-owned authorization flow and opens Gamma in the system browser. Website login and explicit consent stay on Gamma. DSH never receives the website password/cookie.
3. A linked but unpaid user sees “未开通” and operator contact details. The operator confirms payment externally and grants an existing product or scope period in Gamma admin; no second DSH license is created.
4. “Refresh access” fetches current status. An authorized user opens the native report panel, selects an allowed module/report, and explicitly chooses “Ask about this report.” No model call runs merely because a panel opens or status refreshes.
5. Expiry/revocation/service pause prevents subsequent new cloud reads. Network failure is “暂时无法核验,” not unpaid. Old visible status never grants data access.
6. Disabling Gamma cancels pending work and stops polling; linking credentials remain until explicit unlink. Unlink clears local credentials and transient views, revokes the remote family when reachable, and reports remote revocation failure honestly.

UI states are: disabled, unlinked, authorizing, linked-without-access, future-access, active, expired, revoked, service-paused, offline/unverified, and update-required. Token expiry is a credential concern; membership expiry comes only from server access intervals. When several permitted modules have different periods, show per-module dates instead of an invented single membership date. All desktop copy is locale-owned, with Chinese end-user copy and an English dictionary.

Report interpretation uses the user's configured DSH model and its normal provider billing. Before explicit use, explain that selected report text will reach that model. Gamma receives only authorization/status/report requests, not the conversation or arbitrary user questions. Report publication/trade/retrieval times and stale/missing status remain visible; latest published content is not represented as live market data.

Future-cloud-access revocation cannot erase content already in conversation logs, exports, clipboard copies, or a model provider. No persistent report cache in v1. Clear transient views on account change, unlink, disable, and confirmed access denial; preserve existing histories and clearly distinguish previously delivered information from a newly verified source read.

<a id="dsh-implementation-tasks"></a>
## DSH implementation tasks

### D0 — Freeze the handoff and create the dual-face package

**Files:** create `packages/experimental/desktop-gamma/{package.json,cordis.patch.yml,tsconfig.json,tsconfig.host.json,tsconfig.client.json,tsdown.config.ts,README.md,README.zh.md}`, `src/{index,types,config}.ts`, `src/client/index.ts`, and `tests/fixtures/desktop-v1/`; update workspace/compiler registrations only where required.

1. Record the accepted DSH/Gamma tips, dirty-path inventory, protocol fixture version/digest, and exact package consumer roles. Check the existing Ask Knowledge dual-face/typed-Remote pattern instead of importing its implementation.
2. Write a failing real Loader test for the package disabled by default, both Client/Host declarations resolving, and missing required services failing explicitly. No cloud request, account dialog, or tool exposure while disabled.
3. Declare Host dependencies on credentials, authorization, tools, subprocess/network ownership, and the existing Remote registration mechanism. Configure `baseUrl`, request deadline, login deadline, status refresh interval, response bytes, and tool output limits through validated Config. Disabled and unconfigured must load inertly without a cloud origin or login attempt. Enabling requires the operator-selected HTTPS origin; explicit synthetic loopback configuration is test-only.
4. Implement an effect-owned mount/dispose lifecycle and Cordis-free Client types. Root config is solution-only with explicit Host/Client leaf programs. Add README pairs documenting costs, privacy, access limits, and failure recovery. Commit the scaffold. **Exit:** package loads without modifying product shell/loop code or forcing Gamma setup.

### D1 — Implement browser authorization and durable credential ownership

**Files:** create `src/{authorization,callback,credential-store}.ts`, `tests/{authorization,callback,credential-store}.spec.ts`, and `tests/loader-composition.spec.ts`; register the plugin's flow with existing `packages/credentials/authorization` and store a validated `GrantRecord` through `ctx.credentials`.

1. Add failing controls for loopback bind failure, wrong callback path/state, unsolicited callback, reused/expired code, cancellation, plugin disposal, account replacement, and an unwritable credential store. Bind only `127.0.0.1:0`; select `/gamma/callback`; keep state and PKCE verifier in Host memory and close the listener on every terminal path.
2. Register one authorization flow under an owner-scoped credential key such as `credentialKey('desktop-gamma', 'primary')`. Store subject, origin, device-family ID, credential version, token values and token expiry in the owner-validated grant payload. The shared credential store is a protected local file, not an assumed OS keychain; never claim hardware-backed or encrypted storage it does not provide.
3. Reuse authorization notices/prompts. The login action must open the actual external system browser, regardless of DSH's report-link/sidebar preference. Prove this on installed macOS/Windows; use an existing Host launcher or a narrowly validated plugin-owned subprocess launch if the generic UI would open an embedded view. Do not add a custom URI scheme or change Tauri Rust logic for v1.
4. Serialize refresh with `modifyRecord`, preserving unrelated credentials. Bind grants to the configured origin; changing origin requires unlink/relink and never forwards a token to a new server. Disable HTTP redirects on authenticated requests; never send credentials to report links. Handle an ambiguous exchange/rotation response by relinking, not replay loops.
5. Add scope-generation fencing: a canceled/disabled/disposed login cannot persist a late successful grant, and an old in-flight refresh cannot resurrect credentials after unlink. New grants whose local commit fails are remotely revoked where possible. Commit. **Exit:** no secret crosses Client Remotes, logs, notices, tool output, snapshots, or support exports.

### D2 — Implement the read-only Host API and typed Remotes

**Files:** create `src/{api-client,status,reports,remotes}.ts`, `tests/{api-client,status,reports,remotes}.spec.ts`; wire the new package's generated `./remote` export and `remote.desktopGamma` Client injection.

1. Drive a fake HTTPS/HTTP-loopback server with the reviewed fixtures and real requests. Reject malformed JSON, wrong API version/scope/report ID, oversized or empty responses, redirects, foreign-origin URLs, invalid dates and inconsistent continuation/offset fields. No embedded real credentials or proxy settings in fixtures.
2. Define Remotes for non-secret status, begin/cancel authorization, enable/disable, refresh access, list reports, read report pages, and unlink. A Remote never accepts an arbitrary URL/header, an account ID as authority, or a local “paid=true” override. Credential internals and code exchange remain Host-only. Limit these operations to authenticated local desktop connections; v1 does not expose a remote-Host credential-management service.
3. Recheck the server on every list/body/continuation; a cached status badge cannot authorize reads. Use protocol cursors unchanged and require response revision/offset consistency. Derive server `max_bytes`/`max_chars` from the current UI/tool budget after reserving its serialized envelope; fit the complete output without splitting Unicode. Never locally clip a page while forwarding a cursor that skips its unreturned tail; refuse a metadata-only budget that cannot fit.
4. Cancel requests on disable/unlink/disposal, clear transient data, and fence stale completions using account/origin generations. A request started for account A must never populate account B's panel/tool result. Do not revoke unrelated Gamma website sessions on desktop unlink.
5. Map authentication/access/service/outage/version errors to distinct typed results. Retry only safe read requests within bounded backoff and `Retry-After`; no token/approval retry or automatic model call. Commit. **Exit:** host-side enforcement survives forged Client messages and local settings edits.

### D3 — Add the native settings and report panel

**Files:** create `src/client/{mount,locales,remotes,store}.ts`, `src/client/{GammaSettings,GammaPanel,GammaReport}.tsx`, `src/client/Gamma.module.css`, and `tests/{gamma-settings,gamma-panel,gamma-report}.client.spec.tsx`; add a browser scenario under `apps/web/tests/gamma-cloud.e2e.ts` with a fake Gamma server and explicit test-only activation patch.

1. Write failing assembled-Client tests proving `remote.desktopGamma` is declared/injected before use, authorization cancellation is available, and ordinary DSH works when disabled/unpaid/offline. Include actual runtime mounting to catch the missing-Remote-injection failure seen in other overlays.
2. Add one optional settings entry and one report-panel entry, using existing slots and UI primitives. Show linking state, operator contact, module-specific expiry, last checked/server time, service pause, manual refresh, and explicit unlink. No checkout, payment-success badge, algorithm settings, or automatic trading controls.
3. Render authorized report text through the existing safe Markdown path. No arbitrary HTML, scripts, iframe execution, auto-loaded remote tracking images, or automatic tool instructions from report content. Lists must not reveal unauthorized scopes/report summaries.
4. “Ask about this report” binds only non-secret report/scope/revision references and submits one explicit user action through the existing conversation entry. Model-visible text must be reconstructable from the session log. Reuse logged user/tool events if sufficient; add a documented, acknowledged event only if a new model-visible input cannot be reconstructed otherwise.
5. Poll status only while enabled and the panel/settings view is visible (proposed 30 seconds), stop on close/dispose, and avoid persistent report caching. Test double clicks, overlapping refreshes, account switch during fetch, expired future grants, empty lists, long tables, keyboard navigation and Chinese/English layouts. Commit. **Exit:** visible dates match server grants, no blank success panels, and every disabled action explains recovery.

### D4 — Add bounded report tools and recorded-session acceptance

**Files:** create `src/{tools,prompt}.ts`, `tests/tools.spec.ts`, `tests/fixtures/tool-output/`; add `snapshots/session/gamma-cloud/{snapshot.yml,cordis.snapshot.yml,session.v4.jsonl,system-prompt.expected.md,tool-schemas.expected.json}` using existing YAML scenario discovery; extend the owning harness only for required fake-server setup.

1. Register only `gamma_reports_list` and `gamma_report_read`; no arbitrary fetch, execution, scan, backtest, admin, publish or trade tool. Scope each contribution through existing tool ownership and release it on disable/dispose. Model tools cannot start login, grant rights, enable the module, or confirm payment.
2. Define output/presentation before implementation: report title/module/timestamps/revision and exact returned offsets; fixed refusal codes; explicit completeness/continuation; no tokens, Blob paths, administrative fields or cross-account data. Mark reports as external data using the existing tool result pathway; report text cannot direct privileged actions.
3. Record a keyless shipped-profile scenario for unpaid refusal → manual-grant fixture → authorized read → middle/final continuation → expiry/revoke denial. Use a local fake model and Gamma server; isolate HOME/DSH_HOME/provider credentials and fail if the fixture attempts a real provider or native Codex. Do not rely on a test overriding a plugin name that Cordis does not replace.
4. Add independent controls for local enable spoofing, valid but unentitled tokens, cross-account/cursor reads, stale report revisions, CJK/astral tail facts, malicious report instructions, malformed payloads, and access changing between pages. Source spans must locate text in the named server projection revision.
5. Commit tool implementation and recordings together. **Exit:** no paid call is needed for acceptance; tool results honestly distinguish prior history from new authorized data and latest published reports from live prices.

### D5 — Joint staging and packaged desktop verification

**Files:** update `scripts/desktop-profile-plugins.json`, `apps/cli/package.json`, `pnpm-lock.yaml` only for required runtime closure; create `scripts/verify-gamma-installed-flows.mjs`; extend `scripts/verify-desktop-bundle.sh` and the native Windows verification workflow; update generated config/tool/plugin catalogs and README/i18n records through their producers.

1. Pin the dual-face package and make every workspace Host dependency resolvable from the collected installed runtime. The entry remains disabled by default; offline/unconfigured Gamma must not hold companion readiness. Do not bundle Gamma Python engines, market datasets, report archives or server secrets.
2. Run real-HTTP staging with synthetic accounts and administrator manual grants: unpaid link, activate, renew, gap, expire, revoke, switch off/on, disable user, refresh rotation, logout-all, storage outage and account switch. Gamma policy changes require no installer rebuild. Retain exact account/operation correlation without tokens or personal/payment details.
3. Build internal candidates only after source checks pass and owner authorizes packaging. Test an actual read-only mounted DMG and disposable native Windows installation: readiness with Gamma off/unreachable, external browser/loopback callback, current grants, report tail read, restart, cancellation and unlink. A browser mock or Wine is not native Windows evidence.
4. Verify existing Ask Knowledge/Data/assistant flows remain usable and the companion's exact release identity matches the candidate. Use the existing release metadata/signature checks; no canonical installer replacement, installation over user apps, push, production enablement, or public publication without the corresponding owner instruction.
5. **Exit:** source acceptance, joint server integration, macOS installed acceptance, Windows installed acceptance, and public signing are separately reported. Missing external infrastructure remains unverified and never blocks useful source/mock work or becomes an invented pass.

<a id="verification-and-delivery"></a>
## Verification and delivery

The following are planned implementation commands, not checks already run for this document. Run new negative controls first, then their owning suites; avoid repeating broad passing suites without a changed failure hypothesis. Gamma commands belong in the server plan.

```bash
pnpm exec vitest run packages/experimental/desktop-gamma/tests --maxWorkers=1
pnpm exec tsc -p packages/experimental/desktop-gamma/tsconfig.host.json --noEmit
pnpm exec tsc -p packages/experimental/desktop-gamma/tsconfig.client.json --noEmit
pnpm run test:snapshot -t gamma-cloud
pnpm run test:web:built apps/web/tests/gamma-cloud.e2e.ts
pnpm run verify-client-ui-i18n
pnpm run verify-export-jsdoc
pnpm run verify-no-unknown-casts
pnpm run verify-upstream-intake
pnpm run test:docs
git diff --check
```

The existing scripts invoke Vitest with `vitest.snapshot.config.ts` and `vitest.web.config.ts`, respectively. Register the new browser test in the Host compiler and exclude it from the Web Client compiler. Snapshot commands replay session scenarios only; browser recordings run through the browser lane. Refresh generated catalogs and run their freshness checks when their source inputs change. Follow `dsh-pre-push-checks` before any separately authorized push; record only actual commands/exits.

Review and delivery sequence: approve Gamma server plan + this DSH plan and fixture version → server G0–G4 / DSH D0–D4 → real joint staging → server G5 / DSH D5 → owner packaging and rollout decision. A service switch disabled by default is the rollback entry point; disabling/uninstalling the plugin preserves sessions, prior report copies and existing DSH features. No production grants, actual payment, live model calls, deployment, or package release occurs during planning.

Acceptance evidence must identify source tips, specification fixture digest, exact commands/exits, native OS, model/network isolation, actual installed artifact hashes, operator actions, observed errors and any unrun checks. A Required authorization/cancellation/data-leak finding blocks integration acceptance even when unit tests pass. Shared A1–A12 remain owned by the Gamma plan.

<a id="dev-note"></a>
## Dev Note

This plan assumes existing Gamma memberships apply to desktop access and that v1 only consumes published reports. Proposed timing/size defaults and the exact OAuth component need review in Gamma G0. The production Gamma origin/support contact, staging credentials, test database/storage, and signing/native Windows infrastructure must be supplied through their existing operational channels; none is fabricated or read from live secret files for this plan.
