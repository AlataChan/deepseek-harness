# Final review attempt: default-disabled dsh-context

Decision: changes required; release acceptance is not established. Reviewed the current installed-flow verifier and its relevant packaged runtime. Earlier installer findings R1–R4 are not reopened. The revised R6 timeout cleanup control passed in this run; startup failures now await stop and the main runner has finally cleanup. No product code was changed.

## Required findings

### R5a — P1: packaged live activation actually requires restart

Location: `scripts/verify-dsh-context-installed-flows.mjs:495–497`; runtime decision: `packages/boot/plugin-manager/src/index.ts:802–804`.

Executed the exact installed-flow command against the named .app. It exited 1 at G3: `setBundleEnabled` returned `application: 'restart-required'`, whereas the assertion requires `applied`. The run passed metadata, timeout cleanup, default-OFF discovery and absent projections before reaching this failure. The packaged plugin-manager implementation chooses restart-required when `ownerContext.get('hmr')` is undefined, and its reload method then does nothing. Thus the current packaged path does not meet instant activation and this review cannot reproduce the claimed READY result.

Provide the supported Host activation mechanism in the delivered desktop composition and verify both Host projections and the actual native Client update after toggling in one running application. Do not weaken the assertion to accept restart-required while retaining the instant-toggle promise. The independent `testInstalledClientMounting` helper manually evaluates the client with mocked primitives/locale in a new Cordis context; it cannot establish that a live Tauri WebView receives, mounts or removes the module after the Host toggle. That native integration remains unverified.

### R5b — P2: the offline check accepts external sockets and treats inspection failures as success

Location: `scripts/verify-dsh-context-installed-flows.mjs:95–110`, called once before activation.

The regex accepts any line containing a loopback token, regardless of its remote endpoint, and explicitly accepts wildcard listeners. Directly invoked the exported helper with both of these rows; neither threw:

```text
node 123 user 14u IPv4 0x123 0t0 TCP localhost:51234->93.184.216.34:https (ESTABLISHED)
node 123 user 14u IPv4 0x123 0t0 TCP *:8080 (LISTEN)
```

The catch also returns success for every lsof error, not just the documented no-sockets status. Additionally, a single pre-toggle observation cannot detect connections made later or completed before inspection; proxy environment variables do not enforce network isolation for all Node transports. The synthetic negative control has only a remote address, so it misses the demonstrated false-pass case.

Parse local and remote endpoints separately, reject foreign peers and wildcard binding for the stated loopback-only rule, and fail on unavailable/denied inspection. Exercise a real external-connection negative control under the same network restriction/observation used throughout boot and toggles. Do not call the current snapshot offline enforcement.

### R5c — P2: G6/G7 still do not test persisted toggle state or payload refresh

Location: `scripts/verify-dsh-context-installed-flows.mjs:550–606`.

G6 calls seedProfile before each ON/OFF boot, replacing the profile rather than restarting with the state persisted by the live toggle. G7 writes manifestOn, immediately reads that same file and asserts it contains ON; then repeats for OFF. There is no revision change, stamp check, resource copy or Rust installer invocation. Both pass even if live toggle persistence or revision refresh is broken.

For G6, choose each state via the public toggle, stop, restart without reseeding and assert the saved selection plus projections. For G7, run the real installer with a different payload revision on each selected state and inspect both the copied payload/stamp and preserved selection. Add a failing control that detects a refresh resetting the user's choice.

## Verification and limits

- `node scripts/verify-dsh-context-installed-flows.mjs apps/desktop/src-tauri/target/release/bundle/macos/octopus_DSH.app`: exit 1, G3 actual restart-required versus expected applied. Log: `/tmp/dsh-context-review3-installed.log`.
- Imported and invoked `assertSocketsLoopbackOnly` against the two socket rows above: both incorrectly accepted.
- Inspected packaged plugin-manager runtime and the Client helper; the latter substitutes dependencies and manually mounts a detached Cordis context.
- No full bundle-gate rerun, UI automation, DMG build, installation or live user-profile edits were performed. Since the full gate invokes the failing installed-flow command, the reported 114-pass qualification is not reproduced by this review.

Advisory for the timeout control: the assumption that a real companion cannot become ready within 50 ms is scheduler/machine-dependent. A controlled child that deliberately withholds readiness would make the failure control deterministic, with unconditional cleanup even if readiness unexpectedly succeeds.
