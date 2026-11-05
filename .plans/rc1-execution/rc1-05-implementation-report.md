# RC1-05: Atomic Markdown quotes

Implemented against the accepted bounded manifest and M2 exit source freeze; final shipping acceptance remains root-owned.

Selection inserts one atomic Lexical quote node using the current keyed text-interaction slot. Retained draft persistence carries quote spans alongside existing reference chips; send serializes ordinary multiline Markdown with one > prefix per line and no new message field or event. projectUserText renders the quote preview while preserving external reference/skill chips; stale selections and unwritable sessions dismiss safely. The new message-quotes package registers en/zh only and no competing userText service.

## Verification actually run

The integrated direct-Node run passed 102 files / 1,489 tests (`client-final-focused.log`):

```sh
node node_modules/vitest/vitest.mjs run packages/client/ui-conversation/tests packages/client/ui-chat/tests packages/client/ui-sidebar/tests packages/session/message-quotes/tests packages/client/ui-trajectory/tests/views.client.spec.tsx packages/client/ui-trajectory/tests/table.client.spec.tsx packages/client/ui-primitives/tests/use-anchored-position.client.spec.tsx packages/api/session-controller/tests/prompt-request-reservation.host.spec.ts packages/api/session-controller/tests/session-pending-submissions.client.spec.ts
```

quote-text and quote-selection Client tests, draft-document and input-bar cases cover parsing, refusal/restore, chip preservation and adjacent atomic keyboard deletion. rich-text-quotes.e2e.ts authors actual pointer selection, refusal/retry and logged Markdown through recorded-session harness.

Subsequent focused runs passed 132 quote/admission tests (`quote-keyboard-final.log`), 147 folding tests (`chat-fold-final.log`), 42 trajectory-table tests (`trajectory-table-final.log`), and 40 navigation tests (`pin-icons-final.log`). These counts overlap the integrated suite and must not be summed as unique tests. Scoped diff whitespace checking passed.

## Source and preservation

Behavior source: `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`; exact bounded tag paths/blobs are in `rc1-client-candidate-files.json`. Existing fork files were adapted in place; only entirely new files used bounded tag starting content. No origin/master source, Git write, install, emit, build, generator, browser/TCC action, paid API or real IM send was performed by this worker. UPSTREAM_PIN/basePin remain alpha and product version remains `0.2.1-alpha.1`.

## Root wiring and remaining acceptance

Root owns workspace dependency/lock refresh, web-app client composition, compiler aggregate and alias wiring, profile distribution pins, generated declaration/bundle outputs, registry rows and bilingual pairing records. The new message-quotes manifest is frozen and includes @types/react; root was notified before refresh. Root also owns patchedDependencies/lock for the exact Lexical patch. Root must run built recorded-session browser tests, update the changed queue sending golden from real accepted behavior, run document generators/gates, compile refreshed declarations, and independently review/test these changes before acceptance. No built-browser or physical mobile-keyboard result is claimed here. Final scoped typed lint passed with zero diagnostics after root refreshed the quote importer (`client-owned-lint.json`, 91 TypeScript files). No casts or waivers were added to bypass missing declarations.

## Exact worker paths and final identities

Shared paths appear in every applicable item; root must split their hunks in order 06 → 05 → 07 → 08. Root-generated `.i18n.yaml` records are excluded from worker ownership. Machine-readable complete identities: `client-final-files.json`.

| Path | SHA-256 | Git blob |
| --- | --- | --- |
| `apps/web/tests/rich-text-quotes.e2e.ts` | `fe7dfdf168c50e3d5a4208b352944007223e55883689c47c4340ad2f0a38ee87` | `f72e7662bc724a7ba80c2967c7628f90b106ef2a` |
| `packages/client/ui-chat/src/client/apply.ts` | `b7b190a10003d9be91b8c3a472bebc2faefd7b644c491127ef1eaa0b0ce8b56a` | `0d776375df4528a1e69a75fc7fbbe2cfc54956e4` |
| `packages/client/ui-chat/src/client/chat/ChatView.tsx` | `7fbbd03320e802c0bbfe51bc55074db9cf6076e96e716edf646a370733be5fb2` | `e0883efad942ac9f26b453d8d3d5b4561eab2f2e` |
| `packages/client/ui-chat/src/client/chat/text-interaction.ts` | `88eb0b7023742841284e41268bb703029ec63033a34cae6eee2ac41e8173dbcf` | `b53479eb80cd14f3441d7e44e7626ce7e44dd974` |
| `packages/client/ui-chat/src/client/chat/text-selection.ts` | `b739f3f8b4d96929bab81ecc8ea5755ea569c434fa3ca7b32fa4276a7e5266ab` | `bc3ae4dec02dbe82c48cf6b9f628b7db5c4e51f8` |
| `packages/client/ui-chat/src/client/contract/slots.ts` | `6852e917414b5780a53b0c94c9f4a35f8bcbbbeea9eb61c3632356e1b5198543` | `37b22287c3151987bcb8f388193ff2e6989c0690` |
| `packages/client/ui-conversation/README.md` | `f43b1d69a9b93902a83dcc2014241b1abf85d7f15e00d64117f6ac6fa60d570c` | `7490c518edae4eed671865741b0223814c030889` |
| `packages/client/ui-conversation/README.zh.md` | `ac502a189390a54d36a96a4db356ef2d3761ebe9fb2b164dba6867c3c7e4c3dc` | `63638dfbce2aa9838d111e20c63098acbc66d28f` |
| `packages/client/ui-conversation/src/client/apply.ts` | `6680b0f0357956268b5e59efa29e4ef23342c81db04f7e29b224d9312cb0c239` | `524cd408225a2613470154ca65c44ac0aaff0f3e` |
| `packages/client/ui-conversation/src/client/contract/draft-editor.ts` | `303ac01f06cfdd4af213af6a594444d10ec4ad89ed9161e5816e91fa68d8438e` | `8c7e95affad207303526782ebb29eb8c44772a92` |
| `packages/client/ui-conversation/src/client/contract/input.ts` | `bf04a15a15e73dbd8c284d84ff04c0e3e2e1c83249514aed89c53b930c744025` | `8ff1edddaea4aa54c27225520477f45264eceef5` |
| `packages/client/ui-conversation/src/client/draft.ts` | `35d82b01a2ec817b33d64f1c818a4e40b322ef661d7828f5bfd2ab6f42106a58` | `dc63fa55f4958c63330e884449fc27d8029db360` |
| `packages/client/ui-conversation/src/client/input/editor/QuoteNode.tsx` | `642121c643ac2bf52397ef909c40228aa446c1f4e522661366927f5508ab4cd3` | `ecd42af89ddcfcdf6e4bde3ff781c943ddcfba51` |
| `packages/client/ui-conversation/src/client/input/editor/keymap.ts` | `0a43e5d6c34a14b86c094bf73d5143378935ccba503c2e8bebf60f5072933e8b` | `7db520cf15687a0d118b2d182c258d4542f53b14` |
| `packages/client/ui-conversation/src/client/input/editor/projection.ts` | `039982d6af222239eb9de133171e5e2fe9fe12c0b36433397ceac7c0a62eefd5` | `1a34a8f8aea0597a388b9263478ae95511db38fe` |
| `packages/client/ui-conversation/src/client/input/editor/runtime.ts` | `ee566201a723fda2066c03e6b3d940557396cb63833b404ee7f79890525f20fe` | `3a7c1ccb0cb6f61d9f1b28a1afd2e92b4128190b` |
| `packages/client/ui-conversation/src/client/input/facade.ts` | `ff6bfa1d2c4d7aa27e079da5b7e4c8f3cc1d815bc6f019c664106f4fff3f641b` | `2ffed608b56bfa72cd4122d9bd195b7c9e5f4a01` |
| `packages/client/ui-conversation/src/client/input/hub.ts` | `f57b3b37fcdd384fe307b93193104305945be6f2528ca683383bdef36f8aca4e` | `1e1c84f4fc6345e079fc5d9aaa0950127b821054` |
| `packages/client/ui-conversation/src/client/input/machine.ts` | `c9170f92c7e3adeabd17c062043796a315b14ef37804e753e09797cf454c7bc5` | `79230f42b470295f10f40f7fae50524a3a31cc29` |
| `packages/client/ui-conversation/src/client/input/prompt.ts` | `fa7db06b455dfd9d8f944380e948cdb52c411940772768b13eec860275f8cafb` | `548256599cd291692084c6217de31bc537e6b2b2` |
| `packages/client/ui-conversation/src/client/locales.ts` | `c19f562d149fcb54d18d3e775e1b1d97f60a41196099ddddb37f705d81087c2e` | `bf816fd7500b56f21d206ea34ff2a2b496635811` |
| `packages/client/ui-conversation/tests/draft-document.client.spec.ts` | `dbeda8d28f6d3ce0c2bf629ebfb5cd35db835eb3023974cf8c144ebf521d3568` | `3f26e92e65de14a206fcc3f85678b47dbda4b32c` |
| `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` | `533cce92ac0752daa6c842236c3b014a2b84d11d8b7fb57507d78f47ac425a04` | `e0dc478bde7b3255394c5f4744231555cc26e486` |
| `packages/client/ui-primitives/README.md` | `5a6ac55b98c856029b1173a8988b252f56f40d1e3d8891b9e000428cf304bf20` | `03bcf2e1dfa174cd721157a626047d0e9ed4d178` |
| `packages/client/ui-primitives/README.zh.md` | `11db870232fd043cacde587865847489a17bcc70f785c7b4c4d7aff0ae0bc311` | `f4d066e5b9f96b363bb5375f977f2ef98a9f4034` |
| `packages/client/ui-primitives/src/QuotePreview.module.css` | `d4e4622fc0c6a94c79981bdb2cbebff6e9420e83f4297ea9697ac4929cae7afa` | `1418d8393cd9d574934407d95766066e181abd51` |
| `packages/client/ui-primitives/src/QuotePreview.tsx` | `89db392df500f8a1c3258a6f25842af37d4d6f097ccb6ede704f6a9884e55450` | `000c52eb56b38c766445cd175945221810eff903` |
| `packages/client/ui-primitives/src/index.ts` | `1b8d11a34aaf1eee0abe06bbeafb78416081847d8d2d47243015ba2dc06e15f6` | `1977aaa99316f0db1210f768f4929fe9f495cc54` |
| `packages/client/ui-primitives/src/markdown/quote-text.ts` | `f268a92670488325c2718efea904747d54be243c9425751e1c88e8a466858900` | `603855d624c202299143906dc913697d293d4c30` |
| `packages/client/ui-primitives/src/user-text.tsx` | `46493c3ac2f3ef09d6c88737ec1e0cffd959379568737e2881e211d6ed48d209` | `c4939b0605d1a64c93239d5c10daa0f985700c30` |
| `packages/session/message-quotes/README.md` | `dbc7dd593b0c8bc93867f693694058e486619dcd86dbba79dbf2d2a81531de34` | `e42c3a58ce080400aacdb7450ed879c2e5f98737` |
| `packages/session/message-quotes/README.zh.md` | `b6d58b9b05ae89c3aad1fb70343e5995de43dadf508831092dad4de222af32b3` | `bc096dd545ff6da20d5bfeb3b7c34595ee1e3f0d` |
| `packages/session/message-quotes/locale/en.json` | `b7cb68853a814d5ed199b4e51b1c0338e04efb5995dffdee12cb3cc4d3ccc674` | `dd73eca27abcc08ff50c7688ebbf03f6fbba5b04` |
| `packages/session/message-quotes/locale/zh.json` | `974b202a749015f221d782305b92b764073987ce5ca818bf3d9a9292666d6313` | `e739f21ccf8160b2aa9b98b9e15693a30ef0aaa8` |
| `packages/session/message-quotes/package.json` | `c436711d0a83008f335be78e5d8d413a833e107097b06f4f619afcd0f2451f20` | `2dfcfe8aa15e36c6c504fabfeb21e5a2e3187a8f` |
| `packages/session/message-quotes/src/client/QuoteSelection.module.css` | `7c9e6e0725c620ee1ccd6dada0d21afcd14a96b6e1cd6f639c14d702cdb83c9a` | `66eda4cfe68b00264b5500d58e3398d0a46c6cf5` |
| `packages/session/message-quotes/src/client/QuoteSelection.tsx` | `51b7af674939d6b71395cb54109d80451bfb2460d2d999803e18f55bcd1b4df8` | `6caa9f0942159fd77848216b0408c02717f86cb7` |
| `packages/session/message-quotes/src/client/index.ts` | `8423525fbd288e9c8478b23f30ecfecba0422c3b4d90fd7f18b0e80290d49fd5` | `224012e0c312d730042f775f2465dd41df52d025` |
| `packages/session/message-quotes/src/client/locales.ts` | `860d117e98aed66de1152d26070891c4ea37c39132bf6f150f0f9440f0545d28` | `75741e7a860e623af6fc864f8af4ce8dab4d58d5` |
| `packages/session/message-quotes/src/client/quote-text.ts` | `81dc50d903e5f44eab4f01da8594ec4bcabcb6d49a269268938fd8869e134251` | `ac9768e9b9c597cef46db9536815a0f75367e156` |
| `packages/session/message-quotes/src/css-modules.d.ts` | `e28410d74a0d763364c04fa690c2ca2202ad3019c74f8f5205e8dc6cba69c02f` | `bc5e482353ccdad2cac56977c6880a9453324cd6` |
| `packages/session/message-quotes/src/index.ts` | `8389066f0935cf0c63bd0ea29e96a32d1d24bda61e9f5003925523dbec399185` | `c6974f8db04908a79767a57d25eb753698986e07` |
| `packages/session/message-quotes/tests/quote-selection.client.spec.tsx` | `4a789fcd26e7a0c61e5d67514c772024eda200e5a2ccda9abb05aa39ab37d97f` | `ed4ec5c0af3d231ed93f2c7b47eef7129a265c2c` |
| `packages/session/message-quotes/tests/quote-text.client.spec.ts` | `370a7c33a8494fce105dd07c174080e6fba2a46d6fe9566f4303a2253b7231cb` | `86f30b093ad41fe7958adb0247edc6caf8175d1a` |
| `packages/session/message-quotes/tsconfig.json` | `3d9f6d6d803e83dc12e729a2ebea6360a10e33eacecc18614c91cc0e7f459ca7` | `51efa3354327026e7815ea864eba6035c20e7211` |
| `packages/session/message-quotes/tsdown.config.ts` | `eecc62a29cb44e5a66839a9a6a6e0461e4ebd5dc673398bd67dcb3313a516a47` | `71d5bd77f85a1bc0378ea441b06e7581618ee777` |
