# RC1-06: Host admission and retained composer

Implemented against the accepted bounded manifest and M2 exit source freeze; final shipping acceptance remains root-owned.

The Host reserves requestId synchronously before resolveAgent, attachment or admission awaits and shares one promise. Failure releases the reservation for retry; accepted inbox/log content remains intact. The composer keeps its complete read-only draft until acceptance, then clears and publishes one echo; overlapping Client receipts do not duplicate it. The continuable subagent path still creates a new requestId, and queued human-answer text remains untouched.

## Verification actually run

The integrated direct-Node run passed 102 files / 1,489 tests (`client-final-focused.log`):

```sh
node node_modules/vitest/vitest.mjs run packages/client/ui-conversation/tests packages/client/ui-chat/tests packages/client/ui-sidebar/tests packages/session/message-quotes/tests packages/client/ui-trajectory/tests/views.client.spec.tsx packages/client/ui-trajectory/tests/table.client.spec.tsx packages/client/ui-primitives/tests/use-anchored-position.client.spec.tsx packages/api/session-controller/tests/prompt-request-reservation.host.spec.ts packages/api/session-controller/tests/session-pending-submissions.client.spec.ts
```

prompt-request-reservation.host.spec.ts; session-pending-submissions.client.spec.ts; submit-machine, input-matrix, input-reference-submit and service-orchestration Client cases. Recorded-session browser coverage is authored in prompt-admission.e2e.ts; existing queue-actions.e2e.ts now asserts retained read-only draft before acceptance.

Subsequent focused runs passed 132 quote/admission tests (`quote-keyboard-final.log`), 147 folding tests (`chat-fold-final.log`), 42 trajectory-table tests (`trajectory-table-final.log`), and 40 navigation tests (`pin-icons-final.log`). These counts overlap the integrated suite and must not be summed as unique tests. Scoped diff whitespace checking passed.

## Source and preservation

Behavior source: `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`; exact bounded tag paths/blobs are in `rc1-client-candidate-files.json`. Existing fork files were adapted in place; only entirely new files used bounded tag starting content. No origin/master source, Git write, install, emit, build, generator, browser/TCC action, paid API or real IM send was performed by this worker. UPSTREAM_PIN/basePin remain alpha and product version remains `0.2.1-alpha.1`.

## Root wiring and remaining acceptance

Root owns workspace dependency/lock refresh, web-app client composition, compiler aggregate and alias wiring, profile distribution pins, generated declaration/bundle outputs, registry rows and bilingual pairing records. The new message-quotes manifest is frozen and includes @types/react; root was notified before refresh. Root also owns patchedDependencies/lock for the exact Lexical patch. Root must run built recorded-session browser tests, update the changed queue sending golden from real accepted behavior, run document generators/gates, compile refreshed declarations, and independently review/test these changes before acceptance. No built-browser or physical mobile-keyboard result is claimed here. Final scoped typed lint passed with zero diagnostics after root refreshed the quote importer (`client-owned-lint.json`, 91 TypeScript files). No casts or waivers were added to bypass missing declarations.

## Exact worker paths and final identities

Shared paths appear in every applicable item; root must split their hunks in order 06 → 05 → 07 → 08. Root-generated `.i18n.yaml` records are excluded from worker ownership. Machine-readable complete identities: `client-final-files.json`.

| Path | SHA-256 | Git blob |
| --- | --- | --- |
| `apps/web/tests/prompt-admission.e2e.ts` | `a372098d2b47229d45a5d837780d35cb3a89edb9cbfee439b8cc9e9f861c3672` | `7a7b104f652acf9c701e06a6d8f8e1478b70b71b` |
| `apps/web/tests/queue-actions.e2e.ts` | `c63e66ac14308fddb1b4145ba29f62d0c26c700b8e2b69a291f57ab72695dbd5` | `41929b28367f78bce515547e4817ced5826a4316` |
| `docs/upgrade-guide/v0.2.1-alpha.1/composer-admission/guide.md` | `635705ee6e6eebc7a8cb720d3d01d691a895f3386731ad000dcf583f0253036a` | `f7243bdbccd2c629bbf3e9afaedb63aa1897e8c7` |
| `docs/upgrade-guide/v0.2.1-alpha.1/composer-admission/guide.zh.md` | `bc9917565a94c54e642b3fcb1765379032d48a269a776db2bedca353a109ae6e` | `c19c29333b6a5529514399fd5a1185251fcf7273` |
| `packages/api/session-controller/README.md` | `d039f48963ab584ca3effa6c3bc2343e613d0bac4fc3a37980bf4f54dfcc71a6` | `88053c4ede04192a25bba2dfb124d9c26faaefb6` |
| `packages/api/session-controller/README.zh.md` | `f8569670bce22ec44a2a5e6e38e66fe611b7901cae60c2a1573755caa9c5e983` | `91c877b981ec32e1a3e69c445a3b187225fc25ba` |
| `packages/api/session-controller/src/client/contract/session.ts` | `f9bd7abdb319ed487be3495aca4a467bfe618cb38021b83c564dd7b0f223494a` | `079821a964be7d0c8db1ab240e7d64e5ff1da0cd` |
| `packages/api/session-controller/src/client/contract/snapshot.ts` | `80c0a51149860729ff0dd8a136d6b20aa07f58bf0133d1ac687d88657dae9bd3` | `60297cff8dc5dffab72ded0788ecdf7215d1c4e3` |
| `packages/api/session-controller/src/client/sessions/session.ts` | `5721239750a47831a64e97803ae91291131b9ecd7d920fb7f5b0da63347b06b0` | `b4f928f523db3158d6a5b9e9e6f85d9e19330a3c` |
| `packages/api/session-controller/src/commands.ts` | `60dc170ae56dc32d82cf48160833fbff8ac04770082aeba305c6ef8becd944b6` | `f1d45ced90c1bf806e2630b051738549d906472f` |
| `packages/api/session-controller/tests/prompt-request-reservation.host.spec.ts` | `1d8a49b7581ef3359357c118145a4a0e9d8194ad23bba83e5586c9c4071c006d` | `a0cc8bb3b2020f43ff439f5e8cfd8f64b400c47f` |
| `packages/api/session-controller/tests/session-pending-submissions.client.spec.ts` | `6d75dc3c7904f4b872931fbc304af4eb0366d450dab42ca972f6191e4c2dffe5` | `39f09757d394829562daeeb24c42f1a44e4f1a33` |
| `packages/client/ui-conversation/README.md` | `f43b1d69a9b93902a83dcc2014241b1abf85d7f15e00d64117f6ac6fa60d570c` | `7490c518edae4eed671865741b0223814c030889` |
| `packages/client/ui-conversation/README.zh.md` | `ac502a189390a54d36a96a4db356ef2d3761ebe9fb2b164dba6867c3c7e4c3dc` | `63638dfbce2aa9838d111e20c63098acbc66d28f` |
| `packages/client/ui-conversation/src/client/contract/draft-editor.ts` | `303ac01f06cfdd4af213af6a594444d10ec4ad89ed9161e5816e91fa68d8438e` | `8c7e95affad207303526782ebb29eb8c44772a92` |
| `packages/client/ui-conversation/src/client/contract/input.ts` | `bf04a15a15e73dbd8c284d84ff04c0e3e2e1c83249514aed89c53b930c744025` | `8ff1edddaea4aa54c27225520477f45264eceef5` |
| `packages/client/ui-conversation/src/client/input/editor/view-binding.ts` | `82f6a8a39992f4fda49aa6c59113a574c6708870b5fccb3ccd0149c5ac945bf2` | `4e42f170a4a47e6f893ca1fafa7d2cb90065ec6b` |
| `packages/client/ui-conversation/src/client/input/facade.ts` | `ff6bfa1d2c4d7aa27e079da5b7e4c8f3cc1d815bc6f019c664106f4fff3f641b` | `2ffed608b56bfa72cd4122d9bd195b7c9e5f4a01` |
| `packages/client/ui-conversation/src/client/input/machine.ts` | `c9170f92c7e3adeabd17c062043796a315b14ef37804e753e09797cf454c7bc5` | `79230f42b470295f10f40f7fae50524a3a31cc29` |
| `packages/client/ui-conversation/src/client/locales.ts` | `c19f562d149fcb54d18d3e775e1b1d97f60a41196099ddddb37f705d81087c2e` | `bf816fd7500b56f21d206ea34ff2a2b496635811` |
| `packages/client/ui-conversation/src/client/service.ts` | `1f87b02acac81f05b200224c792e03d9a1cc094f728dadbf81ecd8a0dcc89e4b` | `75fbdf1b84bc7fb097cca2440789e1b10dbb7e78` |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` | `188c7db16d1d401913d9a233dd57a098c01203506043028f93f9aaa5c025912e` | `5a1532036ed1b6c22b3beaae10df4b53fee8884a` |
| `packages/client/ui-conversation/tests/draft-document.client.spec.ts` | `dbeda8d28f6d3ce0c2bf629ebfb5cd35db835eb3023974cf8c144ebf521d3568` | `3f26e92e65de14a206fcc3f85678b47dbda4b32c` |
| `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` | `533cce92ac0752daa6c842236c3b014a2b84d11d8b7fb57507d78f47ac425a04` | `e0dc478bde7b3255394c5f4744231555cc26e486` |
| `packages/client/ui-conversation/tests/input-matrix.client.spec.tsx` | `836136e40d0c62319c8baa7be4ae92e3dc4a7fe969204ab52645af9a03d21fe5` | `e3e27dec1cd6e2be3b4a1678d4d4864d079f00e1` |
| `packages/client/ui-conversation/tests/input-reference-submit.client.spec.ts` | `e68aabd2e6d4fa4cca79a21552f89c14ce7182fa42701b82a174e0c3137741e4` | `a1c65bdbaacad3546c04637f6a717c1ca8167ffc` |
| `packages/client/ui-conversation/tests/service-orchestration.client.spec.ts` | `e139402098519a05ccdcaa0701b20597d361e066262480f22bb2e04d0e577672` | `2f09caf7d92bab88d7ceb5881df59738e02aa4d5` |
| `packages/client/ui-conversation/tests/submit-machine.client.spec.ts` | `ef86715dbb37a5ec576626eba0404bd217739bbfd6458ed1da945f49544d4cb3` | `ae94745c73f7e5f04ab35648e297ddf6f5c93070` |
