# Agent Note: Agent Team checkout coordination via team-aware optimistic concurrency

Status: implemented

English | [中文](2026-09-03-agent-team-checkout-coordination.zh.md)

## Problem

Team deployments are already under optimistic concurrency control: the base layer mounts `fs-observation-policy` (`bundle/base/cordis.patch.yml`), and the Team profile builds on that base, so a Team checkout enforces prior-read `editIntent`/`replaceIfVersion` for every filesystem edit. That rejection is generic: a worker who hits it learns that the file changed, but not who else in the Team touched it or how to resolve within the Team. A proposal for a new per-file cooperative write lock would contradict the already-implemented decision that treating task ownership or write scopes as locks is rejected, because external writers bypass them, crashed owners remain durable, and path-prefix overlap cannot prove semantic independence — false mutual exclusion is more dangerous than an explicit warning ([agent-teams](2026-08-05-agent-teams.md)).

The coordination rules themselves are also already a prompt policy, not runtime state: the Team policy section tells members to "split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered; write-scope overlap is advisory, not a lock" (`tool-agent-team` `TEAM_POLICY`, and the [agent-teams](2026-08-05-agent-teams.md) shared-checkout boundary).

## Decision

The correctness boundary remains the existing versioned OCC. Team coordination adds attribution to stale-write remedies, not a runtime lock or a concurrency substrate.

`dsh-fs` exposes a `fs/error-remedy` waterfall event that lets listeners enrich guarded-mutation remedy text. `tool-fs` calls that waterfall through `remediateFsToolError` at the catch site where it still has the `FsTarget`, `operation`, and `actor` needed to describe the failed mutation.

The `agent-team` runtime listens to `fs/observed` for `write` and `edit` operations only and records `targetKey → teammate name`. It also listens to `fs/error-remedy` and enriches `FS_STALE_VERSION` with `last changed by <teammate>; re-read and rebase, or ask the Lead to re-assign` when the last observed writer was a teammate. Attribution is process-local and matches the OCC observed state; Bash, formatter, generator, and external writes have no Team actor attribution.

The default remains the existing prompt-directed serial/write-isolation policy on the shared checkout: split work into disjoint scopes and order dependent work. No runtime lock and no global concurrency setting are defined. Parallel work remains the Lead's assignment-time judgment, and `writeScopeWarnings` is an auxiliary diagnostic; an advisory `writeScopes` value never authorizes a write, never serializes work, and never proves semantic independence ([agent-teams](2026-08-05-agent-teams.md)).

The `fs` invariant covers the new `fs/error-remedy` event so the event stays part of the declared fs behavior rather than an untested Team-only hook.

## Alternatives considered

- **A new per-file cooperative write lock.** Rejected: it guards only an already-atomic edit or a whole-file overwrite that OCC already rejects, so it buys nothing over OCC; and it would reintroduce the false-mutual-exclusion danger the [agent-teams](2026-08-05-agent-teams.md) decision rejected.
- **Runtime enforcement of serial/write-isolation.** Rejected: it would need a mutex or ordering gate whose disposal and process-global semantics are exactly the complexity a config switch was avoided to prevent; the prompt-directed policy already expresses the intent, and a model violating it is caught by OCC.
- **Trust `writeScopes` as locks (plan-match only).** Rejected: a plan is a prediction, external writers bypass path prefixes, and overlap cannot prove independence; OCC is the load-bearing backstop.
- **Automatic worktrees.** Rejected by the [agent-teams](2026-08-05-agent-teams.md) decision as a deployment choice that changes same-world subagent and sandbox contracts.

## Consequences

A stale filesystem-tool write in a Team deployment can name the teammate who last changed the target and give a Team-specific recovery hint, while the same OCC rules still reject stale versions and edits that were not read first. The attribution covers filesystem-tool `write`/`edit` observations only, so the final diff and tests remain the Lead's integration check for Bash, formatter, generator, and external writes.

Keeping coordination prompt-directed avoids a runtime lock, process-global concurrency setting, and disposal semantics that would duplicate the existing Team policy. OCC still allows duplicate, conflicting edits to land serially when a worker rebases against changed content; the Lead's diff review remains the final guard.
