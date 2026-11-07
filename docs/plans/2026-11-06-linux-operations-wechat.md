# Linux Operations and WeChat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the authenticated Feishu owner inspect and repair declared server services and send frozen text to the existing bound WeChat recipient.

**Architecture:** DSH keeps its workspace sandbox and connects to an official-SDK stdio MCP adapter. A root-owned Unix-socket broker implements finite operations without accepting shell strings, arbitrary paths or container commands. A wrapper around the existing WeChat worker consumes a separate ad-hoc queue under the existing daemon and account locks; daily-summary identity rules remain unchanged.

**Tech Stack:** Existing Node 24, official MCP SDK, Node SQLite, systemd/Podman, existing Python 3.13 WeChat UI adapter.

## Approved scope

Only the existing authenticated Feishu owner remains admitted. The broker socket is root-owned and writable only by the dedicated Agent group. Inspection exposes bounded resource data, selected service/container state and redacted logs. Restart uses a root-configured target map; WeChat container lifecycle stays owned by its systemd service. No unrestricted sudo, Podman socket access, credential access, arbitrary command execution or database mutation is granted to the model.

WeChat targets use a root-configured alias for the existing precisely bound recipient. Natural-language requests produce a frozen recipient/text preview and a random confirmation identifier. Execution requires a subsequent authenticated inbox message exactly equal to `确认执行 <identifier>`, created after the preview and before expiry, for the same operator. The broker reads the ingress SQLite authority directly; the Agent cannot write that database. Exact confirmation authorizes only the stored operation. Rejected, expired and uncertain operations cannot be silently retried. Receipts distinguish sender-side verified submission from recipient delivery/read status.

Configuration edits are restricted to declared JSON policy fields: bounded log size and preview lifetime. The broker takes a durable backup, validates the replacement, applies atomically and exposes restore through the same confirmation process. Changing target allowlists, users, credentials, arbitrary business configuration and database contents requires administrator configuration and is outside this first release.

No test sends a real WeChat message without an explicit recipient and message authorization. Production acceptance separates backend and real-model tool checks from human-confirmed external sending. Existing Gamma business files and daily queue semantics are retained.

## Task 1: Broker and authority

Create `scripts/linux-operations/broker.mjs`, `operations.mjs`, `policy.mjs` and `tests/operations.test.mjs`. Use a private SQLite operation journal with prepared, queued, executing, completed, needs_review, rejected and expired states. Enforce strict input fields, target enums, byte limits, expiry, single consumption and source-authorized confirmation. Test forged confirmations, wrong actors, stale messages, changed payloads, unknown targets, path/shell injection, duplicate requests, crash recovery and configuration rollback. Run `node --test scripts/linux-operations/tests/*.test.mjs` before deploying.

## Task 2: Model adapter

Create `scripts/linux-operations/mcp-server.mjs`. Use the official MCP SDK in an isolated, lockfile-pinned server installation; do not depend on the shared runtime collector for SDK resolution. Expose inspection, service logs, WeChat status/recipient alias, prepare operation, execute confirmed operation and receipt tools. Mutation preparation returns a literal preview; execution accepts only an opaque identifier. Do not expose arbitrary shell, file paths or recipient IDs. Test the real stdio MCP negotiation and tool list through the shipped DSH profile.

## Task 3: WeChat consumer

Create `scripts/linux-operations/wechat_worker.py` and `tests/test_wechat_worker.py`. Import the deployed Gamma worker and UI adapter without changing their source. Keep the same daemon lock and reuse the account lock. Maintain a separate ad-hoc outbox and receipts; validate immutable identity, text hash, expiry, recipient, operator and confirmation. Persist executing before UI submission. Restart during execution becomes needs_review; no automatic replay. Verify full sender-side text; failed verification is not success. Cover multiple same-day jobs, lock conflicts, mismatched identities, duplicate ticks and mid-submit crashes with a fake UI only.

## Task 4: Deployment and recovery

Create `scripts/linux-operations/install.py`, root policy and systemd examples. Install an immutable versioned tool release, private root journal and root-owned socket. Seed only public recipient aliases; keep credentials in the existing root-only environment files. Install a service drop-in for the current worker, preserving the original unit for rollback. Attach MCP only to the server profile and add concise Chinese tool guidance. Check profile tool exposure before allowing live task admission. Do not restart the WeChat login container for this deployment.

## Task 5: Verification

Run local Node/Python tests, syntax and focused lint, documentation checks and upstream intake. On the real server verify socket permissions, rejected unprivileged peers, bounded logs, actual systemd state, unchanged daily worker behavior, ad-hoc dry-run and sender identity preflight without submitting. Run a real-model read-only inspection through the installed profile and verify durable tool call/result events. Check cold journal recovery and a disposable probe service for approved restart behavior. Archive source hashes, redacted configuration and exact results. Mark human-confirmed real WeChat sending pending until observed.

## Progress

Implemented and deployed on gamma-prod as release `9dbc04475f41e89f`. All four relevant systemd units are active. The Node suite passes 13 tests; the Python suite passes 9 tests against the actual Gamma queue implementation, including on the installed container. Installed MCP exposes all eight tools, rejects unknown targets and reports the real host resources. A disposable systemd service restart, cold duplicate suppression, authenticated limits backup/restore and an isolated message queue pass. The installed profile completed a real-model read-only inspection. Real UI account/contact identity preflight and existing-message sender-side readback pass without submitting a new message. The WeChat login container was not restarted. A newly sent real message remains pending explicit human recipient/body authorization and observed verification; recipient delivery/read status is not claimed.
