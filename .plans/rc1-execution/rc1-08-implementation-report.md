# RC1-08: Transcript folding and navigation menus

Implemented against the accepted bounded manifest and M2 exit source freeze; final shipping acceptance remains root-owned.

Trajectory subcall collapse keeps the parent and restores nested records independently of turn/assistant folding. Chat profile settings default to completion/all without writing missing values; next-input deferral, final-only replies and explicit user folding share view state, while verbose offers no fold. View and sidebar pins use root-lifetime memory, fixed Chat/Plugins, responsive More menus and optional custom current-slot content. Existing Team pod, whale rail, workspaces, files/data/knowledge entries and right-pane behavior remain in place.

## Verification actually run

The integrated direct-Node run passed 102 files / 1,489 tests (`client-final-focused.log`):

```sh
node node_modules/vitest/vitest.mjs run packages/client/ui-conversation/tests packages/client/ui-chat/tests packages/client/ui-sidebar/tests packages/session/message-quotes/tests packages/client/ui-trajectory/tests/views.client.spec.tsx packages/client/ui-trajectory/tests/table.client.spec.tsx packages/client/ui-primitives/tests/use-anchored-position.client.spec.tsx packages/api/session-controller/tests/prompt-request-reservation.host.spec.ts packages/api/session-controller/tests/session-pending-submissions.client.spec.ts
```

Trajectory views/table, chat-store/view/presentation/reasoning/settings tests, sidebar SlotTestRuntime custom More/disposal and conversation skeleton tests passed. client-view-menus.e2e.ts authors recorded-trajectory pointer collapse/restore, view pin/select and sidebar overflow reachability; built browser execution remains root-owned.

Subsequent focused runs passed 132 quote/admission tests (`quote-keyboard-final.log`), 147 folding tests (`chat-fold-final.log`), 42 trajectory-table tests (`trajectory-table-final.log`), and 40 navigation tests (`pin-icons-final.log`). These counts overlap the integrated suite and must not be summed as unique tests. Scoped diff whitespace checking passed.

## Source and preservation

Behavior source: `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`; exact bounded tag paths/blobs are in `rc1-client-candidate-files.json`. Existing fork files were adapted in place; only entirely new files used bounded tag starting content. No origin/master source, Git write, install, emit, build, generator, browser/TCC action, paid API or real IM send was performed by this worker. UPSTREAM_PIN/basePin remain alpha and product version remains `0.2.1-alpha.1`.

## Root wiring and remaining acceptance

Root owns workspace dependency/lock refresh, web-app client composition, compiler aggregate and alias wiring, profile distribution pins, generated declaration/bundle outputs, registry rows and bilingual pairing records. The new message-quotes manifest is frozen and includes @types/react; root was notified before refresh. Root also owns patchedDependencies/lock for the exact Lexical patch. Root must run built recorded-session browser tests, update the changed queue sending golden from real accepted behavior, run document generators/gates, compile refreshed declarations, and independently review/test these changes before acceptance. No built-browser or physical mobile-keyboard result is claimed here. Final scoped typed lint passed with zero diagnostics after root refreshed the quote importer (`client-owned-lint.json`, 91 TypeScript files). No casts or waivers were added to bypass missing declarations.

## Exact worker paths and final identities

Shared paths appear in every applicable item; root must split their hunks in order 06 → 05 → 07 → 08. Root-generated `.i18n.yaml` records are excluded from worker ownership. Machine-readable complete identities: `client-final-files.json`.

| Path | SHA-256 | Git blob |
| --- | --- | --- |
| `apps/web/tests/client-view-menus.e2e.ts` | `c55ab63aecdd214a8fd3a23150133e9879b46f14b291933693d6dbf30b2c4904` | `4a606d7a54e98c4ec16a01b178978649d5f24ed8` |
| `docs/upgrade-guide/v0.2.1-alpha.1/folded-replies/guide.md` | `f51434b680d84767d0d2fbd00cc6f4652fa43065cdfa9f8b241558e4ead87988` | `7b8d4e151340ea85781e1c8fee9850823b4c9af8` |
| `docs/upgrade-guide/v0.2.1-alpha.1/folded-replies/guide.zh.md` | `3825fcb27d2e6edba3cea1acb5d334801326a19ad81e66e1626afe0125ffea40` | `9b60aee5c579298571780d901ac4fdd528f82b94` |
| `packages/client/ui-chat/src/chat-settings.ts` | `2457e423f4098b67c4c322f9c180cec9866146e53bfa527e67eece84650844fa` | `5865cf4fd5da66016a75f57fc6164e540487f4cf` |
| `packages/client/ui-chat/src/client/apply.ts` | `b7b190a10003d9be91b8c3a472bebc2faefd7b644c491127ef1eaa0b0ce8b56a` | `0d776375df4528a1e69a75fc7fbbe2cfc54956e4` |
| `packages/client/ui-chat/src/client/chat/AssistantNodeView.tsx` | `a5a952337a56604bdf5709b223e5ad15feb48e2a003635f1834978156e546ef0` | `01ae217a851bda42bc63df4e8070c5b8467874d1` |
| `packages/client/ui-chat/src/client/chat/ChatGroupSeat.tsx` | `ef60f89ff8a7715d526896ed8f4139ad6e4c19dacb34da29d8e1b72d1075e81d` | `99c74394e0158af283276af9ec2ceb085793f518` |
| `packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx` | `d20fa97baa4756d0d0df718e1290eb484d2c2d103be77982621594eed08b1dff` | `901d429f9ec1a8d067aee0cd56713762ae949acb` |
| `packages/client/ui-chat/src/client/chat/ChatView.tsx` | `7fbbd03320e802c0bbfe51bc55074db9cf6076e96e716edf646a370733be5fb2` | `e0883efad942ac9f26b453d8d3d5b4561eab2f2e` |
| `packages/client/ui-chat/src/client/contract/slots.ts` | `6852e917414b5780a53b0c94c9f4a35f8bcbbbeea9eb61c3632356e1b5198543` | `37b22287c3151987bcb8f388193ff2e6989c0690` |
| `packages/client/ui-chat/src/client/contract/store.ts` | `0ba97e88d6223d2b10bb289aa342d7ca7024931c9652e38a3ae44bf6700ede3b` | `814bc6af5adf1fe58d2b3c6c1ca7bc6ab39586ad` |
| `packages/client/ui-chat/src/client/conversation-nodes/README.md` | `34b1ae5a871a48c487492a09dcaef452bd532c2e66e51b70eb2fa2fd565ce5ba` | `11cace7de2a96871973a9b148bce6f63b56b73c4` |
| `packages/client/ui-chat/src/client/conversation-nodes/README.zh.md` | `4ab0b93dc1741b3c0a9cf95d7852b01d72f9ff8b907f4a2afd90f93908727d6f` | `b5b750889e13f978e9221d92ff32310c9cf754c0` |
| `packages/client/ui-chat/src/client/locale.ts` | `3a6a00b9c597f117eff55ff321d16895dedf219671b7dfe4ecb73c0c8e9fa10c` | `9b2e13f5cf0976d5a0432ec7daf4276e1f6422df` |
| `packages/client/ui-chat/src/client/presentation-policy.ts` | `1034eeac3d76f24809a9af98295bb92167b7241a95b8ff4f906250fb6a34195e` | `de6cb2a84896c332c43ec0151c65e4e9be8de7b5` |
| `packages/client/ui-chat/src/client/settings/TranscriptViewRow.tsx` | `211d6569a32dd91602c76cbcbd1b17f34be1d5ea528a5c94afa963c87cfd1373` | `862c289629599f51233a24cad0c45f84e8f0038c` |
| `packages/client/ui-chat/src/client/stores.ts` | `af1bd833594139a4f1fac187403e26ac79191c8f2fc39e85cf5c9aef8fa72752` | `ae3c81871145519f66a04273d105a84c9b266d1c` |
| `packages/client/ui-chat/src/client/transcript-view.ts` | `299db519df5d6742a00790d871674d7b6e4c1d64437ba946e1aa025ee39473ed` | `10a52aaf6139d40d485b6e861bc70143c7db2889` |
| `packages/client/ui-chat/tests/chat-store.client.spec.ts` | `2afeb55d6e9685b57d3f7bfa64c90cbebe829832998f433d813efc09c549dd6b` | `b80bbbeb230c54d39aab9d1b6b70390633da8991` |
| `packages/client/ui-chat/tests/chat-view.client.spec.tsx` | `d49896cb5d10c30fe9510fea70d05dafd07085e9ec6c919a5fb05417ba8e0faa` | `8ce6c0d6ee831a00389d8a960dada9937151194f` |
| `packages/client/ui-chat/tests/presentation-policy.client.spec.tsx` | `b7a5d9a31c70f0ebce00df02645a3e9c4007dcc37e9fa327328c886d713a88ec` | `b9b7118f674f5180685cf713d51d708a10c38e9a` |
| `packages/client/ui-chat/tests/reasoning-row.client.spec.tsx` | `b913c7782bcdcac3968fe22bb6bd2be75cf001755af3a5d3cc9b50fdb2fdc114` | `4adc8ef83efeb85a8491677048a067aaa277763c` |
| `packages/client/ui-chat/tests/transcript-view-policy.client.spec.ts` | `f8d3b56ef1e41f1f2fa01afe036f78bfa63aca7ba0f07c8301e25a5ba8bae920` | `9a065708a8e478c912f91ea727ee5ac7c9f9aab1` |
| `packages/client/ui-chat/tests/transcript-view-row.client.spec.tsx` | `781cbf0ca13eefde6bb39c0759486591d094bf63746679f910e2b79b56780e48` | `356ccd140cee073dbb863102db1d320e6d867daf` |
| `packages/client/ui-conversation/README.md` | `f43b1d69a9b93902a83dcc2014241b1abf85d7f15e00d64117f6ac6fa60d570c` | `7490c518edae4eed671865741b0223814c030889` |
| `packages/client/ui-conversation/README.zh.md` | `ac502a189390a54d36a96a4db356ef2d3761ebe9fb2b164dba6867c3c7e4c3dc` | `63638dfbce2aa9838d111e20c63098acbc66d28f` |
| `packages/client/ui-conversation/src/client/apply.ts` | `6680b0f0357956268b5e59efa29e4ef23342c81db04f7e29b224d9312cb0c239` | `524cd408225a2613470154ca65c44ac0aaff0f3e` |
| `packages/client/ui-conversation/src/client/contract/slots.ts` | `5a92ae655d06bb253c218627fc63436340549fd94dcef4338e586d5d35dc8b65` | `119a83a8696056a56696c334ab26155ad36f6395` |
| `packages/client/ui-conversation/src/client/input/hub.ts` | `f57b3b37fcdd384fe307b93193104305945be6f2528ca683383bdef36f8aca4e` | `1e1c84f4fc6345e079fc5d9aaa0950127b821054` |
| `packages/client/ui-conversation/src/client/locales.ts` | `c19f562d149fcb54d18d3e775e1b1d97f60a41196099ddddb37f705d81087c2e` | `bf816fd7500b56f21d206ea34ff2a2b496635811` |
| `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css` | `efd46e685a827db05cbf57e426807aad9026d0cc754de2d62f59cfd697ecbf33` | `0b309f1082d456c5278ced19b7181abc4d03073b` |
| `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx` | `97063636ff16f83e66c310c0a983193eb486cee46c231a768f5f893c1209751a` | `f034101a1bf29f2d8407f052485c47eef4c01b0e` |
| `packages/client/ui-conversation/src/client/view-pins.ts` | `7efc6c760a78c6a3db58d7c3191ba9bff84c66ad5bb02c54b5b49230ef8237f1` | `d3d4e1f408fadb31ab0513c5002a69e4f4cc721a` |
| `packages/client/ui-conversation/tests/apply-inject.client.spec.tsx` | `206888a630d98075cbf976cef207764f27a308abf39e88c1aa56a101551d4f93` | `25ba1e6dd89d1181a7070dbea5aa6dc611cccf61` |
| `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` | `30e3b19c9d9892c1506584723b8616e11b52557eef43eea23b035ad1d26289b0` | `d1cf28c7614059260b28df10ccb3f21dc9a466ee` |
| `packages/client/ui-sidebar/README.md` | `89a05202bbbf1e11ae68ddcccdb30b0c705cd6d2148b228272ef41078825272e` | `3be4f4a5a46d6e02cc45ceca56d6365250e25b2b` |
| `packages/client/ui-sidebar/README.zh.md` | `66fa17cf9fbc3693c52df95c1d24bc4cbde9606d92ff1b4df51d130282f744f2` | `a5aa9664f8e60f49856320325ed2060d77c34763` |
| `packages/client/ui-sidebar/src/client/SidebarRoot.module.css` | `c0b101a33ae18e28db5ab355d384ff011ca3a1ed58f1ed84033f17428d8f7610` | `119e94522ad55805267c4785acd249c9f9a5700b` |
| `packages/client/ui-sidebar/src/client/SidebarRoot.tsx` | `44df9d89c5c4eca816370c928e4e18dd2f5ad725fbb6ae6872161bf8fde13c2e` | `ce5bfd1cdfa7c70e34cc0e886a70c942c5e57ed0` |
| `packages/client/ui-sidebar/src/client/contract/slots.ts` | `48613c148b842b3307f4427d640e0c06c0f22d1fcae33a1fbba9ab155ca20c5f` | `bdd9acd55a2e2c2c7d95ac49fdd991548ed4a4aa` |
| `packages/client/ui-sidebar/src/client/index.ts` | `e5ad9c7f2bc23b686289d56bf5d104e55a7af1fb2f635f424d89064703b0b7f9` | `1adf5d5cfe2de832aaebe1c7798c2289d277d645` |
| `packages/client/ui-sidebar/src/client/locales.ts` | `4da6eba63408e1ac951679a592b22b42c0f70b6408addcb0d45bad8aebe94783` | `bbc60aa9ac4d9e970c2942f32640d5653d78893e` |
| `packages/client/ui-sidebar/src/client/panel-pins.ts` | `aa50c9eeee25bf161ba1aa0c75fb46796cdb1258ecada82b56349bc7fe84dffc` | `72d0157ff2bcc003bc57dc13009e275165013d21` |
| `packages/client/ui-sidebar/tests/apply.client.spec.tsx` | `d6af108a971aa86ff1a0d9debb2023ee5d0e41a4dfaf480461b58a9d4b570183` | `8a7809034c5842c0fe877403e1f8587230cbcd1f` |
| `packages/client/ui-sidebar/tests/panel-list.client.spec.tsx` | `128dc793477bda54fdd93b575cc25db604ecfd1b5b2d6195eca4951c3039c99c` | `56103e3c4fe5a230cbff319ce601d1616a98777b` |
| `packages/client/ui-sidebar/tests/pointer-scrollbars.client.spec.tsx` | `2807cdeaa3a719e9650b5ff5033ee82c147f146d130a3dcfb82df82d33690889` | `bf477d404f6a9290f0f7dd654d7b1592e87e83d9` |
| `packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` | `9e5a23e156d685e77c5cf8cdcc7eff091c12dc0720931322da31c38ad9be1939` | `79a75807f4bc044ebe3a650ca98b892a3927e1bb` |
| `packages/client/ui-trajectory/README.md` | `515057454d24d06ccd2572bbf1bcbfaf05ab5fbcfd8ade8a11cc1fcdb56bd99a` | `397bfb009adaab68d37d416f3e43caae080d327c` |
| `packages/client/ui-trajectory/README.zh.md` | `754e6a06b796cfe2216f97ec6b9036e7ea19fa79d57d40d9ceb5d54d8806902d` | `9ba224eabb5857e036b68a1c466adb0377fe0389` |
| `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx` | `2ed78fffa41383fa36c034dab61fd51a725829cd46bb6110be2930eb50fe49fb` | `4e81ac793a4accaae530fd6fb10cca2ef5e419b6` |
| `packages/client/ui-trajectory/src/client/TrajectoryToolbar.module.css` | `179f50eee011feb52b7e50591a9aa5e5b67f75c97a37cf8883fbfd39a8001a15` | `50cceec029eab42a88614830ad09d96f5fd7f52a` |
| `packages/client/ui-trajectory/src/client/TrajectoryToolbar.tsx` | `ab11d50851b510c0da008c7df4acbdd9ae7ca8a42503e64b08cc381587f8ed2b` | `370bd8ee078c953f00edbfe506fa14d291945bbb` |
| `packages/client/ui-trajectory/src/client/TrajectoryView.tsx` | `bbcb3cdff85f581be7faf192da1a0bbcfcfdc1c0086ee318e52a411145bc81b1` | `baa699da4400a2010ae2220837ee4be679b3d68a` |
| `packages/client/ui-trajectory/src/client/locales.ts` | `f2ece9e5f4784d81a4428c85dcfefe9f2a11ccc7abd0332c7a623895735457fa` | `4252f8f1a3457cc099908221787c8bf8fdeea1f4` |
| `packages/client/ui-trajectory/src/client/trajectory-virtual-rows.ts` | `40177483d5b37c28941df1f75a715a7fbe793bc12ecea518ec8642ce36811309` | `26d0cf36c58a05a150171df360fc76ba22378bb3` |
| `packages/client/ui-trajectory/tests/table.client.spec.tsx` | `91a134927a7bdba607cd0d73ecfe475364d8933fe171efbe120bbba3bb6e0f27` | `46d5d79235d1b4c02126506d4b8f955a413a3511` |
| `packages/client/ui-trajectory/tests/views.client.spec.tsx` | `f7473607230a8e14d8915bd1487ffd2b1474f3cc560ec1c77828f998bc4cda65` | `19b24125db7f6c9f9dcc2121f3f70315ab1076c0` |
