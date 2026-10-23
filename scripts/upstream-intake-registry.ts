/**
 * Upstream intake registry: the single home for how octopus_DSH classifies
 * upstream `deepseek-ai/deepseek-harness` surface.
 *
 * `scripts/verify-upstream-intake.ts` reads these tables as its source of
 * truth. Prose explanation of the taxonomy and the reasoning behind each row
 * lives in `docs/plans/2026-10-06-upstream-selective-upgrade.md`; this file
 * carries only the facts a gate can check.
 */

/** Classes an upstream path can receive. See the plan's intake taxonomy. */
export type IntakeClass = 'A' | 'B' | 'C' | 'D' | 'E'

/** Why an upstream path is never merged into this fork. */
export type NeverMergeTag =
  | 'shell'
  | 'account-binding'
  | 'policy-gate'
  | 'release-feed'
  | 'product-analytics'

/** One upstream-authored path the fork never merges. */
export interface NeverMergeEntry {
  /** Repository-relative path or path prefix, exactly as upstream authors it. */
  readonly path: string
  /** The reason category, which is also the reason a reader looks here. */
  readonly tag: NeverMergeTag
  /** Why this path cannot enter the fork. One sentence, no restatement of the tag. */
  readonly reason: string
}

/** One upstream file the fork edits and intends to keep editing. */
export interface PatchEntry {
  /** Repository-relative path of the upstream file. */
  readonly path: string
  /** `A` keeps the patch; `B` is debt scheduled to move onto a declared slot. */
  readonly klass: Extract<IntakeClass, 'A' | 'B'>
  /** Why the edit exists. A patch without a reason is a defect this table exists to catch. */
  readonly reason: string
}

/** One selected backport; it does not advance the whole-release upstream pin. */
export interface BackportEntry {
  /** Stable scope item in the reviewed upgrade plan. */
  readonly id: string
  /** Upstream release containing the source behavior. */
  readonly sourceTag: string
  /** Whole-release baseline retained while this backport is active. */
  readonly basePin: string
  /** PRs or source change subjects; exact commit IDs live in scoped evidence. */
  readonly sourceChanges: readonly string[]
  /** Whether source was imported or adapted to the fork. */
  readonly disposition: 'imported' | 'adapted'
  /** Exact files covered by the selected backport; directory-wide exemptions are forbidden. */
  readonly paths: readonly string[]
  /** Other selected entries required for this behavior. */
  readonly prerequisites: readonly string[]
  /** Runnable behavior checks owned by this entry. */
  readonly verification: readonly string[]
}

/** Selected behavior imports; the earlier upgrade plan still owns UPSTREAM_PIN. */
export const BACKPORTS: readonly BackportEntry[] = [
  { 'id': 'C1', 'sourceTag': 'dsh-v0.2.1-rc.2', 'basePin': 'dsh-v0.2.1-alpha.1', 'sourceChanges': ['Stable Cordis release metadata and timer locales'], 'disposition': 'adapted', 'paths': ['vendor/cordis/package.json', 'vendor/cosmokit/package.json', 'vendor/group/package.json', 'vendor/hmr/package.json', 'vendor/include/package.json', 'vendor/loader/package.json', 'vendor/logger-console/package.json', 'vendor/schemastery/package.json', 'vendor/timer/package.json', 'vendor/timer/locale/en.json', 'vendor/timer/locale/zh.json', 'pnpm-lock.yaml', 'vendor/README.md', 'scripts/upstream-compatibility-policy.ts', 'scripts/verify-upstream-intake.ts', 'scripts/upstream-compatibility-release.spec.ts', 'scripts/verify-upstream-intake.spec.ts', 'packages/boot/plugin-manager/tests/manager.spec.ts'], 'prerequisites': [], 'verification': ['scripts/upstream-compatibility-release.spec.ts', 'pnpm run rescope-vendor:check', 'pnpm run verify-upstream-intake'] },
  { id: 'U4', sourceTag: 'dsh-v0.2.1-rc.2', basePin: 'dsh-v0.2.1-alpha.1', sourceChanges: ['PR #6272'], disposition: 'imported', paths: ['packages/subagent/subagent-codex/README.i18n.yaml', 'packages/subagent/subagent-codex/README.md', 'packages/subagent/subagent-codex/README.zh.md', 'packages/subagent/subagent-codex/src/wire.ts', 'packages/subagent/subagent-codex/tests/partial-answer-process.spec.ts', 'packages/subagent/subagent-codex/tests/subagent-codex.spec.ts'], prerequisites: [], verification: ['packages/subagent/subagent-codex/tests/subagent-codex.spec.ts'] },
  { id: 'U5', sourceTag: 'dsh-v0.2.1-rc.2', basePin: 'dsh-v0.2.1-alpha.1', sourceChanges: ['PR #6275'], disposition: 'imported', paths: ['packages/client/ui-skill/README.i18n.yaml', 'packages/client/ui-skill/README.md', 'packages/client/ui-skill/README.zh.md', 'packages/client/ui-skill/package.json', 'packages/client/ui-skill/src/client/index.ts', 'packages/client/ui-skill/tests/browser-plugin.client.spec.ts', 'packages/client/ui-skill/tsconfig.json'], prerequisites: [], verification: ['packages/client/ui-skill/tests/browser-plugin.client.spec.ts'] },
  { id: 'U6', sourceTag: 'dsh-v0.2.1-rc.2', basePin: 'dsh-v0.2.1-alpha.1', sourceChanges: ['PR #6353'], disposition: 'imported', paths: ['packages/client/ui-dockkit/src/components/DockSurface.tsx', 'packages/client/ui-sidebar-right/src/client/shell/SidebarRight.module.css'], prerequisites: [], verification: ['apps/web/tests/sidebar-right.e2e.ts'] },
  { id: 'U1', sourceTag: 'dsh-v0.2.1-rc.2', basePin: 'dsh-v0.2.1-alpha.1', sourceChanges: ['PR #6103'], disposition: 'adapted', paths: ['packages/client/ui-settings-web-search/README.i18n.yaml', 'packages/client/ui-settings-web-search/README.md', 'packages/client/ui-settings-web-search/README.zh.md', 'packages/client/ui-settings-web-search/src/client/WebSearchCard.module.css', 'packages/client/ui-settings-web-search/src/client/WebSearchCard.tsx', 'packages/client/ui-settings-web-search/src/client/index.ts', 'packages/client/ui-settings-web-search/src/client/locales.ts', 'packages/client/ui-settings-web-search/src/client/web-search-card-controller.ts', 'packages/client/ui-settings-web-search/src/index.ts', 'packages/client/ui-settings-web-search/tests/card.client.spec.tsx', 'packages/client/ui-settings-web-search/tests/controller.client.spec.ts', 'packages/web/web-deepseek-api/README.i18n.yaml', 'packages/web/web-deepseek-api/README.md', 'packages/web/web-deepseek-api/README.zh.md', 'packages/web/web-deepseek-api/locale/en.json', 'packages/web/web-deepseek-api/locale/zh.json', 'packages/web/web-deepseek-api/package.json', 'packages/web/web-deepseek-api/src/fetch.ts', 'packages/web/web-deepseek-api/src/index.ts', 'packages/web/web-deepseek-api/src/search.ts', 'packages/web/web-deepseek-api/src/transport.ts', 'packages/web/web-deepseek-api/tests/credentials.spec.ts', 'packages/web/web-deepseek-api/tests/egress.spec.ts', 'packages/web/web-deepseek-api/tests/fetch.spec.ts', 'packages/web/web-deepseek-api/tests/redirect.spec.ts', 'packages/web/web-deepseek-api/tests/search.spec.ts', 'packages/web/web-deepseek-api/tests/transport.spec.ts', 'packages/web/web-deepseek-api/tests/web-deepseek-api.e2e.ts', 'packages/web/web-deepseek-api/tsconfig.json', 'packages/web/web/README.i18n.yaml', 'packages/web/web/README.md', 'packages/web/web/README.zh.md', 'packages/web/web/src/index.ts', 'packages/web/web/tests/web.spec.ts'], prerequisites: [], verification: ['packages/web/web-deepseek-api/tests/search.spec.ts'] },
  { id: 'U2', sourceTag: 'dsh-v0.2.1-rc.2', basePin: 'dsh-v0.2.1-alpha.1', sourceChanges: ['PR #6103'], disposition: 'adapted', paths: ['packages/web/web-search-deepseek/README.i18n.yaml', 'packages/web/web-search-deepseek/README.md', 'packages/web/web-search-deepseek/README.zh.md', 'packages/web/web-search-deepseek/src/provider.ts', 'packages/web/web-search-deepseek/tests/deepseek.spec.ts'], prerequisites: [], verification: ['packages/web/web-search-deepseek/tests/deepseek.spec.ts'] },
  { id: 'D4', sourceTag: 'dsh-v0.2.1-rc.2', basePin: 'dsh-v0.2.1-alpha.1', sourceChanges: ['PR #5483', 'PR #6121'], disposition: 'adapted', paths: ['packages/api/remotes/src/client/index.ts', 'packages/api/settings-controller/src/credentials.ts', 'packages/api/settings-controller/src/types.ts', 'packages/api/settings-controller/tests/credentials-controller.host.spec.ts', 'packages/bundle/headless/README.i18n.yaml', 'packages/bundle/headless/README.md', 'packages/bundle/headless/README.zh.md', 'packages/bundle/headless/cordis.patch.yml', 'packages/credentials/README.i18n.yaml', 'packages/credentials/README.md', 'packages/credentials/README.zh.md', 'packages/credentials/credentials-local/README.i18n.yaml', 'packages/credentials/credentials-local/README.md', 'packages/credentials/credentials-local/README.zh.md', 'packages/credentials/credentials-local/src/index.ts', 'packages/credentials/credentials-local/tests/local.spec.ts', 'packages/credentials/credentials-local/tests/watcher.spec.ts', 'packages/credentials/credentials/README.i18n.yaml', 'packages/credentials/credentials/README.md', 'packages/credentials/credentials/README.zh.md', 'packages/credentials/credentials/src/index.ts', 'packages/llm/llm-pi-ai/README.i18n.yaml', 'packages/llm/llm-pi-ai/README.md', 'packages/llm/llm-pi-ai/README.zh.md', 'packages/llm/llm-pi-ai/scripts/gen-provider-data.ts', 'packages/llm/llm-pi-ai/src/index.ts', 'packages/llm/llm-pi-ai/src/provider-data.generated.ts', 'packages/llm/llm-pi-ai/src/provider-data.ts', 'packages/llm/llm-pi-ai/tests/auth.spec.ts', 'packages/llm/llm-pi-ai/tests/catalog.spec.ts', 'packages/llm/llm-pi-ai/tests/dynamic-config.spec.ts', 'packages/llm/llm-pi-ai/tests/loader-composition.spec.ts', 'packages/llm/llm-pi-ai/tests/native-auth.spec.ts', 'packages/llm/llm/README.i18n.yaml', 'packages/llm/llm/README.md', 'packages/llm/llm/README.zh.md', 'packages/llm/llm/src/index.ts', 'packages/llm/llm/src/types.ts', 'packages/llm/llm/tests/topology.spec.ts'], prerequisites: [], verification: ['packages/credentials/credentials-local/tests/local.spec.ts'] },
  { id: 'U3', sourceTag: 'dsh-v0.2.1-rc.2', basePin: 'dsh-v0.2.1-alpha.1', sourceChanges: ['PR #6261', 'PR #6106'], disposition: 'adapted', paths: ['packages/client/ui-settings-models/README.i18n.yaml', 'packages/client/ui-settings-models/README.md', 'packages/client/ui-settings-models/README.zh.md', 'packages/client/ui-settings-models/src/client/ApiKeyInput.tsx', 'packages/client/ui-settings-models/src/client/CustomProviderCard.tsx', 'packages/client/ui-settings-models/src/client/ModelListEditor.tsx', 'packages/client/ui-settings-models/src/client/ModelReasoningEfforts.tsx', 'packages/client/ui-settings-models/src/client/ModelRow.tsx', 'packages/client/ui-settings-models/src/client/ModelsSection.module.css', 'packages/client/ui-settings-models/src/client/ModelsSection.tsx', 'packages/client/ui-settings-models/src/client/ProviderEditor.tsx', 'packages/client/ui-settings-models/src/client/locales.ts', 'packages/client/ui-settings-models/src/client/operations.ts', 'packages/client/ui-settings-models/src/client/store.ts', 'packages/client/ui-settings-models/tests/components.client.spec.tsx', 'packages/client/ui-settings-models/tests/model-list-catalog.client.spec.tsx', 'packages/client/ui-settings-models/tests/model-reasoning-efforts.client.spec.tsx', 'packages/client/ui-settings-models/tests/provider-form.client.spec.tsx', 'packages/client/ui-settings-models/tests/store.client.spec.ts'], prerequisites: ['D4'], verification: ['packages/client/ui-settings-models/tests/model-reasoning-efforts.client.spec.tsx'] },
  { id: 'U7', sourceTag: 'dsh-v0.2.1-rc.2', basePin: 'dsh-v0.2.1-alpha.1', sourceChanges: ['client-modules: compare Host releases before parsing or applying updates'], disposition: 'adapted', paths: ['apps/desktop/src/bootstrap.ts', 'apps/desktop/tests/bootstrap.spec.ts', 'apps/desktop/vite.config.ts', 'package.json', 'packages/client/connection-process/README.md', 'packages/client/connection-process/src/protocol.ts', 'packages/client/modules/README.i18n.yaml', 'packages/client/modules/README.md', 'packages/client/modules/README.zh.md', 'packages/client/modules/src/client/entries.ts', 'packages/client/modules/src/client/index.ts', 'packages/client/modules/src/client/manifest.ts', 'packages/client/modules/src/client/notify.ts', 'packages/client/modules/src/client/release-change.ts', 'packages/client/modules/src/index.ts', 'packages/client/modules/tests/entries.client.spec.ts', 'packages/client/modules/tests/loader.client.spec.ts', 'packages/client/modules/tests/node-half.client.spec.ts', 'packages/client/tsdown.client.ts', 'packages/client/ui-settings-general/README.i18n.yaml', 'packages/client/ui-settings-general/README.md', 'packages/client/ui-settings-general/README.zh.md', 'packages/client/ui-settings-general/package.json', 'packages/client/ui-settings-general/src/client/HostReleasePrompt.module.css', 'packages/client/ui-settings-general/src/client/HostReleasePrompt.tsx', 'packages/client/ui-settings-general/src/client/index.ts', 'packages/client/ui-settings-general/src/client/locales.ts', 'packages/client/ui-settings-general/tests/apply.client.spec.ts', 'packages/client/ui-settings-general/tests/components.client.spec.tsx', 'packages/client/ui-settings-general/tests/shell.client.spec.ts', 'packages/client/ui-settings-general/tsconfig.client.json', 'packages/test-support/client-runtime/src/assembly/bundle-roster.ts', 'scripts/client-build-environment.client.spec.ts', 'scripts/client-build-environment.ts', 'scripts/desktop-artifact-identity.spec.ts', 'scripts/desktop-artifact-identity.ts', 'scripts/desktop-build-identity.ts'], prerequisites: [], verification: ['packages/client/modules/tests/entries.client.spec.ts', 'apps/desktop/tests/bootstrap.spec.ts'] },
  { id: 'D1', sourceTag: 'dsh-v0.2.1-rc.2', basePin: 'dsh-v0.2.1-alpha.1', sourceChanges: ['desktop: bounded Windows directory-lock retries and recovery diagnostics'], disposition: 'adapted', paths: ['apps/desktop/src-tauri/tauri.windows.conf.json', 'scripts/build-exe.mjs', 'scripts/desktop-installer-config.spec.ts', 'scripts/desktop-installer-state.ps1', 'scripts/desktop-installer-template.nsi', 'scripts/desktop-installer-transaction.nsh', 'scripts/tests/desktop-installer-state.ps1', 'scripts/tests/desktop-installer-upgrade.ps1'], prerequisites: ['U7'], verification: ['scripts/tests/desktop-installer-upgrade.ps1'] },
  { id: 'D2', sourceTag: 'dsh-v0.2.1-rc.2', basePin: 'dsh-v0.2.1-alpha.1', sourceChanges: ['desktop: retained package identity and native public-signature qualification'], disposition: 'adapted', paths: ['.github/workflows/desktop-macos.yml', '.github/workflows/desktop-windows.yml', 'scripts/build-dmg.sh', 'scripts/desktop-app-entitlements.plist', 'scripts/desktop-macos-preparation.spec.ts', 'scripts/desktop-macos-preparation.ts', 'scripts/desktop-node-entitlements.plist', 'scripts/desktop-release-cli.ts', 'scripts/desktop-release-manifest.ts', 'scripts/desktop-signing-config.spec.ts', 'scripts/desktop-signing-readiness.spec.ts', 'scripts/sign-desktop-macos.spec.ts', 'scripts/sign-desktop-macos.ts', 'scripts/stage-desktop-dmg.mjs', 'scripts/verify-desktop-release.ts'], prerequisites: ['U7', 'D1'], verification: ['scripts/verify-desktop-release.spec.ts', 'scripts/tests/desktop-publication-native.ps1'] },
  { id: 'D3', sourceTag: 'dsh-v0.2.1-rc.2', basePin: 'dsh-v0.2.1-alpha.1', sourceChanges: ['desktop: resumable verified artifact publication'], disposition: 'adapted', paths: ['.github/workflows/desktop-publish.yml', 'scripts/desktop-publication-workflow.spec.ts', 'scripts/desktop-release-github.ts', 'scripts/desktop-release-publish.ts', 'scripts/tests/desktop-publication-guard.ps1', 'scripts/verify-desktop-reviewed-plan.spec.ts', 'scripts/verify-desktop-reviewed-plan.ts'], prerequisites: ['D2'], verification: ['scripts/desktop-release-publish.spec.ts', 'scripts/desktop-release-github.spec.ts'] },
]

/** One telemetry or account row a release composition must not add unrecorded. */
export interface MountEntry {
  /** Composition file that carries the row. */
  readonly composition: string
  /** Cordis row id. */
  readonly row: string
  /** Package the row mounts. */
  readonly packageName: string
  /** What must change, or why the current state is accepted. */
  readonly requiredChange: string
}

/** What the fork does about a package upstream removed. */
export type RemovalDisposition =
  | 'keep-fork-owned'
  | 'follow-upstream-deletion'
  | 'move-to-experimental'

/**
 * The `ignorable` envelope inspection over the fork's real session logs: which
 * fork session events were checked, against how many logs, and what the logs
 * showed. Recorded as data because every migration edge reads it: a
 * required-on-read event the inventory does not admit refuses the whole log.
 */
export interface IgnorableInspection {
  /** Fork session event types the inspection covered. */
  readonly eventTypes: readonly string[]
  /** Real user logs inspected; every one was session format v0. */
  readonly inspectedLogs: number
  /** Envelope keys observed on every occurrence of {@link eventTypes}. */
  readonly envelopeKeys: readonly string[]
  /** What the inspection established about those events. */
  readonly conclusion: 'required-not-ignorable'
}

/** One package upstream removed that the fork still carries. */
export interface RemovalEntry {
  /** Upstream package directory that no longer exists upstream. */
  readonly path: string
  /**
   * The owner's decision, or `undefined` while undecided. Requiring this at
   * merge time rather than now is deliberate: the packages are not yet
   * "recently removed" from the fork's perspective, because the merge that
   * removes them has not happened. Rule 4 fails on `undefined` only in
   * merge-time mode.
   */
  readonly disposition: RemovalDisposition | undefined
  /** Why that disposition, once decided. */
  readonly reason: string | undefined
}

/**
 * The registry tables the intake gate reads, grouped so the gate and its specs
 * take one injectable value rather than seven positional tables.
 */
export interface IntakeRegistry {
  /** Upstream tag this branch has merged through; the pin the changed-file diff reads. */
  readonly upstreamPin: string
  /** Selected backports, independent of complete upstream intake. */
  readonly backports?: readonly BackportEntry[]
  /** The `ignorable` envelope inspection over the fork's real session logs. */
  readonly ignorableInspection: IgnorableInspection
  /** Upstream paths the fork never merges. */
  readonly neverMerge: readonly NeverMergeEntry[]
  /** Upstream files the fork edits. */
  readonly patches: readonly PatchEntry[]
  /** Telemetry and account rows that exist today and what must change. */
  readonly mounts: readonly MountEntry[]
  /** Packages upstream removed that the fork still carries. */
  readonly removals: readonly RemovalEntry[]
  /** Package names whose presence in a release composition requires a MOUNTS row. */
  readonly gatedPackageNames: readonly string[]
  /** Compositions that ship to users. */
  readonly releaseCompositions: readonly string[]
  /** Paths the fork authored, subtracted before the never-merge check. */
  readonly forkOwnedPaths: readonly string[]
  /** Upstream-only directories, where any file is a violation. */
  readonly upstreamOnlyDirectories: readonly string[]
  /** Dependencies that must not appear in a guarded manifest. */
  readonly forbiddenDependencies: readonly string[]
  /** Manifests the forbidden-dependency rule reads. */
  readonly guardedManifests: readonly string[]
  /** Upstream collectors a mounted telemetry row must never resolve to. */
  readonly forbiddenEndpoints: readonly ForbiddenEndpoint[]
}

/** A single known upstream endpoint the fork must never contact. */
export interface ForbiddenEndpoint {
  /** Host name as it appears in a composition's default value. */
  readonly host: string
  /** Which upstream deployment owns it. */
  readonly owner: string
}

/**
 * Paths the fork authored. Rule 3 subtracts these before demanding a registry
 * entry for an upstream edit, so `apps/desktop/` appears whole: the fork owns
 * that collided path, and its files are additions rather than upstream edits.
 */
export const FORK_OWNED_PATHS: readonly string[] = [
  'apps/desktop/',
  'packages/experimental/',
]

/**
 * The upstream tag this branch has merged through (hop 3 of 4). The intake
 * command diffs the working tree against this pin to compute the upstream
 * files the fork edits, so the merge-time rules always run.
 */
export const UPSTREAM_PIN = 'dsh-v0.2.1-alpha.1'

/**
 * Inspection of 152 real user logs (2026-10-06, all session format v0): the
 * fork's nine session events are written without `ignorable: true`, so every
 * migration edge must admit them as required events or refuse the log.
 */
export const IGNORABLE_INSPECTION: IgnorableInspection = {
  eventTypes: [
    'ask-data/bound',
    'ask-knowledge/bound',
    'ask-knowledge/unbound',
    'commerce/bound',
    'media/approval',
    'media/artifact',
    'media/request',
    'media/stop',
    'media/task',
  ],
  inspectedLogs: 152,
  envelopeKeys: ['type', 'seq', 'time', 'data'],
  conclusion: 'required-not-ignorable',
}

/** Upstream shell, account, telemetry and release surface the fork never merges. */
export const NEVER_MERGE: readonly NeverMergeEntry[] = [
  { path: 'apps/desktop/src/account-backend.ts', tag: 'account-binding', reason: 'Binds the client to a DeepSeek account the fork users do not have.' },
  { path: 'apps/desktop/src/platform-view.ts', tag: 'account-binding', reason: 'Platform account session and cookie merging.' },
  { path: 'apps/desktop/src/platform-ipc.ts', tag: 'account-binding', reason: 'Platform account IPC surface.' },
  { path: 'apps/desktop/src/login-shell-environment.ts', tag: 'account-binding', reason: 'Login shell environment for the platform account flow.' },
  { path: 'apps/desktop/src/policy-test-auth.ts', tag: 'account-binding', reason: 'Test authentication against a remote policy service.' },
  { path: 'apps/desktop/src/mandatory-update-policy.ts', tag: 'policy-gate', reason: 'Remote fail-closed block on startup, driven from an upstream origin.' },
  { path: 'apps/desktop/src/mandatory-update-window.ts', tag: 'policy-gate', reason: 'Renders the remote policy decision as a full-window block.' },
  { path: 'apps/desktop/src/mandatory-update-ipc.ts', tag: 'policy-gate', reason: 'Policy state over IPC.' },
  { path: 'apps/desktop/src/update-coordinator.ts', tag: 'release-feed', reason: "Consumes upstream's release feed." },
  { path: 'apps/desktop/src/update-journal.ts', tag: 'release-feed', reason: "Journal for upstream's in-place update." },
  { path: 'apps/desktop/src/update-http-executor.ts', tag: 'release-feed', reason: "HTTP executor for upstream's update payloads." },
  { path: 'apps/desktop/src/update-dialog.ts', tag: 'release-feed', reason: 'Dialog for the upstream update flow.' },
  { path: 'apps/desktop/src/update-overlay.ts', tag: 'release-feed', reason: 'Overlay presentation for the upstream update flow.' },
  { path: 'apps/desktop/src/device-info.ts', tag: 'product-analytics', reason: 'Machine description attached to the desktop feedback questionnaire.' },
  { path: 'apps/desktop/scripts/desktop-cos.ts', tag: 'release-feed', reason: "Uploads releases to upstream's object storage." },
  { path: 'apps/desktop/scripts/desktop-release-environment.mjs', tag: 'release-feed', reason: "Resolves upstream's release identity and channel." },
  { path: 'apps/desktop/scripts/desktop-auto-update-environment.mjs', tag: 'release-feed', reason: "Selects upstream's auto-update deployment." },
  { path: 'apps/desktop/scripts/desktop-policy-environment.mjs', tag: 'policy-gate', reason: 'Resolves the remote policy origin; throws when unset.' },
  { path: 'apps/desktop/electron-builder.config.mjs', tag: 'release-feed', reason: "Upstream's Electron Builder configuration." },
]

/** Upstream files the fork edits. Phase 3 works the `B` rows down to zero. */
export const PATCHES: readonly PatchEntry[] = [
  { path: 'apps/cli/package.json', klass: 'A', reason: 'Fork harness assembly: the desktop companion entry and the fork workspace Host dependencies (desktop-app, agent-team, assistant-registry, commerce) must be dependencies here to bundle into the harness.' },
  { path: 'packages/acp/acp/package.json', klass: 'A', reason: 'cordis-plugin-loader peer for the fork ACP initialize fix, which answers only after the Loader tree settles.' },
  { path: 'packages/acp/acp/src/index.ts', klass: 'A', reason: 'Fork ACP initialize fix: answer only after the Loader tree settles.' },
  { path: 'packages/api/session-controller/src/index.ts', klass: 'A', reason: "The fork's ask-data, ask-knowledge, commerce and transcript-audio remotes." },
  { path: 'packages/api/session-controller/src/agent.ts', klass: 'A', reason: 'Companion agent surface for the fork remotes.' },
  { path: 'packages/api/session-controller/src/ask-data.ts', klass: 'A', reason: 'Ask-data remote implementation.' },
  { path: 'packages/api/session-controller/src/ask-knowledge.ts', klass: 'A', reason: 'Ask-knowledge remote implementation.' },
  { path: 'packages/api/session-controller/src/commerce.ts', klass: 'A', reason: 'Commerce remote implementation.' },
  { path: 'packages/api/session-controller/src/types.ts', klass: 'A', reason: 'Fork remote and media/transcript-audio error codes in the Typert protocol declaration.' },
  { path: 'packages/api/session-controller/package.json', klass: 'A', reason: "The fork's ask-data, ask-knowledge and commerce remotes need their Host packages as optional peers." },
  // Fork client chrome. The plan's taxonomy boundary applies: a B-class item
  // that cannot be expressed without editing an upstream file is an A with a
  // registered patch. Each reason names the seam that would have to appear
  // upstream before the row could shrink again.
  { path: 'packages/extensions/cordis-client-runner/src/client/slot-catalog.ts', klass: 'A', reason: 'Generated artifact: `pnpm run gen-client-catalog` must run after any slot declaration change (including the persistent-assistant directory, hero card, header, and example-chip slots); it carries the fork slots while their declarations stay in the owner packages.' },
  { path: 'packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx', klass: 'A', reason: 'Renders the fork hero chip row, the ask-knowledge picker and the ask-data/commerce gate takeover inside the official factory body; the slot framework binds `renderSlot` to the declaring entry, so no overlay can occupy these positions.' },
  { path: 'packages/client/ui-conversation/src/client/skeleton/ConversationMainPanel.tsx', klass: 'A', reason: 'Renders the atmosphere plate as the conversation root\'s first child; no official slot renders before `conversation.header`, and the plate needs the root as its positioning context.' },
  { path: 'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css', klass: 'A', reason: 'Layer order for the atmosphere plate (header/body above it) and the desktop window-chrome inset on the header.' },
  { path: 'packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx', klass: 'A', reason: 'Renders the fork headline slot with the official headline typography class as its fallback; the headline position is inside HeroShell, which exposes no slot.' },
  { path: 'packages/client/ui-conversation/src/client/contract/slots.ts', klass: 'A', reason: 'Declares the fork child slots and their injected occupancy hooks beside the owner registrations that render them.' },
  { path: 'packages/client/ui-conversation/src/client/index.ts', klass: 'A', reason: 'Re-exports the fork slot and owner-prop types declared in this package.' },
  { path: 'packages/client/ui-conversation/src/client/apply.ts', klass: 'A', reason: 'Declares the fork child slots under the conversation/content/composer registrations that render them, and exposes the gate-occupancy hooks those renderers read.' },
  { path: 'packages/client/ui-sidebar/src/client/SidebarRoot.tsx', klass: 'A', reason: 'The 会话/文件 region switch and the files pane are SidebarRoot layout; the official Files surface is the right-sidebar tab, so moving `sidebar.files` would move the file tree to another column.' },
  { path: 'packages/client/ui-sidebar/src/client/SidebarRoot.module.css', klass: 'A', reason: 'Styling for the fork region switch and panes.' },
  { path: 'packages/client/ui-sidebar/src/client/locales.ts', klass: 'A', reason: 'Region-tab labels for the fork 会话/文件 switch.' },
  { path: 'packages/client/ui-sidebar/src/client/contract/slots.ts', klass: 'A', reason: 'Declares `sidebar.files` and its occupancy hook beside the SidebarRoot registration that renders them.' },
  { path: 'packages/client/ui-sidebar/src/client/index.ts', klass: 'A', reason: 'Registers `sidebar.files` and binds the occupancy source SidebarRoot reads.' },
  { path: 'packages/client/ui-agent-preset/src/client/seat-store.ts', klass: 'A', reason: 'Hold/clear stage semantics (`held`, public `clearStage`) consumed by the ask-data and commerce gates; the official controller keeps its shared stage private.' },
  { path: 'packages/client/ui-agent-preset/src/client/index.ts', klass: 'A', reason: 'Provides the conversation-scoped `agentPresetSeat` service the fork gates call; the official package exposes no equivalent seam.' },
  { path: 'packages/core/session/src/known-event-types.ts', klass: 'A', reason: 'Generated session event vocabulary, including fork ask-data, ask-knowledge, commerce, media and assistant auxiliary inference records; regenerated from owner-package event declarations.' },
  { path: 'packages/core/system-prompt/src/index.ts', klass: 'A', reason: 'Fork external-data section in the system-prompt section order.' },
  { path: 'packages/session/session-format-v0-to-v1/src/dispositions.ts', klass: 'A', reason: "Frozen released-v0 inventory must admit this fork's four events (ask-data/bound, ask-knowledge/bound, ask-knowledge/unbound, commerce/bound), or the fork's own v0 fixtures refuse to migrate." },
  { path: 'packages/session/session-format-v0-to-v1/src/payload-validation.ts', klass: 'A', reason: 'Nested payload semantics for the same four events; the released validator refuses an event with no case.' },
  { path: 'packages/session/session-format-v0-to-v1/tests/validation.spec.ts', klass: 'A', reason: 'Valid fixture and inventory count for the four admitted events.' },
  { path: 'packages/session/session-format-v3-to-v4/src/extension-identities.ts', klass: 'A', reason: 'Frozen released-v3 vocabulary must admit the nine fork event types (ask-data, ask-knowledge, commerce, media) released while V3 was current; migrates and historical V3 reads share this constant.' },
  { path: 'packages/session/session-persistence-jsonl/src/index.ts', klass: 'A', reason: 'Fork data-safety rule: a released session generation migrates only after a verified pre-migration backup exists beside it.' },
  { path: 'packages/fs/fs/src/index.ts', klass: 'A', reason: 'Fork filesystem policy behaviour.' },
  { path: 'packages/fs/fs/src/invariant.ts', klass: 'A', reason: 'Fork filesystem invariant.' },
  { path: 'packages/fs/fs-observation-policy/src/index.ts', klass: 'A', reason: 'Fork observation policy.' },
  { path: 'packages/fs/tool-fs/src/error.ts', klass: 'A', reason: 'Fork filesystem tool error surface.' },
  { path: 'packages/fs/tool-fs/src/read.ts', klass: 'A', reason: 'Fork read tool behaviour.' },
  { path: 'packages/fs/tool-fs/src/read-target.ts', klass: 'A', reason: 'Fork read target resolution.' },
  { path: 'packages/fs/tool-fs/src/read-image.ts', klass: 'A', reason: 'Fork image read behaviour.' },
  { path: 'packages/fs/tool-fs/src/write.ts', klass: 'A', reason: 'Fork write tool behaviour.' },
  { path: 'packages/fs/tool-fs/src/edit.ts', klass: 'A', reason: 'Fork edit tool behaviour.' },
  { path: 'packages/fs/tool-str-replace-editor/src/index.ts', klass: 'A', reason: 'Fork string replace editor behaviour.' },
  { path: 'packages/boot/app-boot/src/profile.ts', klass: 'A', reason: "The fork's profile resolution." },
  { path: 'packages/llm/llm-pi-ai/package.json', klass: 'A', reason: 'Fork pins @earendil-works/pi-ai at ^1.3.0 for the desktop model catalog (0.87.1 predates the opencode free models); the streaming-arguments patch and release-age exception that travel with the pin live in patches/ and pnpm-workspace.yaml.' },
  { path: 'packages/llm/llm-pi-ai/src/catalog.ts', klass: 'A', reason: "Mechanical drift-gate classification for pi-ai 1.3.0's new OpenAIResponsesCompat field supportsMidConvoEffort (withhold), required for catalog.ts to compile against the upgraded upstream type." },
  { path: 'packages/preset/agent-preset-registry/src/index.ts', klass: 'A', reason: 'Ported fork admitSelect hook (was agent-presets before the upstream split): the data-source gate must run before every preset swap, including a direct Remote select.' },
  { path: 'packages/preset/agent-preset-registry/src/definition.ts', klass: 'A', reason: 'Fork `listed` flag on PresetDefinition: the 公益项目助手 preset installs through the profile seed while its roster menu entry stays on the fork capabilities chip, so the menu omits it but id selection still works.' },
  { path: 'packages/web/tool-web/src/search.ts', klass: 'A', reason: 'Fork web search behaviour.' },
  { path: 'packages/web/tool-web/src/fetch.ts', klass: 'A', reason: 'Fork web fetch behaviour.' },
  { path: 'packages/web/tool-web/src/trust.ts', klass: 'A', reason: 'Fork web trust policy.' },
  { path: 'packages/subagent/subagent/src/child-agent.ts', klass: 'A', reason: 'Fork child agent adjustment.' },
  { path: 'packages/session-query/tool-session-query/src/workspace-access.ts', klass: 'A', reason: "Fork scope authority: an assistant- or team-bound caller authorizes session-history targets through the assistant registry's binding scope instead of equal-cwd workspace membership; unbound callers keep the upstream cwd rule." },
  { path: 'packages/test-support/session-snapshot/src/identity.ts', klass: 'A', reason: 'Fork identity redaction: prefixed opaque ids generated inside tool-result text (for example an assistant profile id) must be claimable by shape so a fork scenario fixture stays a normalization fixed point.' },
  { path: 'packages/subagent/subagent/src/continuation-activation.ts', klass: 'A', reason: 'Fork child-agent composition adjustment for continuable activations.' },
  { path: 'packages/subagent/subagent-in-process-driver/src/index.ts', klass: 'A', reason: 'Fork child-agent composition adjustment for in-process runs.' },
  { path: 'packages/subagent/tool-subagent/src/index.ts', klass: 'A', reason: 'Fork model-selection re-exports for the delegation policy.' },
  { path: 'packages/extensions/tool-cordis/src/api-catalog.ts', klass: 'A', reason: 'Fork tool and service catalog entries, including the assistant registry service and its remotes.' },
  { path: 'packages/bundle/base/package.json', klass: 'A', reason: 'Fork base composition dependencies, including telemetry.' },
  { path: 'packages/bundle/base/cordis.patch.yml', klass: 'A', reason: 'Fork base composition rows, including the telemetry mode default.' },
  { path: 'packages/bundle/web-app/package.json', klass: 'A', reason: 'Fork web composition dependencies.' },
  { path: 'packages/bundle/web-app/cordis.patch.yml', klass: 'A', reason: 'Fork web composition rows.' },
  { path: 'packages/api/remotes/package.json', klass: 'A', reason: 'Never-merge policy: the product-analytics dependency and registration are stripped from the remotes assembly.' },
  { path: 'packages/api/remotes/src/client/index.ts', klass: 'A', reason: 'Never-merge policy: the product-analytics client registration is stripped.' },
  { path: 'packages/client/ui-chat/package.json', klass: 'A', reason: 'Never-merge policy: the product-analytics consumer dependency is stripped.' },
  { path: 'packages/client/ui-chat/src/client/apply.ts', klass: 'A', reason: 'Never-merge policy: the product-analytics analytics call is stripped from chat apply.' },
  { path: 'packages/client/ui-conversation/package.json', klass: 'A', reason: 'Never-merge policy: the product-analytics consumer dependency is stripped.' },
  { path: 'packages/client/ui-conversation/src/client/input/hub.ts', klass: 'A', reason: 'Never-merge policy: the product-analytics analytics call is stripped from the input hub.' },
  { path: 'packages/client/ui-model-selection/package.json', klass: 'A', reason: 'Never-merge policy: the product-analytics consumer dependency is stripped.' },
  { path: 'packages/client/ui-model-selection/src/client/directory.ts', klass: 'A', reason: 'Never-merge policy: the product-analytics analytics call is stripped from model directory.' },
  { path: 'packages/client/ui-model-selection/src/client/service.ts', klass: 'A', reason: 'Never-merge policy: the product-analytics analytics call is stripped from model selection.' },
  { path: 'packages/client/ui-plugin-manager/package.json', klass: 'A', reason: 'Never-merge policy: the product-analytics consumer dependency is stripped.' },
  { path: 'packages/client/ui-plugin-manager/src/client/index.ts', klass: 'A', reason: 'Never-merge policy: the product-analytics analytics call is stripped from the plugin manager.' },
  { path: 'packages/client/ui-plugin-manager/src/client/manager-store.ts', klass: 'A', reason: 'Never-merge policy: the product-analytics analytics call is stripped from the manager store.' },
  { path: 'packages/client/ui-settings-account/package.json', klass: 'A', reason: 'Never-merge policy: the product-analytics consumer dependency is stripped.' },
  { path: 'packages/client/ui-settings-account/src/client/DesktopOnboarding.tsx', klass: 'A', reason: 'The fork desktop onboarding surface replacing the account-bound onboarding; never-merge account policy.' },
  { path: 'packages/client/ui-settings-account/src/client/index.ts', klass: 'A', reason: 'Never-merge policy: the product-analytics wiring and account onboarding are stripped.' },
  { path: 'packages/client/ui-settings-account/src/client/onboarding-contract.ts', klass: 'A', reason: 'The fork desktop onboarding contract; never-merge account policy.' },
  { path: 'packages/client/ui-settings-models/package.json', klass: 'A', reason: 'Never-merge policy: the product-analytics consumer dependency is stripped.' },
  { path: 'packages/client/ui-settings-models/src/client/DeepSeekOnboardingDialog.tsx', klass: 'A', reason: 'The fork model-provider onboarding dialog replacing the account-bound flow.' },
  { path: 'packages/client/ui-settings-models/src/client/index.ts', klass: 'A', reason: 'Never-merge policy: the product-analytics wiring is stripped from settings models.' },
  { path: 'packages/client/ui-sidebar/package.json', klass: 'A', reason: 'Never-merge policy: the product-analytics consumer dependency is stripped.' },
  { path: 'packages/client/ui-workspace/package.json', klass: 'A', reason: 'Never-merge policy: the product-analytics consumer dependency is stripped.' },
  { path: 'packages/client/ui-workspace/src/client/index.ts', klass: 'A', reason: 'Never-merge policy: the product-analytics analytics call is stripped from workspace.' },
]

/**
 * Telemetry and account rows that exist today and what must change. Recording
 * an outstanding change here is deliberate: the gate's job is to prevent an
 * *unrecorded* surface, and this table makes the debt visible instead of
 * failing the tree before the change lands.
 */
export const MOUNTS: readonly MountEntry[] = [
  {
    composition: 'packages/bundle/base/package.json',
    row: '@deepseek-ai/dsh-otel',
    packageName: '@deepseek-ai/dsh-otel',
    requiredChange: 'Restores upstream OTel SDK bootstrap the hop-4 merge dropped: the telemetry backends inject the otel service it provides. The package carries no endpoint or export of its own; collector defaults stay governed by the telemetry rows.',
  },
  {
    composition: 'packages/bundle/base/cordis.patch.yml',
    row: 'otel',
    packageName: '@deepseek-ai/dsh-otel',
    requiredChange: 'Applied 2026-10-08: the bootstrap row sits beside the telemetry backend; removing it leaves every telemetry plugin pending and the shipped-profile e2e classes hang or fail.',
  },
  {
    composition: 'packages/bundle/base/package.json',
    row: '@deepseek-ai/dsh-session-telemetry-otel',
    packageName: '@deepseek-ai/dsh-session-telemetry-otel',
    requiredChange: 'Keep the dependency: the base composition owns the fork telemetry mode and endpoint policy, so the package stays mounted while defaulting to DISABLED.',
  },
  {
    composition: 'packages/bundle/base/cordis.patch.yml',
    row: 'session-telemetry-otel',
    packageName: '@deepseek-ai/dsh-session-telemetry-otel',
    requiredChange: 'Applied 2026-10-06: the mode default is DISABLED and the exporter URL has no default, so an upload mode requires an explicitly configured endpoint. Any upstream collector default reintroduced by a merge is a violation.',
  },
]

/**
 * Directories upstream authors and the fork has no files in, so any file under
 * one is a violation. `apps/desktop/` is deliberately absent: that path is
 * collided, and the fork owns almost all of it. The collided tree is guarded by
 * exact `NEVER_MERGE` files plus `FORBIDDEN_DEPENDENCIES` instead, because an
 * enumeration of upstream's Electron tree would rot on the next upstream
 * commit while the dependency rule does not.
 */
export const UPSTREAM_ONLY_DIRECTORIES: readonly string[] = [
  'apps/desktop-host/',
  'apps/desktop/installer/',
  'apps/desktop/scripts/',
  'packages/client/product-analytics/',
]

/**
 * Dependencies whose presence in a fork-owned manifest means upstream's
 * Electron product was adopted. This is the collided-path invariant: the fork's
 * `apps/desktop` may hold any files it likes as long as it does not become
 * upstream's Electron application.
 */
export const FORBIDDEN_DEPENDENCIES: readonly string[] = [
  'electron',
  'electron-builder',
  'electron-updater',
]

/**
 * Manifests where `FORBIDDEN_DEPENDENCIES` must not appear, with the reason the
 * manifest is checked at all.
 */
export const GUARDED_MANIFESTS: readonly string[] = [
  'apps/desktop/package.json',
]

/** Package names whose appearance in a release composition requires a MOUNTS row. */
export const GATED_PACKAGE_NAMES: readonly string[] = [
  '@deepseek-ai/dsh-session-telemetry-otel',
  '@deepseek-ai/dsh-otel',
  '@deepseek-ai/dsh-host-product-telemetry-otel',
  '@deepseek-ai/dsh-client-product-analytics',
]

/** Compositions that ship to users. A gated package anywhere else is inert. */
export const RELEASE_COMPOSITIONS: readonly string[] = [
  'packages/bundle/base/package.json',
  'packages/bundle/base/cordis.patch.yml',
  'packages/bundle/web-app/package.json',
  'packages/bundle/web-app/cordis.patch.yml',
]

/** Upstream collectors the fork never contacts. */
export const FORBIDDEN_ENDPOINTS: readonly ForbiddenEndpoint[] = [
  { host: 'harness-telemetry.deepseeksvc.com', owner: 'upstream DeepSeek harness telemetry' },
  { host: 'dsh-otel-collector.deepseeksvc.com', owner: 'upstream DeepSeek OTel collector' },
  { host: 'deepseeksvc.com', owner: 'upstream DeepSeek service domain' },
]

/** Packages upstream removed after the fork split; each carries the owner's decision. */
export const REMOVALS: readonly RemovalEntry[] = [
  {
    path: 'packages/e2b',
    disposition: 'follow-upstream-deletion',
    reason: 'POC family absent from every shipped composition; owner confirmed following the upstream deletion on 2026-10-07.',
  },
  {
    path: 'packages/code-runtime',
    disposition: 'follow-upstream-deletion',
    reason: 'Owner confirmed 2026-10-07: follow the upstream deletion, unmounting dsh-code-runtime-worker-thread from the headless and web-app bundles with it.',
  },
  {
    path: 'packages/runtime-diagnostics',
    disposition: 'follow-upstream-deletion',
    reason: 'Invariant checks the fork mounts nowhere; owner confirmed following the upstream deletion on 2026-10-07.',
  },
]
