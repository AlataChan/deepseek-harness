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
 * The upstream tag this branch has merged through (hop 2 of 4). The intake
 * command diffs the working tree against this pin to compute the upstream
 * files the fork edits, so the merge-time rules always run.
 */
export const UPSTREAM_PIN = 'dsh-v0.1.5-alpha.1'

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
  { path: 'packages/acp/acp/src/index.ts', klass: 'A', reason: 'Fork ACP initialize fix: answer only after the Loader tree settles.' },
  { path: 'packages/api/session-controller/src/index.ts', klass: 'A', reason: "The fork's ask-data, ask-knowledge and commerce remotes." },
  { path: 'packages/api/session-controller/src/agent.ts', klass: 'A', reason: 'Companion agent surface for the fork remotes.' },
  { path: 'packages/api/session-controller/src/ask-data.ts', klass: 'A', reason: 'Ask-data remote implementation.' },
  { path: 'packages/api/session-controller/src/ask-knowledge.ts', klass: 'A', reason: 'Ask-knowledge remote implementation.' },
  { path: 'packages/api/session-controller/src/commerce.ts', klass: 'A', reason: 'Commerce remote implementation.' },
  { path: 'packages/api/session-controller/src/types.ts', klass: 'A', reason: 'Fork remote and media error codes in the Typert protocol declaration.' },
  { path: 'packages/extensions/cordis-client-runner/src/client/slot-catalog.ts', klass: 'B', reason: 'Fork slots declared in the upstream catalog instead of as overlay registrations.' },
  { path: 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx', klass: 'B', reason: 'Fork input surface, pending an official conversation slot.' },
  { path: 'packages/client/ui-conversation/src/client/skeleton/InputBar.module.css', klass: 'B', reason: 'Styling for the fork input surface.' },
  { path: 'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx', klass: 'B', reason: 'Fork conversation root, pending an official slot.' },
  { path: 'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css', klass: 'B', reason: 'Styling for the fork conversation root and hero atmosphere.' },
  { path: 'packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx', klass: 'B', reason: 'Hero atmosphere occupant, pending an official slot.' },
  { path: 'packages/client/ui-conversation/src/client/locales.ts', klass: 'B', reason: 'Fork locale strings for the input, attachment and atmosphere surface.' },
  { path: 'packages/client/ui-conversation/src/client/contract/slots.ts', klass: 'B', reason: 'Fork slot declarations inside the upstream contract file.' },
  { path: 'packages/client/ui-conversation/src/client/contract/input.ts', klass: 'B', reason: 'Fork input contract extension.' },
  { path: 'packages/client/ui-conversation/src/client/input/facade.ts', klass: 'B', reason: 'Fork input facade behaviour.' },
  { path: 'packages/client/ui-conversation/src/client/apply.ts', klass: 'B', reason: 'Fork conversation plugin application.' },
  { path: 'packages/client/ui-conversation/src/client/index.ts', klass: 'B', reason: 'Fork conversation plugin entry.' },
  { path: 'packages/client/ui-sidebar/src/client/SidebarRoot.tsx', klass: 'B', reason: 'Fork sidebar chrome, pending ui-sidebar-right and ui-dockkit.' },
  { path: 'packages/client/ui-sidebar/src/client/SidebarRoot.module.css', klass: 'B', reason: 'Styling for the fork sidebar chrome and region tabs.' },
  { path: 'packages/client/ui-sidebar/src/client/locales.ts', klass: 'B', reason: 'Fork locale strings for the sidebar regions.' },
  { path: 'packages/client/ui-sidebar/src/client/contract/slots.ts', klass: 'B', reason: 'Fork sidebar slot declarations.' },
  { path: 'packages/client/ui-sidebar/src/client/index.ts', klass: 'B', reason: 'Fork sidebar plugin entry.' },
  { path: 'packages/client/ui-agent-preset/src/client/seat-store.ts', klass: 'B', reason: 'Fork seat store, pending upstream ui-agent-preset ownership.' },
  { path: 'packages/client/ui-agent-preset/src/client/index.ts', klass: 'B', reason: 'Fork preset-seat surface, pending upstream ui-agent-preset ownership.' },
  { path: 'packages/core/session/src/known-event-types.ts', klass: 'A', reason: "The fork's nine session events (ask-data, ask-knowledge, commerce, media) declared in the upstream known-event table." },
  { path: 'packages/core/system-prompt/src/index.ts', klass: 'A', reason: 'Fork external-data section in the system-prompt section order.' },
  { path: 'packages/session/session-format-v0-to-v1/src/dispositions.ts', klass: 'A', reason: "Frozen released-v0 inventory must admit this fork's four events (ask-data/bound, ask-knowledge/bound, ask-knowledge/unbound, commerce/bound), or the fork's own v0 fixtures refuse to migrate." },
  { path: 'packages/session/session-format-v0-to-v1/src/payload-validation.ts', klass: 'A', reason: 'Nested payload semantics for the same four events; the released validator refuses an event with no case.' },
  { path: 'packages/session/session-format-v0-to-v1/tests/validation.spec.ts', klass: 'A', reason: 'Valid fixture and inventory count for the four admitted events.' },
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
  { path: 'packages/preset/agent-presets/src/index.ts', klass: 'A', reason: 'Fork presets, including the data-source gate before the first ask-data prompt.' },
  { path: 'packages/web/tool-web/src/search.ts', klass: 'A', reason: 'Fork web search behaviour.' },
  { path: 'packages/web/tool-web/src/fetch.ts', klass: 'A', reason: 'Fork web fetch behaviour.' },
  { path: 'packages/web/tool-web/src/trust.ts', klass: 'A', reason: 'Fork web trust policy.' },
  { path: 'packages/subagent/subagent/src/child-agent.ts', klass: 'A', reason: 'Fork child agent adjustment.' },
  { path: 'packages/subagent/subagent/src/continuation-activation.ts', klass: 'A', reason: 'Fork child-agent composition adjustment for continuable activations.' },
  { path: 'packages/subagent/subagent-in-process-driver/src/index.ts', klass: 'A', reason: 'Fork child-agent composition adjustment for in-process runs.' },
  { path: 'packages/subagent/tool-subagent/src/index.ts', klass: 'A', reason: 'Fork model-selection re-exports for the delegation policy.' },
  { path: 'packages/extensions/tool-cordis/src/api-catalog.ts', klass: 'A', reason: 'Fork tool catalog entry.' },
  { path: 'packages/bundle/base/package.json', klass: 'A', reason: 'Fork base composition dependencies, including telemetry.' },
  { path: 'packages/bundle/base/cordis.patch.yml', klass: 'A', reason: 'Fork base composition rows, including the telemetry mode default.' },
  { path: 'packages/bundle/web-app/package.json', klass: 'A', reason: 'Fork web composition dependencies.' },
  { path: 'packages/bundle/web-app/cordis.patch.yml', klass: 'A', reason: 'Fork web composition rows.' },
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
