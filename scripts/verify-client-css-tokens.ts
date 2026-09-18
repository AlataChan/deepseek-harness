/**
 * Reject `var(--dsw-…)` references that `ui-theme` never declares.
 *
 * Workbench CSS invented alias names that looked real and fell back to
 * literals (or to nothing). A source-level check keeps that class of bug
 * from returning. Pre-existing undeclared uses outside the workbench files
 * sit on a ratchet allowlist: each pair must still exist, and a new pair
 * fails. Removing a phantom from a file requires dropping its allowlist row
 * in the same change.
 */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const THEME_GLOB = 'packages/client/ui-theme/src/styles/**/*.css'
const SOURCE_GLOB = 'packages/*/*/src/**/*.css'
const MINIMUM_SOURCE_SHEETS = 80
const TOKEN = '--dsw-[a-z0-9]+(?:-[a-z0-9]+)*'
const DECLARATION = new RegExp(`${TOKEN}\\s*:`, 'g')
const REFERENCE = new RegExp(`var\\(\\s*(${TOKEN})`, 'g')
const COMMENT = /\/\*[\s\S]*?\*\//g

/**
 * Pre-existing undeclared `file::token` pairs. Workbench sheets that this
 * change repaired are not listed. A pair that disappears is a stale row.
 */
export const KNOWN_UNDECLARED = [
  'packages/client/ui-agent-preset/src/client/AgentPresetLabel.module.css::--dsw-alias-fill-tsp-secondary',
  'packages/client/ui-agent-preset/src/client/AgentPresetSeat.module.css::--dsw-alias-label-quaternary',
  'packages/client/ui-agent-preset/src/client/AgentPresetSection.module.css::--dsw-font-mono',
  'packages/client/ui-chat/src/client/chat/StatsLine.module.css::--dsw-alias-separator-primary',
  'packages/client/ui-jobs/src/client/JobListAction.module.css::--dsw-alias-fill-l2',
  'packages/client/ui-jobs/src/client/JobListAction.module.css::--dsw-font-mono',
  'packages/client/ui-primitives/src/HoverCard.module.css::--dsw-hovercard-bg',
  'packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.module.css::--dsw-alias-state-warning-primary',
  'packages/client/ui-settings-plugins/src/client/PluginCard.module.css::--dsw-alias-label-error',
  'packages/client/ui-settings-plugins/src/client/SubagentModelSelectionCard.module.css::--dsw-alias-bg-layer-4',
  'packages/client/ui-settings-plugins/src/client/SubagentModelSelectionCard.module.css::--dsw-alias-label-error',
  'packages/client/ui-settings-plugins/src/client/fields.module.css::--dsw-alias-label-error',
  'packages/client/ui-tool/src/client/tool/components/ToolRow.module.css::--dsw-font-sm-13',
  'packages/experimental/client-ui-agent-team/src/client/TeamAction.module.css::--dsw-alias-fill-l1',
  'packages/experimental/client-ui-agent-team/src/client/TeamAction.module.css::--dsw-alias-fill-l2',
  'packages/experimental/client-ui-agent-team/src/client/TeamAction.module.css::--dsw-alias-interactive-label',
  'packages/experimental/desktop-files/src/client/FileTree.module.css::--dsw-alias-status-error',
] as const

/** One undeclared `var(--dsw-…)` use. */
export interface UndeclaredToken {
  /** Repository-relative CSS path, POSIX separators. */
  readonly file: string
  /** Custom property the sheet referenced. */
  readonly token: string
}

/**
 * Strip CSS comments so `var(--dsw-elevation-*)` documentation is not a use.
 * @param source - raw stylesheet text.
 * @returns the same text without block comments.
 */
export function stripCssComments(source: string): string {
  return source.replace(COMMENT, '')
}

/**
 * Collect `--dsw-*` names declared in theme source.
 * @param source - comment-stripped theme CSS.
 * @returns declared custom-property names.
 */
export function collectDeclaredTokens(source: string): Set<string> {
  const names = new Set<string>()
  for (const match of source.matchAll(DECLARATION)) {
    names.add(match[0].replace(/\s*:$/, ''))
  }
  return names
}

/**
 * Collect `--dsw-*` names referenced through `var(...)`.
 * @param source - comment-stripped stylesheet text.
 * @returns referenced custom-property names.
 */
export function collectReferencedTokens(source: string): Set<string> {
  const names = new Set<string>()
  for (const match of source.matchAll(REFERENCE)) {
    const name = match[1]
    /* v8 ignore next -- REFERENCE always captures the token name */
    if (name === undefined) continue
    names.add(name)
  }
  return names
}

/**
 * Diff one sheet's `var(--dsw-…)` uses against the theme declaration set.
 * @param file - repository-relative path.
 * @param source - raw stylesheet text.
 * @param declared - names declared in `ui-theme` styles.
 * @returns undeclared uses in that file.
 */
export function undeclaredTokensIn(
  file: string,
  source: string,
  declared: ReadonlySet<string>,
): UndeclaredToken[] {
  const tokens = [...collectReferencedTokens(stripCssComments(source))]
    .filter(token => !declared.has(token))
    .sort()
  return tokens.map(token => ({ file, token }))
}

/**
 * Load every theme declaration and every package `src` stylesheet.
 * @returns declared names, scanned files, and undeclared uses.
 */
export function scanClientCssTokens(): {
  declared: Set<string>
  files: string[]
  undeclared: UndeclaredToken[]
} {
  const themeFiles = globSync(THEME_GLOB, { cwd: root }).map(file => file.replaceAll('\\', '/'))
  const declared = new Set<string>()
  for (const file of themeFiles) {
    for (const name of collectDeclaredTokens(stripCssComments(readFileSync(resolve(root, file), 'utf8')))) {
      declared.add(name)
    }
  }
  const files = globSync(SOURCE_GLOB, { cwd: root })
    .map(file => file.replaceAll('\\', '/'))
    .filter(file => !file.includes('/lib/'))
    .sort()
  const undeclared: UndeclaredToken[] = []
  for (const file of files) {
    undeclared.push(...undeclaredTokensIn(file, readFileSync(resolve(root, file), 'utf8'), declared))
  }
  return { declared, files, undeclared }
}

/**
 * Classify live undeclared uses against the ratchet allowlist.
 * @param undeclared - uses found in the current tree.
 * @param allowlist - known pre-existing pairs.
 * @returns new pairs and allowlist rows that no longer match.
 */
export function classifyUndeclared(
  undeclared: readonly UndeclaredToken[],
  allowlist: readonly string[] = KNOWN_UNDECLARED,
): { fresh: UndeclaredToken[]; stale: string[] } {
  const found = new Set(undeclared.map(item => `${item.file}::${item.token}`))
  const allowed = new Set(allowlist)
  const fresh = undeclared.filter(item => !allowed.has(`${item.file}::${item.token}`))
  const stale = allowlist.filter(row => !found.has(row))
  return { fresh, stale }
}

function main(): void {
  const { declared, files, undeclared } = scanClientCssTokens()
  if (files.length < MINIMUM_SOURCE_SHEETS) {
    console.error(
      `verify-client-css-tokens: discovery narrowed to ${String(files.length)} stylesheet(s); expected at least ${String(MINIMUM_SOURCE_SHEETS)}.`,
    )
    process.exit(1)
  }
  if (declared.size === 0) {
    console.error('verify-client-css-tokens: ui-theme declared no --dsw tokens.')
    process.exit(1)
  }
  const { fresh, stale } = classifyUndeclared(undeclared)
  if (fresh.length > 0 || stale.length > 0) {
    if (fresh.length > 0) {
      console.error('verify-client-css-tokens: undeclared --dsw token(s):')
      for (const item of fresh) {
        console.error(`  ${item.file}: ${item.token}`)
      }
    }
    if (stale.length > 0) {
      console.error('verify-client-css-tokens: stale allowlist row(s):')
      for (const row of stale) {
        console.error(`  ${row}`)
      }
    }
    process.exit(1)
  }
  console.log(
    `verify-client-css-tokens: ${String(files.length)} stylesheet(s) use ${String(declared.size)} theme tokens; ${String(KNOWN_UNDECLARED.length)} pre-existing undeclared pair(s) remain allowlisted.`,
  )
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  main()
}
