# Expansion implementation review

Current verdict: accepted for the named experimental source and disposable installed targets. Final plan comparison found Path A permits local TCP; the implemented and qualified strict forced-command Path B now satisfies the no-forwarding requirement. AGY review reports no required findings, and all dispatches have settled. Live platform, production-host and physical two-host acceptance remain not run. Real platform/production acceptance is not run. The [completion record](expansion-completion.md) is the authoritative current gate matrix. The earlier [Phase 0 review](codex-code-review.md) applies only to its original helper snapshot.

## Resolved implementation findings

Codex independently reproduced and repaired durable admission races, constructor initialization order, illegal outbox transitions, lost-ACK reconciliation and active-delivery status races. Actual SQLite/Session integration now distinguishes completed, cancelled, failed and unknown results and never automatically replays an ambiguous side effect.

IPC now validates external/file/wire data, enforces byte/frame/pending limits, checks tenant/workspace identity and production Unix socket ownership/modes, consumes systemd's accepted stdio and waits for cancellation plus durable storage drain before exit. Failed shutdown does not silently release writer ownership. Native/PTC approval lookup follows both logged call event types, and unavailable/storage-failed authorization produces no protected tool side effect.

Feishu startup/close now owns asynchronous SDK loading and raw start promises, publishes reentrant cleanup ownership before invoking external code, prevents retry after terminal failure and retains callback/late-close errors. Exact expected startup-cancellation messages are handled without swallowing unrelated failures. Independent source/control selections pass; the actual dispatcher is exercised with synthetic platform I/O. This is not live Feishu app acceptance.

Codex replaced premature unused bundle-helper APIs with a declarative service bundle and static profile examples. The installed gate now requires an explicit built artifact, launches actual `dsh` ingress/tenant processes, exercises the actual bundle and both channel consumers, checks SQLite and Session results and rejects missing artifacts. There is no checkout fallback. Linux qualification now reads the shipped concrete tenant socket/service and tmpfiles assets and exercises real isolated runtime processes.

The collected closure originally flattened incompatible dependency versions and failed actual remote ACP startup. The opt-in version-preserving collector now retains required nested versions; a control distinguishes flat failure from working nested resolution. Desktop's default collector mode is unchanged. The IM snapshot originally captured personal skills; the child now has a private OS home and private DSH_HOME. Empty-home replay/corpus passes after refreshing only the new uncommitted synthetic fixture; no committed Session generation was modified.

## Resolved SSH fault-injection finding

Codex replaced the broad host-process search/kill and graceful fallback with exact owned-child fault injection. The required lane now rejects skipped cases. Remote processes write private unique PID/start/prompt markers; an independent Docker observer checks live and terminated processes without using the broken SSH link. The lease case stops only the owned SSH child and observes remote process death before local teardown. A persistent remote timer prevents stdin EOF from masquerading as lease cleanup, and counters detect replay. Network-loss disposal is required to reject with its explicit teardown/unknown diagnostic.

The final combined qualifier passes built ACP PONG plus nine Path A controls with zero skips and five strict Path B groups. Path B refuses arbitrary TCP forwarding and arbitrary original commands, rejects writable/oversized-deadline configuration, and proves normal plus frozen-transport cgroup cleanup through independent remote process observation. The independent unit/composition selection passes 82 cases; the private-home Loader suite passes four. The two earlier failing live runs exposed incorrect test expectations for official `error`/`aborted` results and truthful disposal uncertainty; the product was not changed to suppress those errors. Logs are linked by name in the completion record. Physical two-host validation remains unrun.

## Verification and limitations

The current [installed profile report](installed-profile-qualification-report.md) records exact deployment and synthetic-I/O scope. Current evidence: 256 IM/DingTalk source cases, a separate overlapping 60-case Feishu lifetime selection, three installed two-channel/absent-artifact controls, four declarative-bundle cases, four hermetic Session/corpus checks and ten grouped disposable installed-Linux gates. Scoped IM compiler and source lint pass. Counts from overlapping selections are not summed.

Global documentation checks have unrelated baseline wrapping, pairing, historical-reference and generated-declaration failures; no full-repository pass is claimed. Focused README structure, model-experience, links and protected-file checks are recorded separately. Upstream intake exits zero with four recorded outstanding changes. GitHub workflows have not been dispatched.

Real Feishu/DingTalk credentials and approved operators, production Linux deployment, and a designated physical SSH pair remain unavailable. No real message or undesignated host operation was performed. The package remains experimental; TUI and official desktop composition were not implemented or changed by this expansion.

## Test-isolation side effect

An early SSH Loader helper wrote the generated headless profile configuration under the user's DSH_HOME. Its previous generated contents were not captured; no guessed restoration was attempted. Corrected tests now isolate DSH_HOME and pass. The 23 saved pre-existing tracked modifications remain unchanged by hash verification. No real user Session logs were rewritten.
