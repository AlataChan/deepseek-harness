# Agent Team 右侧协作舱 + Archify 桌面种子 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship option A (resizable right collaboration dock with topology-first layout and finite edge motion) and distribute Archify so desktop DMG users get the post-hoc diagram skill without a manual `dsh plugin add`.

**Architecture:** Keep one Host projection (`TeamView` / `interactions`). Present it in a Client-only right overlay dock (no `ui-conversation` layout rewrite). Seed Archify via fork `bundled-skills` → `~/.dsh/skills/archify` (same path as WeChat extractor)—not `desktop-profile-plugins.json`, because `@tt-a1i/archify-dsh` is skill-only and fails the web `dsh.client` seed validator. After Team tasks settle, the dock offers a one-click Archify CTA that fills the composer; the chat reply carries the HTML path/link.

**Tech stack:** `client-ui-agent-team` React/CSS modules, vitest jsdom, `scripts/desktop-bundled-skills.json` + seed/verify scripts, locale dictionaries, Agent Notes.

---

## Product decisions (locked)

| Topic | Decision |
|---|---|
| Live map | Right overlay dock, default ~40vw, drag 280px–55vw, localStorage width + pin |
| Data | Same `TeamView`; open / refresh / mutation only; no polling / no second API |
| Motion | Finite edge particles + running pulse; user “减弱动态”; zero new deps |
| Archify | Default DMG seed via `bundled-skills`; still post-hoc, not the live renderer |
| Completion HTML | **Yes, but via CTA + chat link**, not silent auto-run mid-loop |

### Completion HTML link (answer to product question)

**Agree.** Users should get a clickable path after a Team run. Preferred shape:

1. Detect “had teammates + every non-deleted task is `completed`” on refresh.
2. Show a dock banner: **生成协作总结图** (once per settle, dismissible).
3. Click → `inputActions.setDraft(archifyPrompt)` (and keep dock open). User sends; Lead loads `archify` and writes HTML.
4. Model reply already surfaces workspace-relative / absolute path as a markdown link users can open.

**Avoid** silent auto-submit on settle: race with still-running members, surprise token cost, and hard-to-debug skill failures. Optional later: Host `openWorkspacePath` when a known `*.html` is returned—out of this landing if no existing Client hook is one-line.

---

## Layering (unchanged intent)

| Layer | Job |
|---|---|
| Chat | Content |
| Right dock | Spatial topology (who runs, edges, light dots) |
| Dock bottom | CAS tasks / roster / starters (migrated panel) |
| Archify | Post-hoc HTML after CTA |

Header badge (option C) stays as activity hint; **primary open action mounts the dock**.

---

## Phases

| Phase | Deliverable | Verify |
|---|---|---|
| **S0** Archify seed | Pin + seed path + verify gate; skill appears under `~/.dsh/skills/archify` after install/refresh | `node scripts/seed-desktop-bundled-skills.mjs --out /tmp/bundled-skills-test` + gate grep |
| **A0** Dock shell | Resizable right overlay; topology main; header toggles dock | vitest client |
| **A1** Migrate panel | Roster/tasks/starters in collapsible dock bottom; remove old dropdown panel | vitest |
| **A2** Motion | Edge particle on new interaction / complete flash; reduce-motion pref | vitest + CSS |
| **A3** Polish | Pin, Esc, remembered width (if not in A0) | vitest |
| **H1** Archify CTA | Settle banner + locale prompt fill | vitest |

Execute **S0 → A0 → A1 → A2 → H1 → A3** in that order. Commit after each green phase when the user asks for commits.

---

## Task S0: Seed Archify for desktop DMG

**Why not profile-plugins:** `validatePluginDir` requires `dsh.client.platform === 'web'` and `./client`. `@tt-a1i/archify-dsh@0.1.0` is skill-only (`dsh.bundle.patch` + `skills/archify`).

**Files:**
- Modify: `scripts/desktop-bundled-skills.json`
- Modify: `scripts/seed-desktop-bundled-skills.mjs` (support `source: "npm"` entries that pack `@tt-a1i/archify-dsh` and copy `skills/archify`)
- Modify: `scripts/verify-desktop-bundle.sh` (assert `bundled-skills/archify/SKILL.md` + `bin/archify.mjs`)
- Modify: `AGENTS.md` / learned prefs — Archify **is** default desktop seed
- Create: `.agents/notes/implemented/feature/2026-09-04-archify-desktop-seed.{md,zh.md,i18n.yaml}`

**Steps:**
1. Extend pin schema: either workspace `path` (WeChat) or `{ name, source: "npm", package, version, skillSubpath }`.
2. On npm entries: `npm pack`, extract `package/<skillSubpath>`, `npm install --omit=dev` if lock/deps exist (archify skill is mostly self-contained).
3. Run seed to `/tmp/...` and confirm `archify/SKILL.md` frontmatter `name: archify`.
4. Update verify gate.
5. Local heal: after next app launch / manual copy, `~/.dsh/skills/archify` exists.

**Manual smoke after DMG or local seed:**
```bash
# after install_bundled_skills or manual seed into ~/.dsh/skills
ls ~/.dsh/skills/archify/SKILL.md
```
Then in desktop: ask model to list skills → must include `archify`.

---

## Task A0: Right dock shell + topology main

**Files:**
- Modify: `packages/experimental/client-ui-agent-team/src/client/TeamAction.tsx`
- Modify: `packages/experimental/client-ui-agent-team/src/client/TeamAction.module.css`
- Modify: `packages/experimental/client-ui-agent-team/src/client/locales.ts`
- Modify: `packages/experimental/client-ui-agent-team/tests/team-action.client.spec.tsx`
- Optional extract: `TeamDock.tsx` if TeamAction exceeds clarity

**Behavior:**
- `open` mounts fixed right dock (`role="dialog"`) + translucent backdrop (click closes unless pinned).
- Width: `clamp(280px, stored, 55vw)`; default `min(40vw, 560px)` stored key `dsh.client.agent-team.dockWidth`.
- Left edge resize handle (pointer events); persist on pointerup.
- Toolbar: title, `running/count`, refresh, pin (stub OK if A3), close.
- Main: enlarged `TeamTopology` (~55–65% height).
- Bottom: existing panel body temporarily still inside dock (full migrate in A1).

**Tests:** open → dialog is right-dock (class or `data-team-dock`); resize writes localStorage; backdrop closes; badge still silent-prefetch.

---

## Task A1: Collapse ops under topology

**Files:** same package as A0

- Collapsible “任务与成员” section default expanded when tasks non-empty.
- Remove absolute dropdown `.panel` path entirely.
- Starters stay at bottom of ops.

---

## Task A2: Edge light dots + reduce motion

**Files:**
- Modify: `TeamTopology.tsx` + CSS
- Locales: `motionReduce` / `motionFull`

**Behavior:**
- On new `interactions` edge ids: animate one dot along the SVG line (~700ms) via CSS `offset-path` or rAF on a circle; remove after.
- Running members: keep/slow pulse ring.
- Task-complete: flash target member node once (status delta or edge kind).
- Pref `dsh.client.agent-team.reduceMotion=1` skips particles/pulse; static edges remain.

---

## Task H1: Post-settle Archify CTA

**Files:** TeamAction + locales + tests

- When `teammates.length > 0` and tasks.length > 0 and every task `status === 'completed'`, show banner once (sessionStorage key per sessionId).
- Button fills Archify prompt (zh): load archify skill; map this Team’s members/deps/messages to HTML; save under workspace; return path; do not re-run tasks.
- Do not auto-`submit()`.

---

## Task A3: Pin + Esc

- Pin: backdrop click ignored; optional chevron still closes via X.
- Esc closes when not typing in an input.
- Width already remembered in A0.

---

## Out of scope

- True split-pane / `ui-conversation` layout contract changes
- SSE / Client push for topology without refresh
- Embedding Archify viewer iframe as live map
- Changing official `desktop-app` / `desktop-companion` product logic beyond fork seed scripts

---

## Verification commands

```bash
pnpm exec vitest run packages/experimental/client-ui-agent-team/tests/
node scripts/seed-desktop-bundled-skills.mjs --out /tmp/dsh-bundled-skills-test
test -f /tmp/dsh-bundled-skills-test/archify/SKILL.md
# full DMG path when packaging:
# bash scripts/verify-desktop-bundle.sh   # after tauri build resources exist
```
