# Agent Note: octopus_DSH ships session telemetry DISABLED by default

Status: implemented

English | [中文](2026-10-06-fork-telemetry-disabled-default.zh.md)

## Problem

`octopus_DSH` is distributed as a self-hosted desktop application whose premise is that a new user configures an API key and nothing else. Until this change its shared base resolved an unset `DSH_TELEMETRY_MODE` to `FEEDBACK_ONLY` with a production endpoint of `https://harness-telemetry.deepseeksvc.com/v1/logs`, so a user who recorded `/feedback` uploaded the not-yet-shared session-log records to a collector operated by upstream DeepSeek. The fork's own maintainers cannot read that collector, so the upload produced no diagnostic benefit for this distribution, while the exported records are the raw captured copy — the shipped base mounts no `session-telemetry/record` redaction rule, so they can contain message text, tool arguments and results, and workspace paths. The disclosure appears in the `/feedback` acknowledgement, which the user reads after the release has already been triggered.

The [feedback-gated default](../feature/2026-08-25-feedback-gated-telemetry-default.md) was written for a deployment that receives its own feedback. Adopting it unchanged into a fork with a different operator moved the session records to a third party without moving the ability to act on them.

## Decision

**The shared base resolves an unset `DSH_TELEMETRY_MODE` to `DISABLED`, and the exporter row carries no endpoint default.** An upload mode is therefore a deliberate deployment act with two parts: set `DSH_TELEMETRY_MODE` to `FEEDBACK_ONLY` or `FULL`, and set `DSH_TELEMETRY_OTLP_URL` to an endpoint the operator controls. An upload mode without an endpoint fails at plugin load, because the plugin's `url` is required outside `DISABLED`; that failure is the intended outcome, since the alternative is guessing a destination.

**`FEEDBACK_ONLY` is kept, not removed.** It remains the right mode for a deployment that runs its own collector and wants a `/feedback` report to carry the session it describes. The seam, the sharing vocabulary, `DSH_TELEMETRY_DISABLED` as the pre-load hard opt-out, the anonymous user id, and the shutdown-drain bounds are unchanged; only the default and the endpoint change.

**A recorded `/feedback` stays local and says so.** The plugin already picks `DISABLED_FEEDBACK_WARNING` in this mode, so the user learns that nothing was shared instead of assuming it was. This is the behaviour the [default-off decision](2026-08-10-telemetry-default-off.md) established, and it is the default this fork ships again.

## Consequences

- A fresh installation contacts no telemetry endpoint. Recording `/feedback` uploads nothing and reports that it uploaded nothing.
- Diagnostic-feedback deployments must now opt in explicitly and name their own endpoint. The [feedback-gated default](../feature/2026-08-25-feedback-gated-telemetry-default.md) records why that mode exists; this note changes only who chooses it.
- Upstream's `dsh-otel` mount and `@deepseek-ai/dsh-host-product-telemetry-otel` remain outside this fork's release compositions. A merge that reintroduces either, or a collector default on this row, is a violation rather than a preference: `scripts/verify-upstream-intake.ts` reads `scripts/upstream-intake-registry.ts` and fails on an unrecorded mount.
- The exporter row still exists and is still mounted, so the opt-in path needs no composition change — only configuration. Keeping the row mounted while disabling it is deliberate: removing the row would remove the seam the opt-in uses.
- Verification is an assertion on the exporter rather than an observation: with the default configuration no OTLP request is issued on startup or after `/feedback`, and with `DSH_TELEMETRY_DISABLED` set none is issued in any mode.

## Alternatives considered

- **Keep `FEEDBACK_ONLY` and accept the upstream collector.** This was the shipped state. Rejected because the diagnostic justification requires a receiver its readers control, and this fork's maintainers cannot read that collector while the upload still exposes raw session records.
- **Default to a self-hosted endpoint.** Rejected as not a default: naming an endpoint nobody runs means every installation points at nothing, and per-deployment destinations are exactly what `DSH_TELEMETRY_OTLP_URL` exists for.
- **Delete the exporter row entirely.** Rejected because it removes the opt-in seam along with the default, and it would silently change the meaning of `DSH_TELEMETRY_MODE` from "policy" to "unsupported".
- **Add a pre-upload confirmation to keep `FEEDBACK_ONLY` defensible.** Viable, and it is what the [feedback-gated default](../feature/2026-08-25-feedback-gated-telemetry-default.md) itself names as the alternative for a deployment that requires prior informed consent. Not taken because a confirmation prompt still ends at an endpoint the fork does not operate, so it would convert a data-handling mismatch into a dialog the user cannot evaluate.
