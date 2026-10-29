# Commerce Merchant Mode Implementation Plan

Mode: innovate
Space: commerce-merchant-mode (created at Phase 2 start; branch `feature/commerce-merchant-mode`)
Created: 2026-09-14T00:00:00+08:00
Revised: 2026-09-14 (round 4 suggestions integrated)
Architect: Cla
Plan Review:
- Round 1 (Dex, Reviewer): Correctness 4 / Simplicity 5 / Security 3 / Conformance 4 / overall 4.0 — FAIL.
- Round 2 (Dex, Reviewer): Correctness 5 / Simplicity 6 / Security 4 / Conformance 3 / overall 4.5 — FAIL.
- Round 3 (Dex, Reviewer): Correctness 6 / Simplicity 7 / Security 6 / Conformance 5 / overall 6.0 — FAIL. 3 required fixes and 3 suggestions integrated (see Review Integration).
- Round 4 (Dex, Reviewer): Correctness 8 / Simplicity 7 / Security 8 / Conformance 8 / overall 7.8 — PASS. No required fixes; 3 suggestions integrated. Review continued past three rounds at the user's request ("till passed").

> Dependency edges are advisory annotations; the executor currently follows strict file-order linear execution.

**Goal:** Fence the text blocks of designated third-party tool results at every in-process model-visible root result (native calls, `run_code` results, and child agents in the same composition), then add a merchant/operator commerce mode (preset, desktop and web 电商助手 chip) that analyzes imported store exports and stages listing, inventory, pricing, and campaign changes that leave only as an approved export file.

**Architecture:** Approach C from the approved design ([`.plans/commerce-merchant-mode/design.md`](../../.plans/commerce-merchant-mode/design.md)); its superseded clauses are listed in that document's "Superseded by Plan Review" section.
- `dsh-fence-policy` is a `tools/post-execute` listener plus a pure escaping library.
- Commerce has a release-group Service Definition, `packages/host/commerce` (`ctx.commerce`, `commerce/bound`), mirroring `packages/host/ask-data`.
- It also has one dual-face experimental package, `packages/experimental/commerce-mode`. That package holds the file Provider, the `./tools` Consumer (mounted by the `./preset` row under the `commerce` preset's standing scope, or as a root row in compositions without a preset roster), the preset installer and packaged preset, and the `./client` chip and tool cards. It reuses the spreadsheet decoder through a built export of `desktop-ask-data`.
- Session binding is one logged event; provenance and the staged-change ledger fold `tool/result.meta`; export approval runs inside the export tool body.
- No hand-written `core/*` or `agent-loop` change.

**Tech Stack:** TypeScript ESM Cordis plugins, `@deepseek-ai/schemastery` Config, `defineTool`, `ctx.sessionProjections`, `ctx.agentPresets`, `createScope` from `dsh-scope`, `ctx.approval`, `ctx.fs`, `ctx.sandboxPolicy`, `ctx.subprocess`, `ctx.systemPrompt.section`, Vitest, Loader composition specs, recorded-session snapshots (session, ACP, SDK, Web), host `sqlite3` ≥ 3.41.2, Tauri desktop pipeline.

**Reference:** `commerce-agents` reference repository (Apache-2.0, Python): `commerce-common/commerce_common/fencing.py`, `merchant-agent/core/merchant_agent/{gates,changes,analysis,config}.py`, `merchant-agent/skills/*/SKILL.md`, `docs/safety.md`. Ported as ideas and adapted skill text with attribution; no dependency.

## Global Constraints

- **Core packages.** No hand-written change to `packages/core/*`, `agent-loop`, the LLM seam, or core `SessionEventMap` members.
  - One exception, decided by the user on 2026-09-14: add `EXTERNAL_DATA: 700` to `SECTION_ORDERS` (`packages/core/system-prompt/src/index.ts:121`), so the release package `dsh-fence-policy` allocates its prompt order centrally like other release packages.
  - Commerce adds one declaration-merged event, `commerce/bound`, following `ask-data/bound` (`packages/host/ask-data/src/types.ts:18`).
  - `pnpm run gen-persistence-catalog` regenerates `packages/core/session/src/known-event-types.ts` and the persistence catalog to include it; that file already lists `ask-data/bound` (`known-event-types.ts:28`), and `verify-persistence-catalog` in `doc-sync` gates it.
  - Provenance and the ledger ride tool-owned `tool/result.meta` (`packages/core/session/src/types.ts:309-320`).
- **Official product packages.** No edit to official `apps/desktop`, `packages/bundle/desktop-app`, desktop-companion product logic, or the `standard` preset. `packages/api/session-controller` gains commerce remotes beside the fork's existing `ask-data.ts` and `ask-knowledge.ts`.
- **Experimental dependency rule.** Release packages, apps, and harness-resolved preset rows name no `packages/experimental/*` package (`packages/experimental/AGENTS.md`; preset bare names resolve from the harness base, `packages/preset/agent-presets/src/mount.ts:72-95`).
  - `apps/cli` gains only release packages (`dsh-fence-policy`, `dsh-host-commerce`).
  - A seeded desktop pin's `workspace:` dependencies resolve through the harness closure (`scripts/seed-desktop-profile-plugin.mjs:255-312`). Its experimental dependency `desktop-ask-data` is itself a pin in the same profile `node_modules`.
- **Configuration.** Every deployment-varying cap, column mapping, and tool-name list is a validated `Config` field. The fence label, escaping grammar, sqlite3 safety flags and probe, and CSV formula neutralization are fixed security invariants.
- **Side effects.** Nothing writes to a live store, sends a message, or moves money. Export writes one new file into the session workspace through `ctx.fs` under the session's resolved sandbox policy.
- **Fixtures and attribution.** Fixture store data is fictional. Skill text adapted from the reference carries Apache-2.0 attribution in the package `NOTICE`.
- **Docs, copy, and tests.** Client UI copy goes through typed locale dictionaries (`verify-client-ui-i18n`). READMEs ship en/zh/i18n triplets, and each PR carries an Agent Note triplet. Every product-visible plugin has a Loader composition spec (`packages/AGENTS.md`, REAL-composition rule).
- **Commits.** Commit messages follow repository history: `<type>(<scope>): <summary>`.

## Known pre-existing gate failures

The 2026-09-13 skill-evolution plan recorded that `pnpm run verify-translation-pairing` already exits 1 on this checkout (desktop bundle output, several `packages/experimental/*` README pairs, English-only `docs/plans/*`). This plan is English-only. Steps check that files they change add no pairing error; S3 re-runs the gate to confirm the baseline before relying on it.

## Design decisions

User decisions D1–D6 and approved proposals P1–P6 live in the design document; clauses changed by review are recorded there. Plan-level decisions:

| # | Decision | Evidence |
|---|---|---|
| PD1 | **Targeted structural escaping.** `sanitizeUntrusted` runs these steps in order, in one linear pass without normalization.<br>1. Remove invisible code points: U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+2066–U+2069, U+FEFF, U+FE00–U+FE0F, U+E0000–U+E007F, U+E0100–U+E01EF.<br>2. Replace C0/C1 controls, except tab, LF, and CR, with a space.<br>3. Escape a delimiter opener: `<`, or a code point whose NFKC form contains `<`, when the next code point is an ASCII letter, `!`, `?`, `\|`, or U+FF5C, or when up to 16 spaces or tabs and then `/` follow. `<` becomes `&lt;`; a confusable becomes a hexadecimal character reference.<br>4. Escape `&`, or a code point whose NFKC form contains `&`, only where it begins a character reference, as `&amp;` or a hexadecimal reference. A character reference is `#` and one or more digits, or `#x`/`#X` and one or more hex digits, in both cases with any leading zeros and with or without a closing `;`; a letter and up to 31 alphanumerics, then `;`; or the semicolon-less legacy names `lt`, `LT`, `amp`, `AMP`.<br>5. Escape the colon of a role marker as `&#x3A;` or `&#xFF1A;`. A role marker is up to 16 spaces or tabs, case-insensitive `system`, `user`, `assistant`, `human`, `developer`, or `tool`, up to 16 spaces or tabs, then an ASCII or full-width colon, at input start or after LF, CR, CRLF, U+2028, or U+2029.<br>Result: forged `</external-data>`, `<｜User｜>`, `<\|im_start\|>`, `&lt;/external-data&gt;`, `&#60;`, `&#X3C;`, `&#00000060;`, `&#60`, and `&lt` are neutralized. JavaScript `a && b`, `x < y`, `a <= b`, URL `?a=1&b=2`, shell `cmd < in > out 2>&1`, and Chinese punctuation stay byte-identical | `packages/context/session-reference/src/serialization.ts:3-12`; round 2 fix 3, round 3 fix 3 |
| PD2 | **Fence scope.** Label `external-data`. The notice is the stable system-prompt section `guard:external-data`. `Config.tools` in the base row covers `web_fetch`, `web_search`, `mcp__*`, the Ask Knowledge tools, and `run_code`. The listener fences root calls (no `exec.parent`) of every agent in the composition; untagged listeners receive descendant scope events (`packages/core/scope/src/index.ts:158-181`).<br>Out of scope, recorded under Known Limitations:<br>- values a PTC program forwards into tool arguments, including `subagent` prompts (`packages/subagent/tool-subagent/src/index.ts:508`);<br>- out-of-process children (SDK, ACP, Codex, and Claude subagent providers), which run their own composition;<br>- shell and file channels.<br>Every forwarding channel is model-authored data flow, and blocking one of them adds state without closing the class | Round 2 fix 1 (narrowing option) |
| PD3 | **Bound ownership.**<br>- Plain-text results: `dsh-spill-policy` bounds the complete fenced result (`packages/spill/spill-policy/src/index.ts:190-209`), and its spill file keeps the escaped text.<br>- Results containing a non-text block, which spill-policy leaves untouched (`index.ts:20-22`): fence-policy enforces `Config.maxMixedTextBytes` on the UTF-8 bytes of all emitted text blocks, wrappers, and the truncation suffix. It truncates at a code point boundary outside any escape sequence. When the cap cannot hold one wrapper plus the suffix, it drops every text block and keeps the non-text blocks.<br>- Commerce renders apply their `Config` caps to the complete rendered text | `packages/AGENTS.md` complete-result bounds; round 2 fix 2, round 3 suggestion 3 |
| PD4 | **Commerce tools are root-only and native.** Presentation meta exists only for root calls (`packages/core/tools/src/index.ts:1797`). Every commerce tool body returns a held result when `exec.parent` is set, and the commerce preset pins `mode: native` in its `tool-presentation` row (nearest scope wins, `index.ts:892-902`) | Round 1 fix 1 |
| PD5 | **Session binding is one logged event.** `Commerce.bind(agent, sourceId)` is the only writer of `commerce/bound`: it refuses an already-bound session, verifies the source through the provider, then appends.<br>- Consumers: the session-controller commit remote (desktop, web) and, for an unbound session, `commerce_import_file` / `commerce_load_sample` (CLI, headless, snapshots).<br>- For a bound session those tools import into the bound source without calling `bind`; no tool argument names a source id.<br>- Re-importing a kind replaces that table, and export re-verifies each staged `before` value.<br>- The event is required-on-read like `ask-data/bound` | `packages/host/ask-data/src/index.ts:134-180`, `packages/api/session-controller/src/ask-data.ts:222` |
| PD6 | **Projection.** One `commerceSession` projection folds `commerce/bound`, root commerce `tool/call` names, and `tool/result.meta` into binding, provenance, and ledger. `Config.maxStagedChanges` bounds the ledger; `Config.maxMetaBytes` bounds each result's meta | `packages/todo/tool-todo/src/index.ts:122` |
| PD7 | **Analysis execution is the enforcement.**<br>- **Load gate:** `sqlite3 -version` ≥ 3.41.2, plus three probe spawns of `sqlite3 -safe -batch :memory:` running `readfile()`, `writefile()`, and `ATTACH` respectively. Each probe must exit nonzero with stderr naming its own function or statement. Otherwise the provider fails to load with a named diagnostic.<br>- **Query run:** `sqlite3 -safe -readonly -nofollow -batch -bail -json <db> <sql>` through `ctx.subprocess`, wrapped as `SELECT * FROM (<query>) LIMIT <maxRows+1>`. Stdout is streamed under a byte cap that aborts the child, and a timeout kills the process tree.<br>- **Database path:** must realpath inside `<profile home>/commerce-sources/` and be a regular file.<br>- **Lexical check:** one `SELECT`/`WITH`, no comments, nothing after the statement, no `ATTACH`/`PRAGMA`/write keywords. It only produces the model-facing diagnostic | 3.41.2 extended `--safe` to dangerous SQL functions. Host 3.51.0 refuses `readfile`, `writefile`, `ATTACH`, and a symlinked database; round 3 suggestion 2 |
| PD8 | **Export order.** `commerce_export_changes.execute` runs:<br>1. Root-only and binding gates.<br>2. Ledger membership, not exported, not discarded.<br>3. Provider `before` values unchanged.<br>4. Guardrails against the config in force.<br>5. Build the final success value (`path`, `changeIds`, `rowCount`, per-change rows). Run the tool's own `output.render` and `presentationMeta` over it and check `maxMetaBytes`; the registry later calls the same pure functions over the same value (`packages/core/tools/src/index.ts:1783-1805`).<br>6. Resolve `ctx.sandboxPolicy.resolve({ session: exec.agent.session })`. Hold when the mode is `read-only` or the target is outside its writable roots.<br>7. `ctx.approval.request({ agent, toolName, callId, reason, signal })`.<br>8. Write with the step 6 policy (PD9).<br>9. Return the prevalidated value.<br>Every non-`allowed-once` outcome and every failed step returns a small constant held value. `rejected` under effective policy `never` (`approval.overrideOf(session) ?? approval.config.policy ?? 'ask'`; `overrideOf` at `packages/interaction/user-approval/src/index.ts:244`, the same derivation as `packages/interaction/permission-presets/src/index.ts:314`) returns the switch-to-`workspace-write` message | Pre-execute denial is an error result (`index.ts:1477-1488`); round 3 suggestion 1 |
| PD9 | **Export write.** `ctx.fs.writeText(target, csv, { kind: 'createIfAbsent' }, signal, sessionPolicy)` receives the PD8 step 6 policy, so enforcement stays at the write. `fs-sandbox` otherwise resolves without the session (`packages/fs/fs-sandbox/src/index.ts:122`); `terminal-bash` is the precedent (`packages/terminal/terminal-bash/src/index.ts:194`).<br>- **Target:** `commerce-exports/<first 16 hex of SHA-256 of sorted change ids>.csv` under the session workspace, never from model arguments.<br>- **Existing file:** held with "these changes may already be exported".<br>- **Cells:** text cells starting with `=`, `+`, `-`, `@`, tab, or CR get a leading `'`.<br>- **Service:** has no filesystem-writing method; `renderExport` crosses the Provider/Consumer package boundary | `packages/fs/fs/src/index.ts:261`, `types.ts:123` |
| PD10 | **Import read containment.** `commerce_import_file` resolves `path` against the session workspace from the session-resolved policy, requires `ctx.fs.contains(workspaceRoot, target)` on the realpathed target, and reads with `readBytes` under the decoder's byte cap. `fs-sandbox` does not fence reads | Round 2 suggestion 3 |
| PD11 | **Package topology and dependency closure.**<br>- `packages/host/commerce` (`@deepseek-ai/dsh-host-commerce`, release group like `host/ask-data`): Service Definition, `./types`, and `./client` remote types. Consumed by session-controller and `commerce-mode`, and listed in `apps/cli` (as `apps/cli/package.json:85` lists `dsh-host-ask-data`).<br>- `packages/experimental/commerce-mode`: Provider, `./tools` Consumer, installer, preset, and `./client`. Provider and Consumer share one package until a second provider exists; `desktop-ask-data` is the precedent.<br>- Decoder: `desktop-ask-data` gains a built `./spreadsheet` export, which resolves from the same profile where both are pinned | Round 2 fix 6 |
| PD12 | **Preset installation and tool mounting.**<br>- **Install:** the `./preset` row (`@deepseek-ai/dsh-experimental-commerce-mode/preset`) copies its packaged `preset/commerce/` into `$DSH_HOME/.agent-presets/commerce/` only when absent and never overwrites an existing directory (data-agent's rule, installed `@yejiming/dsh-data-agent/lib/index.js:505-529`, without legacy migration). The preset holds `agent.cordis.yml`, `preset.yml`, and `skills/`.<br>- **Preset rows:** the packaged `agent.cordis.yml` names only release packages (persona section, `tool-presentation` with `mode: native`, `skill-filesystem` with `customSkillDirs` for the installed `skills/`), never a commerce package.<br>- **Tool mounting:** after install, the `./preset` row calls `ctx.agentPresets.standingKeyFor('commerce')` (`packages/preset/agent-presets/src/index.ts:760`). It then mints `createScope(ctx, key)` (`packages/core/scope/src/index.ts:137`) and loads the statically imported `./tools` plugin through that scope's context. Its registrations are visible only to agents on the `commerce` preset, and disposing the `./preset` row disposes the scope. Automation bundles (headless, SDK, ACP) compose no roster and create agents that read the global layer (`packages/bundle/headless/src/index.ts:179`), and Cordis `inject` has no optional form, so those compositions mount `./tools` as a root row and never add `./preset`; tool platform ids come from `ctx.commerce.platforms()` This mirrors data-agent's `mountPresetCapabilities` (installed `lib/index.js:571-590`), using the exported `createScope` instead of reading the scope tag by reflection.<br>- **Failure:** logs an error naming the manual step; the commit remote fails with `session/commerce-preset-unavailable` when the preset cannot be selected | Preset bare names resolve from the harness base (`packages/preset/agent-presets/src/mount.ts:72-95`); round 3 fix 1 |
| PD13 | **Mounting.**<br>- **Desktop:** pin `commerce-mode` in `scripts/desktop-profile-plugins.json`.<br>- **Web and CLI profiles run from the source checkout:** `dsh plugin --profile <name> add link:<checkout>/packages/experimental/commerce-mode`. `anchorPathSpec` keeps `link:` specs (`apps/cli/src/plugin.ts:93-111`), reconciliation adds the package to `dsh.profile.bundles` (`plugin.ts:48-89`), the profile loader applies its `dsh.bundle.patch` (`packages/boot/app-boot/src/profile.ts:822`), and the web client discovers `dsh.client`.<br>- **Snapshots:** scenario patches mount the same row.<br>Published-package installation is a non-goal while the package is experimental | Round 2 fix 7 |
| PD14 | Stage, discard, and export tools omit `isConcurrencySafe`, so the registry runs them exclusively | `packages/core/tools/src/index.ts:1260-1270` |
| PD15 | Staged `before` values come from provider records at staging time, never from model arguments | Reference "no grounded current price" guardrail |

## File Structure

```
packages/guard/fence-policy/                   @deepseek-ai/dsh-fence-policy
  src/escape.ts                                sanitizeUntrusted, fenceText, truncateFenced, FENCE_LABEL, ESCAPED_CODE_POINTS
  src/index.ts                                 tools/post-execute listener + guard:external-data section
  tests/{escape,policy,composition}.spec.ts
packages/host/commerce/                        @deepseek-ai/dsh-host-commerce       (Service Definition, commerce/bound, ./types, ./client)
packages/core/session/src/known-event-types.ts regenerated (commerce/bound)
packages/experimental/desktop-ask-data/        + built ./spreadsheet export
packages/experimental/commerce-mode/           @deepseek-ai/dsh-experimental-commerce-mode
  src/provider/                                file Provider: import, analysis runner, sqlite3 probe, renderExport
  src/tools/                                   ./tools Consumer: import, read, stage, export tools, projection, gates
  src/install.ts                               preset installer + standing-scope tool mount
  src/client/                                  ./client: 电商助手 chip page, tool cards
  preset/commerce/                             agent.cordis.yml (release rows only), preset.yml, skills/
  cordis.patch.yml                             Host row (Provider + installer + tool mount)
packages/api/session-controller/src/commerce.ts + shared commit transaction extracted from ask-data.ts
packages/bundle/base/cordis.patch.yml          fence-policy row
apps/cli/tests/profile-link-bundle.spec.ts     link: bundle mounting
scripts/desktop-profile-plugins.json           commerce-mode row
snapshots/session/{external-data-poisoned,external-data-benign,external-data-ptc-poisoned,commerce-sales-analysis}/
snapshots/sdk/commerce-load-sample/
snapshots/acp/{commerce-export-approved,commerce-export-rejected,commerce-poisoned-review}/
snapshots/web/commerce-export-card/            borrows snapshots/acp/commerce-export-approved
.agents/notes/implemented/feature/             one Agent Note triplet per PR
```

## Steps

### PR1 — fence policy

- [x] S1: Create `packages/guard/fence-policy/src/escape.ts` per PD1, plus `fenceText(text)` returning `<external-data>\n…\n</external-data>` and `truncateFenced(blocks, maxBytes)` per PD3.

  Tests:
  - **Neutralization:** zero-width and tag-character instructions; forged closing markers in ASCII, full-width, mixed case, with spaces before `/`, split by zero-width characters, and repeated or nested; the `&lt;/external-data&gt;`, `&#60;`, `&#x3C;`, and `&#X3C;` spellings, in ASCII and with a full-width ampersand; role markers at input start and after LF, CR, CRLF, U+2028, and U+2029, in upper case and with a full-width colon; `<｜tool▁calls▁begin｜>` and `<|im_start|>`.
  - **Completeness:** enumerate every code point and assert `ESCAPED_CODE_POINTS` equals the set whose NFKC form contains `<` or `&`.
  - **Fidelity:** JavaScript `&&`, comparisons, URL query strings, shell redirections, HTML-free Markdown, and Chinese `，（）：` are byte-identical; `&amp;` becomes `&amp;amp;` and `<div>` becomes `&lt;div>`.
  - **Truncation:** tiny, exact, and one-over limits; a limit below one wrapper plus suffix (text blocks dropped, non-text blocks kept); an oversized single block; multibyte text; no cut inside an escape sequence.
  - **Performance:** 1 MB adversarial inputs finish within a fixed time budget, with output at most 8× the input.

  (verification: `pnpm vitest run packages/guard/fence-policy/tests/escape.spec.ts`)
- [x] S2: Add the plugin in `src/index.ts`.
  - **Config:** `Config { tools: string[] (glob patterns, required), maxMixedTextBytes: number (required) }`.
  - **Listener:** a `tools/post-execute` listener without `prepend`. For a matching call with no `exec.parent`, each text block becomes `fenceText(sanitizeUntrusted(text))`, and results containing a non-text block are bounded by `truncateFenced`. Image blocks, `value` replacements, and `block` decisions pass through.
  - **Section:** the stable `guard:external-data` system-prompt section, placed at `ctx.systemPrompt.getSectionOrder('EXTERNAL_DATA')`.
  - **README triplet:** Model Experience, KV-cache effect, and `## Known Limitations and Deferred Work` stating the PD2 out-of-scope channels. `./invariant` is omitted, with the reason recorded.
  - **Unit tests:** a matching call is wrapped; a non-matching call is untouched; a parented call is untouched; a mixed text and image result is capped at exact and one-over bytes; HMR disposal removes the listener and section.
  - **Loader composition spec** (`tests/composition.spec.ts`): boots a test-only `cordis.yml` with the tool registry, spill-policy, fence-policy, tool-web over a mocked HTTP fetch provider, an in-process subagent provider, and a mock LLM. It asserts the durable `tool/result` content for a native root call, a same-composition child agent's direct call, a spilled oversized plain-text result (the preview starts with the open marker, the content stays escaped, and retrieval guidance is present), and an oversized mixed result.

  (verification: `pnpm vitest run packages/guard/fence-policy`) (blocked-by: S1)
- [x] S3: Wire the row into `packages/bundle/base/cordis.patch.yml` after `spill-policy` with `tools: [web_fetch, web_search, 'mcp__*', ask_knowledge_retrieve, ask_knowledge_lookup, run_code]` and `maxMixedTextBytes` equal to the row's spill `maxInlineBytes`.
  - **Dependencies:** add the package to the base bundle and to `apps/cli` dependencies.
  - **Web tools:** remove the `EXTERNAL_WEB_CONTENT_NOTICE` prefix (`packages/web/tool-web/src/trust.ts:7` and its uses in `fetch.ts` and `search.ts`). Keep the untrusted-data sentences in the web tool descriptions (`fetch.ts:451`, `search.ts:319-320`). Update tool-web tests and README.
  - **Generated docs:** regenerate the config catalog and confirm the translation-pairing baseline.
  - **Snapshots:** re-record every snapshot whose web, MCP, or `run_code` result bytes change, and review each diff.

  (verification: `pnpm vitest run packages/web/tool-web packages/guard/fence-policy && pnpm run typecheck && pnpm run test:snapshot && pnpm run doc-sync`) (blocked-by: S2)
- [x] S4: Add recorded-session snapshots under `snapshots/session/`:
  - `external-data-poisoned` (native preset): a fetched page carries a zero-width instruction, a forged closing marker, and a line-start `system:` asking for a bash deletion. Expected: no bash call, and the model reports the content.
  - `external-data-benign`: the page without the payload contains a JavaScript `&&` sample, a URL with a query string, comparisons, and a shell redirection. It is summarized, and the recorded fenced text keeps those spans byte-identical.
  - `external-data-ptc-poisoned` (ptc preset): the program fetches the poisoned page and prints it; the fenced `run_code` result leads to no destructive call.

  (verification: `pnpm run test:snapshot -t external-data`) (blocked-by: S3)
- [x] S5: Agent Note `architecture/2026-09-14-external-tool-result-fence-policy` triplet covering the problem, the decision, and the rejected alternatives:
  - a blacklist sanitizer;
  - NFKC output normalization;
  - escaping every `&` and `<`;
  - per-tool notices;
  - a core ToolDefinition trust flag;
  - a fence-owned cap on plain-text results versus spill ownership;
  - rewriting parented PTC values or blocking forwarding into `subagent`.

  (verification: `pnpm run verify-translation-pairing --write .agents/notes/implemented/feature/2026-09-14-fence-policy-external-data.md && pnpm run test:docs`) (blocked-by: S4)

### PR2 — commerce seam, provider, binding, read-only analysis

- [x] S6: Create `packages/host/commerce` (release group, following `packages/host/ask-data`).
  - **Service:** `abstract class Commerce extends Service` on `ctx.commerce`, with branded `CommerceSourceId`, `ListingId`, and `ChangeId`.
  - **Methods:**
    - `listSources`, `importSpreadsheet({ sourceId?, kind, platform, filename, bytes })`, and `importSample`;
    - a concrete `bind(agent, sourceId)` per PD5, over an abstract `describeSource`;
    - the reads `searchListings`, `getListing`, `salesSummary`, `inventoryHealth`, `analysisSchema`, and `runAnalysisQuery`, each taking `sourceId`;
    - `renderExport(changes, platform)` returning CSV text.
  - **Types:** `./types` declares `CommerceBinding`, the `commerce/bound` event (JSDoc with `@param`; the persistence catalog generator rejects `@mode` on log events), and the `commerceBinding` projection keys. `./client` holds the remote request and response types.
  - **Generated files:** run `pnpm run gen-persistence-catalog` so `packages/core/session/src/known-event-types.ts` and the persistence catalog include `commerce/bound`.
  - **Docs:** JSDoc for every parameter and return; README triplet; `packages/host/README` triplet entry.
  - **Tests:** `bind` appends exactly one event, refuses a second bind, and appends nothing for a missing source.

  (verification: `pnpm vitest run packages/host/commerce && pnpm run typecheck && pnpm run lint && pnpm run verify-persistence-catalog`)
- [x] S7: Give `packages/experimental/desktop-ask-data` a built `./spreadsheet` export (`import-spreadsheet`, `limits`, `zip-scan`, `sqlite-write`) with a tsdown entry and a `files` entry, keeping the `./src/*` export that 249 of 261 packages carry by convention. The barrel exports only the decoder surface a second consumer needs; `src/sources.ts` may import through it when that keeps the import graph acyclic. Existing tests stay green, and a NodeNext consumer check covers the new export. (verification: `pnpm vitest run packages/experimental/desktop-ask-data && pnpm run build && pnpm run hygiene`)
- [x] S8: Create `packages/experimental/commerce-mode` with the Host face `src/provider/` and `src/install.ts`.
  - **Provider import:** imports into `<profile home>/commerce-sources/<sourceId>.sqlite` with fixed `orders`, `products`, and `inventory` tables through `desktop-ask-data/spreadsheet`. Column mappings come from `Config.platforms`, with shipped defaults for Taobao, Pinduoduo, Douyin Shop, and Youzan in `cordis.patch.yml`. A fictional sample shop ships with the package.
  - **Analysis and export:** analysis runs per PD7; CSV rendering applies PD9 neutralization.
  - **Installer:** per PD12. The packaged `agent.cordis.yml` contains release-package rows only.
  - **Tests:**
    - Import: each platform mapping; malformed sheet warnings; every lexical refusal class.
    - Execution denials through the provider: `readfile`, `writefile`, `load_extension`, `ATTACH`, a symlinked database, a database outside the root, oversized output, and a timeout that kills the child.
    - A should-serve query.
    - Load failure on a stubbed `sqlite3` reporting 3.41.1, and, parameterized over `readfile`, `writefile`, and `ATTACH`, on one reporting 3.51.0 whose probe for that statement exits zero while the other two refuse.
    - Installer: creates an absent preset and leaves an edited one byte-identical; the packaged composition names no `@deepseek-ai/dsh-experimental-*` package.
    - Formula-leading CSV cells.

  (verification: `pnpm vitest run packages/experimental/commerce-mode/tests/provider packages/experimental/commerce-mode/tests/install`) (blocked-by: S6, S7)
- [x] S9: Add the `commerce-mode` `./tools` Consumer, mounted per PD12 under the `commerce` standing scope by the `./preset` row, or as a root row in a composition without a preset roster.
  - **Import tools:** `commerce_import_file({ path, kind, platform })` per PD10, and `commerce_load_sample`, both following PD5's unbound and bound paths.
  - **Read tools:** `commerce_search_listings`, `commerce_get_listing`, `commerce_sales_summary`, `commerce_inventory_health`, and `commerce_analysis_query`.
  - **Every tool body:** enforces PD4 and resolves the binding from the projection; an unbound read is held with the import step. Renders go through `fenceText` under `Config` caps on the complete text. `meta` records returned listing ids and full-listing reads within `maxMetaBytes`.
  - **Projection:** register the PD6 projection.
  - **Unit tests:** a replayed fold equals the live fold; unknown tools are ignored; a parented call is held; an unbound read is held beside its should-serve bound read; the fence is applied; meta is capped; a bound-session import calls no `bind` and replaces the table; import paths using `..`, an absolute outside path, or a symlink escape are refused.
  - **Loader composition spec:** boots the Host row with a mock LLM and the agent-presets roster.
    - An agent on the `commerce` preset sees the commerce tools; an agent on `standard` in the same host does not.
    - Disposing the Host row removes them.
    - Load sample → `commerce/bound` → analysis query → reopen the session from its log: binding and provenance are equal.

  (verification: `pnpm vitest run packages/experimental/commerce-mode`) (blocked-by: S1, S8)
- [x] S10: Skill `commerce-sales-analysis`, adapted from the reference `performance-insights`, under `preset/commerce/skills/`.
  - **Session snapshot** `snapshots/session/commerce-sales-analysis`: a workspace seed with fictional CSV exports and a scenario patch mounting the `commerce-mode` Provider and a root `./tools` row, with the skill seeded by a workspace setup. The model imports and answers from a SELECT-only query.
  - **SDK snapshot** `snapshots/sdk/commerce-load-sample`: `sdk` profile on the `commerce` composition owned by the session scenario, with its own `commerce-sdk` header pin. The model calls `commerce_load_sample`, so the recorded session and TypeScript SDK expected output include `commerce/bound`.
  - **Python SDK projection:** unchanged. Its `minimal`, `advanced`, and `restart` scenarios run the `sdk-minimal` runtime, which composes release packages only (`python/development.md:37`) and cannot mount the experimental provider, the only producer of the event. Required Python-runtime CI confirms they pass unchanged before merge.
  - **Agent Note** triplet covering the seam, the binding event, the preset-scoped tool mount, sqlite3 hardening, and the decoder export.

  (verification: `pnpm run test:snapshot -t commerce-sales-analysis && pnpm run test:snapshot -t commerce-load-sample && pnpm run test:snapshot snapshots/sdk && pnpm run test:docs`) (blocked-by: S9)

### PR3 — staging, guardrails, export approval

- [x] S11: Stage tools `commerce_stage_listing_update`, `commerce_stage_price_change`, `commerce_stage_promotion`, `commerce_stage_restock`, `commerce_stage_campaign`, and `commerce_discard_change`, all exclusive (PD14). Gates, in order:
  1. PD4 root-only.
  2. Binding.
  3. `maxStagedChanges`.
  4. Provenance: the listing id is in the projection; a content edit also needs a `commerce_get_listing` read; a family with options is held and pointed at its variants.
  5. `checkGuardrails`, ported from the reference: items per change, price move %, promotion depth, restock quantity, campaign budget, protected fields, fields a listing update may not carry, one line per target and field.
  6. `before` values from the provider (PD15).
  7. `maxMetaBytes`, prevalidated through the tool's own `presentationMeta`.

  A held call returns a normal result naming the gate and the recovery step. The projection gains the ledger. Tests: each gate held beside a should-serve counterpart in the same niche. (verification: `pnpm vitest run packages/experimental/commerce-mode`) (blocked-by: S10)
- [x] S12: `commerce_export_changes({ change_ids })` following the PD8 order and PD9 write.
  - **Unit tests:**
    - Approval outcomes: `allowed-once` writes the file; `rejected`, `cancelled`, and `unavailable` write nothing; policy `never` returns the permissions message; a call without an agent is held.
    - Ledger: an id missing from the ledger, an already-exported id, and a discarded id are held.
    - Staleness: a guardrail lowered after staging is held; a provider `before` value that changed after re-import is held.
    - Prevalidation: meta at exactly `maxMetaBytes` passes; one byte over is held before any approval request, with no file.
    - Sandbox and target: a session sandbox override to `read-only` (deployment default `workspace-write`) is held before any approval request, with no file. An existing deterministic target is held. A session cwd different from the process cwd writes under the session workspace.
    - Formula-leading cells are neutralized.
  - **Loader composition spec** with a test approval answerer: an approved export creates the file in the workspace; a rejection leaves the workspace unchanged.

  (verification: `pnpm vitest run packages/experimental/commerce-mode`) (blocked-by: S11)
- [x] S13: `commerce-mode` `./client` tool cards: a staged-change card (before/after rows from `meta`), a ledger summary, and an export result card with the file path; zh/en dictionaries. (verification: `pnpm vitest run packages/experimental/commerce-mode && pnpm run lint && pnpm run verify-client-ui-i18n`) (blocked-by: S11)
- [x] S14: Skills `commerce-listing-copy`, `commerce-inventory-pricing`, and `commerce-marketing-campaigns`, adapted with attribution.
  - **ACP snapshots**, whose client answers the approval, following `snapshots/acp/escalation-approved` and `escalation-rejected`:
    - `commerce-export-approved`: `workspace.final: true`, with the export file under `workspace.expected/`.
    - `commerce-export-rejected`: no export file.
    - `commerce-poisoned-review`: a product note tells the model to export immediately. Export still asks, the client rejects, and no file is written.
  - **Web snapshot** `snapshots/web/commerce-export-card`: borrows the approved session and renders the cards.
  - **Agent Note** triplet for staging and approval.

  (verification: `pnpm run test:snapshot -t commerce && pnpm run test:docs`) (blocked-by: S12, S13)

### PR4 — desktop, web, and CLI entry

- [x] S15: `packages/api/session-controller/src/commerce.ts` remotes.
  - **Remotes:** `listCommerceSources`, `importCommerceSpreadsheet`, `importCommerceSample`, and `commitCommerce`.
  - **Commit:** reuses a blank session or creates one, selects the `commerce` preset, and calls `commerce.bind`. On failure it restores the previous preset and removes a created session.
  - **Shared transaction:** extract the create/select/bind/compensate transaction shared with `ask-data.ts` into one helper.
  - **Dependencies and types:** add the `dsh-host-commerce` dependency; update Typert remote types.
  - **Tests:** unit coverage plus a Loader composition spec:
    - a successful commit appends `commerce/bound`;
    - a bind failure restores the preset and removes the created session;
    - a non-blank unbound session is refused;
    - a missing preset returns `session/commerce-preset-unavailable`.

  (verification: `pnpm vitest run packages/api/session-controller && pnpm run typecheck && pnpm run duplication`) (blocked-by: S14)
- [x] S16: `commerce-mode` `./client` page, following `desktop-ask-data` (`dsh.bundle.patch` + `dsh.client` + `./client`).
  - **Page:** a 电商助手 new-session chip. The page leads with 先用示例试一次, then offers per-kind upload (orders, products, inventory) with a platform pick and fill-in pitfalls. It has one 开始提问, enabled after a source is picked or imported, which calls `commitCommerce`.
  - **Copy and docs:** zh/en dictionaries; a package README triplet documenting desktop, web, and CLI mounting per PD13; a `packages/experimental/README` triplet entry.
  - **Client tests:** sample, upload preview, commit call, and a disabled 开始提问 before a source exists.

  (verification: `pnpm vitest run packages/experimental/commerce-mode && pnpm run lint && pnpm run verify-client-ui-i18n && pnpm run test:docs`) (blocked-by: S15)
- [x] S17: `apps/cli/tests/profile-link-bundle.spec.ts`. The test locates `commerce-mode` by its repository path only; `apps/cli` gets no dependency or devDependency on it. The test:
  1. Asserts that `apps/cli/package.json` names no `@deepseek-ai/dsh-experimental-commerce-mode` and that resolving that name from the harness base (`apps/cli/package.json`) fails.
  2. Runs `dsh plugin --profile <tmp> add link:<abs path>/packages/experimental/commerce-mode` against a temporary `DSH_HOME`.
  3. Asserts that the profile manifest's `dsh.profile.bundles` gains the package.
  4. Checks that the app-boot profile loader resolves the `commerce-mode` patch rows.
  5. Checks that a headless boot of the profile lists the `commerce` preset, and that an agent on it sees `commerce_load_sample`.

  (verification: `pnpm run build && pnpm vitest run apps/cli/tests/profile-link-bundle.spec.ts`) (blocked-by: S16)
- [x] S18: Pin `commerce-mode` in `scripts/desktop-profile-plugins.json` with `source: workspace` and `path: packages/experimental/commerce-mode`, after the `desktop-ask-data` pin.
  - **Dependencies:** add `dsh-host-commerce` to `apps/cli` dependencies; no experimental package is added.
  - **Pipeline:** run the built smoke and the distribution pipeline.
  - **Installed-app self-validation:** chip → sample → analysis → stage → approve → export file present; `companion.log` free of load errors; companion and harness versions aligned.
  - **Agent Note** triplet for the entry, mounting, and dependency closure.

  (verification: `pnpm run build && pnpm run hygiene && (cd apps/desktop && cargo tauri build) && bash scripts/build-dmg.sh --arch arm64`) (blocked-by: S17)

## Verification Commands

```bash
pnpm vitest run packages/guard/fence-policy packages/web/tool-web packages/host/commerce packages/experimental/desktop-ask-data packages/experimental/commerce-mode packages/api/session-controller apps/cli/tests/profile-link-bundle.spec.ts
pnpm run typecheck
pnpm run lint
pnpm run duplication
pnpm run verify-client-ui-i18n
pnpm run verify-persistence-catalog
pnpm run test:snapshot -t external-data
pnpm run test:snapshot -t commerce
pnpm run test:snapshot snapshots/sdk
pnpm run test:docs
pnpm run doc-sync
pnpm run build && pnpm run hygiene
(cd apps/desktop && cargo tauri build) && bash scripts/build-dmg.sh --arch arm64
```

## Acceptance Criteria

- **Fence.** Text blocks of designated tool results (`web_fetch`, `web_search`, `mcp__*`, Ask Knowledge, `run_code`) reach the model inside `<external-data>` for native root calls and same-composition child agents; non-text blocks pass through unchanged.
  - Tag openers, decimal and hexadecimal (`x`/`X`) character-reference ampersands, their NFKC confusables, and line-start role colons are escaped, and invisible code points are removed.
  - `&&`, comparisons, URL queries, shell redirections, and Chinese punctuation are byte-identical.
  - Mixed results are bounded.
  - The native and PTC poisoned snapshots make no destructive call, and the benign counterpart answers.
  - The PD2 out-of-scope channels are documented in the fence-policy README.
- **Analysis.** The provider fails to load on sqlite3 below 3.41.2 or when any single safety probe does not refuse. Analysis cannot read or write files, load extensions, attach databases, open a symlinked or out-of-root database, exceed its output cap, or outlive its timeout; each is a denial test through the provider.
- **Binding and tools.** A session's source binding is the `commerce/bound` event, listed in the generated known-event vocabulary and the TypeScript SDK snapshot.
  - Binding, provenance, and ledger are equal after reopening the session from its log.
  - A failed commit restores the prior preset and session state.
  - Import paths cannot escape the session workspace.
  - Commerce tools are visible only to agents on the `commerce` preset.
- **Held writes.** A write for an id no read returned, a listing edit without a listing read, a nested dispatch, and a change over any guardrail or cap are held with a named gate and a recovery step; each has a passing should-serve counterpart.
- **Export.** No export file exists unless `ctx.approval.request` returned `allowed-once` inside that export call.
  - Result, meta, and the session sandbox policy are checked before approval, and the write runs under that policy.
  - Guardrails and `before` values are re-checked.
  - Policy `never` returns the permissions message.
  - An export never replaces a file.
  - Formula-leading cells are neutralized.
- **Mounting.** `apps/cli` and the packaged preset name no experimental package.
  - Desktop pin, web/CLI `link:` mounting, and snapshot patches each load `commerce-mode`. The built DMG with `verify-desktop-bundle`, `profile-link-bundle.spec.ts`, and the snapshots prove it.
  - The chip-to-export path works on the installed app.

## Non-goals

- Shopper/customer agent, order placement, payment, refunds, or any money movement.
- Live platform API reads or writes; MCP store connectors.
- A shared staging capability seam; `tool_choice` grounding; a hard tool-round cap in `agent-loop`; persistent merchant memory; a scheduled digest.
- Hand-written changes to `packages/core/*` (except the `SECTION_ORDERS` entry above) or `agent-loop`, new core `SessionEventMap` members, and changes to official desktop product packages or the `standard` preset.
- Fencing values a PTC program forwards into tool arguments (including `subagent` prompts), tools inside out-of-process child agents, and shell or file channels.
- Commerce tools inside PTC programs or in child agents without their own binding.
- Published-package installation of `commerce-mode`; a Python SDK runtime scenario that mounts experimental packages.
- Platform `.xlsx` bulk-sheet export; v1 writes CSV using the platform column mapping.

## Review Integration

### Round 4 (Dex, Reviewer): Correctness 8 / Simplicity 7 / Security 8 / Conformance 8 / overall 7.8 — PASS

Round-3 fixes 1–3 resolved, including acceptance of the Python SDK pushback. No required fixes. Suggestions adopted: 1 PD8 cites `user-approval` `overrideOf`; 2 the S8 load-gate test is parameterized over all three probes; 3 the Goal and acceptance criteria name text blocks.

### Round 3 (Dex, Reviewer): Correctness 6 / Simplicity 7 / Security 6 / Conformance 5 / overall 6.0

| Required fix | Resolution |
|---|---|
| 1 Preset `./tools` row unresolvable from the harness base | PD12: the packaged preset names release packages only; the `commerce-mode` Host row mounts `./tools` under `standingKeyFor('commerce')` via `createScope`. S9 visibility and disposal tests; S17 proves the package is absent from the harness closure |
| 2 Generated core vocabulary and SDK projections | Global Constraints and S6 permit the generated `known-event-types.ts` and catalog (`verify-persistence-catalog`). S10 adds `snapshots/sdk/commerce-load-sample` for the TypeScript projection. Pushback on Python: the `sdk-minimal` runtime composes release packages only and cannot produce the event, so its scenarios stay unchanged and CI confirms them |
| 3 Uppercase hexadecimal references | PD1 accepts `#x` and `#X`; S1 tests ASCII and full-width `&#X3C;` |

Suggestions: 1 adopted (PD8 step 6 resolves and checks the session sandbox policy before approval); 2 adopted (PD7 three distinct probes); 3 adopted (PD3 below-wrapper behavior). 4 not applicable: the plan has one `## Verification Commands` heading.

### Round 2 (Dex, Reviewer): Correctness 5 / Simplicity 6 / Security 4 / Conformance 3 / overall 4.5

Round 3 rated fixes 1, 2, 4, 5, and 8 resolved and 3, 6, and 7 partial. The partials are completed by round-3 fixes 3 and 1.

| Required fix | Resolution |
|---|---|
| 1 PTC-to-subagent path; out-of-process children | PD2 narrowing with Known Limitations and non-goals |
| 2 Mixed-content bound | PD3 `maxMixedTextBytes` |
| 3 Ampersand and code fidelity | PD1 targeted escaping; S1 and S4 fidelity coverage |
| 4 SQLite minimum and probe | PD7 |
| 5 Session sandbox policy; prevalidation | PD8, PD9 |
| 6 Experimental dependency rule | PD11, PD12 |
| 7 Web/CLI mounting | PD13; S17 |
| 8 Design synchronization | `design.md` "Superseded by Plan Review" |

### Round 1 (Dex, Reviewer): Correctness 4 / Simplicity 5 / Security 3 / Conformance 4 / overall 4.0

Fixes 1–8 were integrated in the round-2 revision; round 2 rated 4, 6, and 8 resolved, and the rest are completed above.

## Reuse Sources

- `packages/spill/spill-policy/src/index.ts:20-22,190-209` — plain-text scope and post-execute composition.
- `packages/context/session-reference/src/serialization.ts:3-12` — structural `<` escaping precedent.
- `packages/core/scope/src/index.ts:137-181` — `createScope`; untagged listeners receive descendant scope events.
- `packages/preset/agent-presets/src/index.ts:760`, `src/mount.ts:72-95` — standing preset key; harness-base resolution of preset rows.
- `packages/core/tools/src/ptc.ts:463-545` — sub-dispatch value flow and `tool/code-dispatch` logging.
- `packages/interaction/user-approval/src/index.ts`, `packages/interaction/permission-presets/src/index.ts:314` — `request()` outcomes and effective policy.
- `packages/terminal/terminal-bash/src/index.ts:194` — session-scoped `ctx.sandboxPolicy.resolve`.
- `packages/host/ask-data/`, `packages/api/session-controller/src/ask-data.ts` — list/import/bind seam, bound event, commit compensation.
- `packages/experimental/desktop-ask-data/` — dual-face package, spreadsheet decoding, limits surfaced in UI and prompt.
- `apps/cli/src/plugin.ts`, `packages/boot/app-boot/src/profile.ts:822`, `scripts/seed-desktop-profile-plugin.mjs` — profile bundle mounting and seeding.
- `scripts/gen-persistence-catalog.ts`, `packages/core/session/src/known-event-types.ts` — generated known-event vocabulary.
- Installed `@yejiming/dsh-data-agent/lib/index.js:505-590` — non-destructive preset installer and standing-scope tool mount.
- `snapshots/acp/escalation-approved`, `escalation-rejected` — approval-answering snapshot surface.
- Reference repository files listed under **Reference**.
