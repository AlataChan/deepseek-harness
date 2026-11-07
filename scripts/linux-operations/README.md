# Linux operations tools

English | [中文](README.zh.md)

## Summary

These optional server-side tools connect the sandboxed DSH Agent to a finite Unix-socket operations broker and the existing Gamma WeChat desktop worker. They do not enter desktop boot composition or a DMG. The administrator installs them separately on the Linux host; the model receives no sudo or general Podman access.

## Commands and permissions

Use `host_status`, `service_status`, `service_logs`, `wechat_status` and `wechat_screenshot` for inspection. Service aliases, container restart targets and the one WeChat recipient are administrator-configured. A worker `ready` heartbeat is a UI observation, not proof of network delivery.

For a change, `prepare` freezes a restart, text message or bounded limits update. The owner replies in Feishu with `确认执行 <identifier>`, and `execute` checks the real ingress SQLite delivery and non-revoked binding. Arguments cannot change after preview. The exact structured messages `重启服务 <alias>`, `重启容器 <name>` and `微信发送 <alias>` followed by a newline and complete body authorize only that same current request without another confirmation.

`set_limits` changes only logLines and previewSeconds; it saves a durable backup. `restore_limits` restores a completed change after a fresh confirmation and rejects a stale configuration preview. Arbitrary commands, paths, recipient IDs, credential edits and target-allowlist changes are not exposed.

A WeChat job is queued until a worker receipt is available. `sent_verified` means the sender UI and complete body were checked; it does not prove recipient delivery or reading. Uncertain execution becomes needs_review and is never automatically resent. The wrapper retains the original daily tick, daemon lock and account lock, but uses an independent ad-hoc outbox and receipt namespace.

## Install and test

Install the isolated, lockfile-pinned MCP adapter dependencies with `npm ci --prefix scripts/linux-operations --ignore-scripts --no-audit --no-fund`. Run the Node suite with `pnpm run test:linux-operations`. The Python suite requires the actual Gamma source on PYTHONPATH and runs with `python3 -m unittest discover -s scripts/linux-operations/tests -p 'test_*.py' -v`; only the desktop is faked, not the existing queue transaction.

`install.py` is an administrator-only installer for the existing Octopus/Gamma host layout. Supply --source, --runtime and --node as explicit absolute paths. It creates a versioned root-owned tool release, policy, journal and systemd service, then adds the MCP entry to the server profile. It preserves original Gamma source and stores deployment backups. It replaces the worker entry with a wrapper; the WeChat login container is not restarted. The ingress refresh waits for active human tasks to finish.

Credentials remain in the existing root-only environment files and are not copied into these tools. The broker socket directory is root-owned, its group is the dedicated Agent group, and the journal is root-private. Common credential assignments and bearer strings are redacted from bounded logs; administrators must still avoid logging secrets.

The friend-card OCR fallback requires an administrator-verified root-owned `config/octopus-friend-label.png` on the existing WeChat exchange. It matches only the non-identity “朋友资料” label by unique pixels; when OCR separates the ID label and value, only a unique, aligned exact ID value is used as the copy target. The original account/recipient ID clipboard comparisons, avatar anchors and group rejection remain active. Installation rejects a missing or writable anchor.

## Recovery and acceptance

Stop ingress before removing tools from its profile. Restore the saved profile and remove the worker systemd drop-in to return to the original worker. Restart the worker, broker and ingress only after checking active deliveries; preserve uncertain receipts for reconciliation. Never clear a receipt to force a retry.

Local fake-desktop tests do not establish real WeChat sending. Production acceptance separately verifies root/group permissions, installed MCP negotiation, real-model read-only tool calls, account/contact identity preflight and a human-authorized real message. No production recipient receives an automated test message merely because installation succeeded.
