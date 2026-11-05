# M2 lifetime final independent review

## Verdict and limits

The requested current source repairs are supported by this independent review and the narrow direct Node checks below. No Required finding remains open in this inspected scope. One Required API consumer-fixture defect was found, escalated, repaired by root, and independently rerun successfully before this report. This is not broad M2, release, packaging, production, or complete documentation acceptance; root owns the final gate.

Review ran in `/Users/apple/deepseek-harness/.worktrees/p0-upstream-022-2026-11-04` on 2026-11-05. Only this report was written by this reviewer. Product source, tests, manifests, and pairing metadata were not edited. No Git, package manager, build, install, emit, generator, paid API, or subworker command ran. The three named reports were treated as claims to verify against source, not independent evidence of their reported test runs.

## Source findings and dispositions

| Subject | Current evidence | Disposition |
| --- | --- | --- |
| Exact Fiber eligibility | `vendor/cordis/src/fiber.ts:424-428` rejects null uid through assertActive and rejects UNLOADING separately; it does not require ACTIVE. Useful installers use the same two conditions immediately after awaited registration. Locations: agent-loop `src/index.ts:330`; todo :136; time :185; tmux :246; retry :146; subagent :328; Team :558; commerce tools :86; media :130; permission :280. | Correct for the specified handoff cancellation schedule. LOADING remains eligible. This does not establish safety against every possible synchronous reentrant callback in every installer. |
| Meaningful cleanup | AgentLoop retains factory ownership and transaction drain at :333-335; retry retains listener, abort, and active recovery ownership. Subagent descendant scopes remain distinct from projection references. | Keep. These are not redundant projection release effects. |
| Team foreign mounts | `tool-agent-team/src/index.ts:235-245` pushes each returned foreign disposer before checking interruption. :536-542 reverses rollback and only suppresses its local interruption identity. :564-568 establishes aggregate cleanup before listeners/current Agent installation. :570-580 reserves in-progress Agent ids and disposes instead of publishing when owner unloading interrupts installation. | Correct for inspected synchronous registration/disposal behavior. Ordinary install errors still propagate. Existing Agent scope remains live while plugin tools/policy disappear; the two tests at `tests/tool-team.spec.ts:530` exercise registrations 1 and 10. |
| Team root projection ownership | `agent-team/src/index.ts:177-187` opens an early effect but registers through root; runtime drain precedes explicit handle release in finally. | Explicit cross-owner release is necessary and preserved. Do not replace it with owner-local automatic cleanup. Source inspected; no new isolated Team root-reference test run claimed. |
| API attachment ownership | `session-controller/src/list.ts:104-137` owns metadata publication/removal in an early effect. Attachment child owns explicit release of the image handle registered through outer ctx. | Correct distinct ownership; keep child release and metadata map cleanup. Projection API tests passed, without claiming every attachment removal race is exercised. |
| Desktop media seam registration | `desktop-media/src/index.ts:96` declares five required dependencies for normal plugin mounting. :125-131 awaits the projection obtained through optionalHostSeam, checks the actual plugin Fiber, then binds the handle. Prompt/tools/recovery publication follows. `src/service.ts:112-114` uses ctx.get then root.get; tools separately tolerate a missing direct-apply seam. | Correct inspected readiness/cancellation repair. Direct apply can omit seams; that test does not establish that Loader mounting without the five declared dependencies works. Other runtime seams remain optional. |
| Permission seeding | `permission-presets/src/index.ts:272-283` awaits registration, checks both eligibility conditions, retains handle, then seeds existing Sessions. | Correct for disposal/unloading between handle readiness and continuation. Seeding is a durable mutation, not cleanup. The cancellation suite checks zero appended events. |
| ClaudeCodeMods cancellation ordering | `claude-code-mods/src/index.ts:233-237` cancels on its own Fiber's UNLOADING event using uid identity; detached controller exists before subscription. Cordis `fiber.ts:589-592,712-721` publishes status while provider teardown waits for dependent fibers. Later effect at :281-290 still cancels, disposes surfaces/registrations, awaits engine.dispose, and drains detached work. | Early cancellation breaks the dependent-mod wait cycle without removing awaited cleanup. Bridge test :915-931 waits until the 60000ms callback has actually started and asserts cancellation, disposal under 5000ms, and DISPOSED. Full bridge file passed. |
| ClaudeCodeMods optional agents access | `src/host-ops.ts:390-395` resolves ctx.get('agents') and emits the precise missing-service diagnostic before turnBoundaryOf. | Appropriate optional service access; no silent replacement value. Source checked; this review did not independently rerun host-ops.spec. |
| pi-ai config hook identity | `llm-pi-ai/src/index.ts:177-188` uses callback Fiber uid, delegates through next, and validates only the matching owner. Cordis `fiber.ts:678` supplies the candidate Fiber as the first waterfall parameter; `events.ts:156-159` resolves schema downstream. | Correct identity and waterfall behavior. Dynamic-config tests retain rejection checks and raw/effective reference preservation and passed independently. |
| Preset registry retained handle initialization | `agent-preset-registry/src/index.ts:79-91` establishes the early effect before await, stores the awaited handle, and reads it through presetOf. Cordis asynchronous effect setup joins returned cleanup; no new post-await effect is created. | Correct inspected initialization and retained reading. Explicit release duplicates same-owner release but is safe and needs no extra rewrite. |
| API preset consumer | `session-controller/src/agent.ts:342-344` calls optional provider presetOf; absence maps to undefined. | Correct domain-owned read. A provider object must implement its declared API; adding a production fallback for an incomplete test double would hide the consumer migration defect. |
| Knowledge optional preset owner | `desktop-ask-knowledge/src/index.ts:1131-1133` reads optional agentPresets.presetOf; prompt at :210-213 suppresses knowledge instructions for data-agent only when a binding exists. Its own projection uses the early effect at :255-260. | Correct optional provider behavior; own library binding remains usable when agentPresets is absent. Provider-surface suite passed, including its synthetic preset-owner case. |
| Commerce provider super initialization | `commerce-mode/src/provider/index.ts:108-123` awaits superclass init before directory/sqlite setup; `host/commerce/src/index.ts:231-234` awaits the retained binding handle. | Correct missing-initialization repair. Provider tests passed; no packaging or real merchant data claim. |
| Retained AgentModel replacement | `core/agent/tests/model-selection.spec.ts:129-148` releases the original handle, installs a newer same-key registration with an incompatible route, then checks current/origin before and after a header while replacement state stays unchanged. Production `agent-loop/src/index.ts:535-536` passes readerFor callbacks to ReactLoopAgent; `agent-loop/src/agent.ts:150` passes that callback to AgentModel. Projection `src/index.ts:438-442` captures the original registration through the retained handle. | Strong direct AgentModel regression check; passed. Its Agent object is a fixture and does not itself run a live ReactLoopAgent through replacement. Production wiring is supported by source inspection, not that stronger runtime scenario. |

## Required findings

R1 — API preset consumer fixture migration, **closed after root repair and independent rerun**. The initially reviewed `packages/api/session-controller/tests/session-presets.host.spec.ts:29-48` roster returned only defaultId, resolve, and mount. API `agent.ts:343` now requires presetOf(session), so the initial direct run produced four failures: requested creation, conflicting adoption, log-selected adoption, and unchanged adoption; the conflict case returned gateway/internal instead of agent-preset/conflict. Root changed only its fixture arrangement to await the real projection and expose a retained state reader through presetOf; the original eight tests then passed independently. No production optional-method fallback was introduced. Initial fixture SHA-256 was `f1bc06103a998c504c684bdd3fbf9bf16d56aa27dfce3141afead4e4ce33c1eb`; final hash is in the inventory.

No other Required defect was established by the inspected source and narrow checks. Existing worker notes about final noEmit, broader checks, bilingual pair recording, snapshots, and packaging remain root gate work; this reviewer did not verify their completion.

## Suggestions and evidence gaps

- Add a live ReactLoopAgent replacement scenario if root needs end-to-end proof beyond the direct AgentModel fixture plus source wiring. The existing test precisely proves retained AgentModel behavior, not a fully running/disposed Agent lifecycle.
- Add explicit presetOf reads after preset-provider release and same-key replacement if that retained public method needs its own regression proof. Current registry tests exercise ordinary logged selection, while retention is established here from the shared handle implementation.
- Keep desktop-media direct-apply optionality distinct from Loader injection requirements in test naming/docs. The absent-seam direct apply test bypasses the exported required inject list; it is not evidence of a mount with missing required providers.

These are suggestions, not demonstrated current product failures.

## Independent test evidence

All runs used installed direct Node Vitest, existing tests unchanged by this reviewer, and local fixtures/mocked providers. Vite printed its existing tsconfig-paths advisory. No skip or timeout was added.

Run A, exit 0: **8 files / 135 tests passed**, duration 5.43s.

```sh
node node_modules/vitest/vitest.mjs run packages/core/agent-loop/tests/projection-activation-lifetime.spec.ts packages/experimental/tool-agent-team/tests/tool-team.spec.ts packages/core/agent/tests/model-selection.spec.ts packages/llm/llm-pi-ai/tests/dynamic-config.spec.ts packages/experimental/claude-code-mods/tests/bridge.spec.ts packages/preset/agent-preset-registry/tests/registry.spec.ts packages/experimental/desktop-ask-knowledge/tests/provider-surface.spec.ts packages/experimental/desktop-media/tests/apply.spec.ts --maxWorkers=2
```

Run B before root's fixture repair, exit 1: **1 failed / 3 passed files; 4 failed / 57 passed tests**, duration 2.24s. All failures were R1 in session-presets.host.spec.ts; the three other files passed.

```sh
node node_modules/vitest/vitest.mjs run packages/experimental/commerce-mode/tests/provider.spec.ts packages/api/session-controller/tests/session-presets.host.spec.ts packages/api/session-controller/tests/session-projections.host.spec.ts packages/session/session-projection/tests/registration-reader.spec.ts --maxWorkers=2
```

Run C after inspecting root's fixture repair, exit 0: **1 file / 8 tests passed**, duration 2.45s. This rerun was justified by the changed fixture and closes R1.

```sh
node node_modules/vitest/vitest.mjs run packages/api/session-controller/tests/session-presets.host.spec.ts --maxWorkers=1
```

## Reviewed SHA-256 inventory

These are exact reviewed file contents, not Git revisions or a claim to freeze concurrent workers. The source/input inventory was hashed after inspection and checked unchanged before report creation; the preset fixture was rehashed after root's repair and independent rerun. Any later change requires checking its new hash and affected conclusions. Additional passing test files from Run B are included.

| File | SHA-256 |
| --- | --- |
| `vendor/cordis/src/fiber.ts` | `b64c3a97f15f0381479dcf3d25965e56dc4cecfa4a0881fc055a49f65b9945df` |
| `vendor/cordis/src/events.ts` | `a464c843822da4eb31a8d998c5e2216a817b8a7dfeacb6e1aab7f830e7320d6b` |
| `packages/core/agent-loop/src/index.ts` | `de3cf57fa2640c64e59a3d3caa671a7e9d2ecf84fcd1eda663a6ff983e272ed4` |
| `packages/core/agent-loop/src/agent.ts` | `95495fa8a0acd9f6faad04c01860176292177856235c45f25cb9661a406709f9` |
| `packages/core/agent/src/model-selection.ts` | `3c7c617b759ba5d46af44f9ea589e1d5931a02e4f0a9443c671ce368b022f8d1` |
| `packages/session/session-projection/src/index.ts` | `d82d1fc1f92893d97c9ec729039e7d77fbccb8a7c005a70cfe61c7924c590525` |
| `packages/todo/tool-todo/src/index.ts` | `74bcf496483459495dd8b75d6a3f5394993157b4f5ee92b95200ef4732f05ff2` |
| `packages/context/time-context/src/index.ts` | `9c65f44880b45e6ddc143f1a8625c1832ab3434380c70f180df59c048e6a1477` |
| `packages/context/tmux-context/src/index.ts` | `873efa6df744322c9860cae388dfc845e3a7c76bbd54c500ff8db12c78993971` |
| `packages/llm/llm-retry/src/index.ts` | `c6828732956434689c7ea3970342f1fa39ac9c6a81cd6a287841710f6609b1df` |
| `packages/subagent/tool-subagent/src/index.ts` | `6883d571945d4af016ca169c58327974569ff0576b50a6d64fb4745a850ab9c9` |
| `packages/experimental/tool-agent-team/src/index.ts` | `5476618b5fb63be2b0516606110fdcff8e4bc57f87b5ed179489d668bdc9cbc8` |
| `packages/experimental/agent-team/src/index.ts` | `301168a05a463ed92e5d302bc4f3def8dc655fb5bf99ce3c1d66fe51561f9b3c` |
| `packages/experimental/desktop-media/src/index.ts` | `e2b3321777cbe1be796ea6e8fc9c11bebe3df352f12f204370d2050250851542` |
| `packages/experimental/desktop-media/src/service.ts` | `66e478f0d74f361e65ee4014132f5f2c2f4ac2b157809bee7a6ca34da5558141` |
| `packages/experimental/desktop-media/src/tools.ts` | `43bd1e53dd3ae39fa9eb60b2c23d617611ea11bfab5136ab8122b2cc0b5959af` |
| `packages/interaction/permission-presets/src/index.ts` | `a4221fcbaec495f1c839dc5ef5868097732d9ec9ccebcb283b791a2bfd041a01` |
| `packages/experimental/claude-code-mods/src/index.ts` | `c5bd0fb1dd462e05e6353b6eafaa5dca9317a8b74eee358fb11d638bb974c625` |
| `packages/experimental/claude-code-mods/src/host-ops.ts` | `e0b7fd5700c57746ce75ba8994cfd2ca2020c391c401586b64feadb13ae5ce71` |
| `packages/llm/llm-pi-ai/src/index.ts` | `b13ddae048ea3555c37c6313035a23e4567b0693c5f7b7adb3387190e4cefcf6` |
| `packages/preset/agent-preset-registry/src/index.ts` | `7317e4a5228cbfbcaa1ae9ee8f26e79c6991b298b7aa7df5a10bb53ab0c67887` |
| `packages/api/session-controller/src/agent.ts` | `d772cdd61a6ed2e9f45e4bd3b1e398b89affcd66067aae579d18174552c63b0d` |
| `packages/api/session-controller/src/list.ts` | `a056527e5b0bc1ab5896beb46ed5b83f60f330e4f48bf1972d0c2cbb6dfd9890` |
| `packages/experimental/desktop-ask-knowledge/src/index.ts` | `27d2f63b41865ce70c2aef28a807879272192e524c8d34ee127ad0744d79f518` |
| `packages/host/commerce/src/index.ts` | `7b38f562cdcd9cdeaa71e547a2517e7b0a6129bfc231d1cf98dde8e4139b45b2` |
| `packages/experimental/commerce-mode/src/provider/index.ts` | `c83a3f1b762cc2177061c4667312c7bea2db5cf05076716a5468d98c086c51a5` |
| `packages/experimental/commerce-mode/src/tools/index.ts` | `9abdabd0e8c903638fa52a2232fcce58af193157033c9b65417d73ab4fa105e9` |
| `packages/core/agent-loop/tests/projection-activation-lifetime.spec.ts` | `a723b83f58db319b583398879ead22df3c3da9a652bc1fd94e68f76ac0badb6d` |
| `packages/experimental/tool-agent-team/tests/tool-team.spec.ts` | `ce645e72e08b88fd72e91e9b0ddd1cffeceea7b2c29536d497af226dd2f0126c` |
| `packages/core/agent/tests/model-selection.spec.ts` | `a6ba551aab86c2bccde8aa560e8fa30c788c76d9805bcae0a022b9e39bd31430` |
| `packages/llm/llm-pi-ai/tests/dynamic-config.spec.ts` | `a072096faa3774c0e38474410e79db6e3f9f4fc5ab1f91dd1ef120d121ec708d` |
| `packages/experimental/claude-code-mods/tests/bridge.spec.ts` | `7e02747eab06e94eb602218b34c2a11da7a7827c1b0f146098ea8ab49b8c4546` |
| `packages/preset/agent-preset-registry/tests/registry.spec.ts` | `997b4f813ad95d3c7e4da1aa24dbe04ec5c659f55ad712c514b2d20673dd2d4c` |
| `packages/experimental/desktop-ask-knowledge/tests/provider-surface.spec.ts` | `56de5bbd95dcd2a9d9be84073979f9bbe4c2db0b8f1d116929a8a67e41e0da63` |
| `packages/experimental/desktop-media/tests/apply.spec.ts` | `00d85d51b5fc80ad0c8f197b827c652f7dba826356e591479abb63de5b6e8b8c` |
| `.plans/rc1-execution/m2-useful-installer-lifetime-report.md` | `4955b9408ca83cb4e888dc91d742cbbd52b64cb53ce01755e9f2ac1a4020225a` |
| `.plans/rc1-execution/m2-projection-lifetime-independent-review.md` | `450d36b8239cec12e1b2f433361dc13c516f400d915022aab1674980a244bd36` |
| `.plans/rc1-execution/m2-provider-consumer-repair-report.md` | `a86a07a944832e1a7ee93f579d0b9c8eff9bc45b3223782ccdc56cc569c290ad` |
| `packages/api/session-controller/tests/session-presets.host.spec.ts` | `7e83186726bf423c888ba79951ec602e66ee8291e31a393669478fd88c7f1633` |
| `packages/api/session-controller/tests/session-projections.host.spec.ts` | `0b9da282d237b10d240544926be6b02b71672ad333383f611e5f9222e6ce999d` |
| `packages/session/session-projection/tests/registration-reader.spec.ts` | `83b97aaedc6352c8660c79b62e0b0efe4871a7fdad30562ab72767e093e3f1c9` |
| `packages/experimental/commerce-mode/tests/provider.spec.ts` | `5574cc2b31f494ee307e436e29caeaf3950709468da44213bd542ac3234421b9` |
