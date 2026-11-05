# RC1-07: Mobile keyboard and visual viewport

Implemented against the accepted bounded manifest and M2 exit source freeze; final shipping acceptance remains root-owned.

Mobile mount leaves the editor unfocused. Acceptance dismisses keyboard focus only when the active editor becomes empty; refusal retains editor focus and document. Anchored menus use visualViewport offsets/size and react to resize/scroll. The bounded Lexical patch prevents unwanted viewport movement while retaining existing editor behavior.

## Verification actually run

The integrated direct-Node run passed 102 files / 1,489 tests (`client-final-focused.log`):

```sh
node node_modules/vitest/vitest.mjs run packages/client/ui-conversation/tests packages/client/ui-chat/tests packages/client/ui-sidebar/tests packages/session/message-quotes/tests packages/client/ui-trajectory/tests/views.client.spec.tsx packages/client/ui-trajectory/tests/table.client.spec.tsx packages/client/ui-primitives/tests/use-anchored-position.client.spec.tsx packages/api/session-controller/tests/prompt-request-reservation.host.spec.ts packages/api/session-controller/tests/session-pending-submissions.client.spec.ts
```

editor-viewport, input-bar and use-anchored-position Client cases cover active focus, accepted versus refused clearing and viewport clamping. composer-focus.e2e.ts authors Chromium desktop/mobile and WebKit mobile pointer send, real focus, keyboard-panned visual viewport and anchored menu checks.

Subsequent focused runs passed 132 quote/admission tests (`quote-keyboard-final.log`), 147 folding tests (`chat-fold-final.log`), 42 trajectory-table tests (`trajectory-table-final.log`), and 40 navigation tests (`pin-icons-final.log`). These counts overlap the integrated suite and must not be summed as unique tests. Scoped diff whitespace checking passed.

## Source and preservation

Behavior source: `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`; exact bounded tag paths/blobs are in `rc1-client-candidate-files.json`. Existing fork files were adapted in place; only entirely new files used bounded tag starting content. No origin/master source, Git write, install, emit, build, generator, browser/TCC action, paid API or real IM send was performed by this worker. UPSTREAM_PIN/basePin remain alpha and product version remains `0.2.1-alpha.1`.

## Root wiring and remaining acceptance

Root owns workspace dependency/lock refresh, web-app client composition, compiler aggregate and alias wiring, profile distribution pins, generated declaration/bundle outputs, registry rows and bilingual pairing records. The new message-quotes manifest is frozen and includes @types/react; root was notified before refresh. Root also owns patchedDependencies/lock for the exact Lexical patch. Root must run built recorded-session browser tests, update the changed queue sending golden from real accepted behavior, run document generators/gates, compile refreshed declarations, and independently review/test these changes before acceptance. No built-browser or physical mobile-keyboard result is claimed here. Final scoped typed lint passed with zero diagnostics after root refreshed the quote importer (`client-owned-lint.json`, 91 TypeScript files). No casts or waivers were added to bypass missing declarations.

## Exact worker paths and final identities

Shared paths appear in every applicable item; root must split their hunks in order 06 → 05 → 07 → 08. Root-generated `.i18n.yaml` records are excluded from worker ownership. Machine-readable complete identities: `client-final-files.json`.

| Path | SHA-256 | Git blob |
| --- | --- | --- |
| `apps/web/tests/composer-focus.e2e.ts` | `eb1756f6e8d686143bcfe3e275e9e6f3d9aab47fabf0ddead2ec555ef2c3f683` | `d7cfb85d6b1ad66ba7f73670ad5538d915a817fd` |
| `packages/client/ui-conversation/src/client/input/editor/view-binding.ts` | `82f6a8a39992f4fda49aa6c59113a574c6708870b5fccb3ccd0149c5ac945bf2` | `4e42f170a4a47e6f893ca1fafa7d2cb90065ec6b` |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx` | `188c7db16d1d401913d9a233dd57a098c01203506043028f93f9aaa5c025912e` | `5a1532036ed1b6c22b3beaae10df4b53fee8884a` |
| `packages/client/ui-conversation/tests/draft-document.client.spec.ts` | `dbeda8d28f6d3ce0c2bf629ebfb5cd35db835eb3023974cf8c144ebf521d3568` | `3f26e92e65de14a206fcc3f85678b47dbda4b32c` |
| `packages/client/ui-conversation/tests/editor-viewport.client.spec.ts` | `08bf44cc22b8ac4531d787c0aeae9331a4c31578b864eaef7215022d7629f194` | `ce754ec35c35c11295a6b6712b95491d7b493444` |
| `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` | `533cce92ac0752daa6c842236c3b014a2b84d11d8b7fb57507d78f47ac425a04` | `e0dc478bde7b3255394c5f4744231555cc26e486` |
| `packages/client/ui-primitives/README.md` | `5a6ac55b98c856029b1173a8988b252f56f40d1e3d8891b9e000428cf304bf20` | `03bcf2e1dfa174cd721157a626047d0e9ed4d178` |
| `packages/client/ui-primitives/README.zh.md` | `11db870232fd043cacde587865847489a17bcc70f785c7b4c4d7aff0ae0bc311` | `f4d066e5b9f96b363bb5375f977f2ef98a9f4034` |
| `packages/client/ui-primitives/src/focus.ts` | `5c1327dc59fdd6612e205ea170768755f7b8b8129ec2ec24b12f68ee624b6614` | `81bd5b14e9c6b3d74aa37131ecfbca5598b28464` |
| `packages/client/ui-primitives/src/index.ts` | `1b8d11a34aaf1eee0abe06bbeafb78416081847d8d2d47243015ba2dc06e15f6` | `1977aaa99316f0db1210f768f4929fe9f495cc54` |
| `packages/client/ui-primitives/src/useAnchoredPosition.ts` | `214466423a6bb915d03cca8a9da37401d9800fd819daed90aa0b2959b0413477` | `c56a51e860e4f8de21e9cc5262e979e6e52a6ee7` |
| `packages/client/ui-primitives/tests/use-anchored-position.client.spec.tsx` | `74959acffb6c52574a0e28bdab0dee07baf8cf124af05ca2e25a7c235ca18765` | `35c5eef4ef21a636c18169f106746b78b1288f18` |
| `patches/lexical@0.49.0.patch` | `54c4413db208cf234cb68c6a837f2523d3b319aa17911f1da385af08362e1356` | `9581885353570681024d139372ed6f62868afdd1` |
