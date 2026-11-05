# Feishu platform qualification

Status: live application authentication, card publication and an original-Session answer pass. A real ordinary-text failure was repaired, and the repaired consumer passes live routing, cold-answer, revocation, fallback and expiry checks. The untouched final DMG also passes real card publication, separate ordinary-text routing/reply, cold pending recovery and one original-Session answer.

## Test scope and identity

The user supplied credentials through the root `.env` and selected a private chat. Its authenticated membership identifies exactly one operator. `live-target-preflight.json` and the private `live-target.json` record the selected target. No credentials, access tokens or raw SDK callback payloads are copied into evidence. The tests use isolated homes and workspaces, one desktop-owned Feishu connection at a time, and a scripted loopback model. No paid inference or business action is performed.

`live-preflight.json` verifies tenant-token authentication, the expected bot identity, chat access and WebSocket endpoint discovery. No additional tenant-read permission was needed: the selected private chat provides its tenant key.

## Real failure and repair

The first card was published and the operator clicked it. `live-q1-publication.json`, `live-q1-before-click.json` (captured after the actual human click despite its name) and `live-chat-window-evidence.json` record one queued, authenticated human answer in the original asking Session and an inert replacement card.

Ordinary text failed before ingress. The actual SDK event contains a valid `open_id` and unavailable `user_id: null`; the previous optional-string schema rejected it. `live-message-metadata.json` stores only field names, timestamps, identity-match booleans and the parser error. The parser now accepts absent or null identity fields, requires at least one valid identity and retains app, tenant, chat and operator authentication. Wrongly typed and all-null identities remain rejected.

The repair passes 83 transport/desktop tests with 100% statements, branches, functions and lines for `feishu-normalizer.ts` (`nullable-sender-full-coverage.log`). One test uses the actual SDK dispatcher. A new real Host replay verifies ordinary authenticated text creates its own persisted IM Session and leaves a pending asking Session untouched. All 25 question/Feishu Host replays pass (`nullable-sender-host-replay-final.log`). Root Host types, owner types, scoped lint and the README pair check pass.

The first incremental installer contained the repaired standalone IM bundle but a stale parser inlined in `desktop-im`. Its live card callback passed, but its ordinary text did not. That artifact is superseded. The desktop consumer was rebuilt, and final artifact verification now checks that consumer byte for byte as well as the standalone IM and question bundles. A subsequent standalone Client rebuild correctly tripped the recorded artifact check; the required full build was run successfully before packaging again. No artifact guard was disabled.

## Live consumer integration evidence

`live-consumer-matrix.json` identifies these results as mixed-artifact diagnostics: the copied DMG Host ran with only its isolated-profile desktop IM consumer refreshed from the rebuilt source. They establish actual platform behavior for that consumer, separately from the final untouched-copy confirmation below.

| Case | Observed result | Evidence |
| --- | --- | --- |
| Ordinary private text while a question waits | Separate authenticated IM Session, real bot reply, original question open with zero answers | `live-consumer-im-history.json`, `live-consumer-routing-status.json` |
| Pending question after cold restart | Decision remains open; zero automatic answer replay | `live-consumer-cold-status.json` |
| Click attempted while Host stopped | After reconnect, zero correlated answers; no general platform queuing/retry guarantee inferred | `live-consumer-after-offline-restart.json` |
| Fresh online click after cold restore | One answer in the original cold asking Session | `live-consumer-cold-answer.json` |
| Disable and re-enable authorization | Old card refuses; zero answer admitted | `live-consumer-revoked-status.json` |
| Desktop fallback after revocation | Public desktop submit admits one answer | `live-consumer-fallback-status.json` |
| Expired card click | Expired state, zero answers | `live-consumer-expired-status.json` |

The consumer test Host and its connection were closed cleanly. An offline click produced no replay in this observation; product wording remains “desktop online” and does not promise offline platform delivery.

## Untouched final DMG confirmation

`../../team-activity-2026-11-04/previous-artifact.json` identifies the real-platform-tested installer (SHA-256 `2ef3cc176de4852683c3dab4add9d43971d3935513395a03d5865d692d7f4b3b`). The latest Team visualization installer is identified separately by `../orchestration/takeover-release-artifact.json`; its question and IM bundles are byte-identical (`../../team-activity-2026-11-04/unchanged-question-im-bundles.json`), and this follow-up claims no new live-platform run. The fresh copied app is unmodified; its standalone IM bundle, inlined desktop IM consumer and both question bundles match the final built source byte for byte. `live-final-verification.log` passes assertions for one ordinary authenticated text in a separate IM Session, the real bot reply, a pending question before and after cold restart, and exactly one admitted answer in the original asking Session. `live-final-chat-evidence.json` verifies actual platform message IDs within the bounded final test window. All three copied-artifact probes and 115 packaging checks also pass. The final test Host closed cleanly and its isolated credential store was removed.

## Network limitation

The inherited proxy environment failed twice at the 10-second connection limit; the SDK reported `Right-hand side of 'instanceof' is not callable`. Removing proxy variables only from the diagnostic child enabled the copied installed transport in 813 ms and it closed cleanly. See `live-connection-direct.json`, `live-connection-inherited-proxy.json` and `live-connection-proxy-diagnostic.json`. The isolated Host helper already uses a minimal child environment. No product workaround or global proxy bypass was introduced. Proxy-configured deployment remains an observed limitation.

## Remaining qualification limits

Wrong-operator, wrong-app/chat, lost acknowledgments, conflicting duplicate callbacks, supersession races and teardown uncertainty are covered by synthetic SDK/Host tests. No second live account was impersonated, no platform/network acknowledgment fault was injected, and no offline-delivery guarantee is inferred. The final independent implementation review has not run; `../REVIEW_PROMPT.md` provides the read-only handoff. Keep source, installed artifact and real-platform verdicts separate.
