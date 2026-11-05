/**
 * Handwritten declarations for `bundled-skill-files.mjs`, mirroring the repo
 * convention of `seed-desktop-profile-plugin.d.mts` next to a scripts `.mjs`.
 */

/** One declared payload requirement. */
export type SkillRequirement =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'text'; readonly path: string; readonly text: string }

/** One validated pin entry. */
export interface BundledSkillEntry {
  readonly name: string
  readonly requirements: readonly SkillRequirement[]
}

export declare const REQUIRED_SKILL_ENTRY_FILE: 'SKILL.md'

/** Accepted skill `name` syntax: one lower-kebab segment, e.g. `team-orchestration`. */
export declare const SKILL_NAME_PATTERN: RegExp

/**
 * Validate one pinned skill `name` as a single safe path segment before any
 * join or copy.
 * @param name - declared skill name.
 * @param index - element position in the pin's `skills` array.
 * @throws when the name is empty or not one lower-kebab segment.
 */
export function validatedSkillName(name: unknown, index: number): string

/**
 * Validate a declared skill-relative path and return it unchanged.
 * @param skillName - owning skill name, for the error message.
 * @param relative - declared path relative to the skill directory.
 * @param field - manifest field the path was declared in, for the error message.
 * @throws when the path escapes the skill directory or has empty segments.
 */
export function validatedSkillRelativePath(skillName: string, relative: string, field: string): string

/**
 * Validate one raw pin entry and normalize its declared requirements.
 * @param entry - raw JSON entry from desktop-bundled-skills.json.
 * @param index - entry position, for the error message.
 * @throws when the entry has unknown fields or mistyped requirement arrays.
 */
export function validatedSkillEntry(entry: object, index: number): BundledSkillEntry

/**
 * Read and validate the bundled-skills pin.
 * @param pinPath - absolute path to desktop-bundled-skills.json.
 * @throws when the file is missing, invalid JSON, or lists no skills.
 */
export function loadSkillPin(pinPath: string): { readonly skills: readonly BundledSkillEntry[]; readonly raw: readonly object[] }

/**
 * Collect payload violations for one skill directory under an assembled
 * bundled-skills root. Every violation names its exact relative path.
 * @param root - the assembled bundled-skills directory.
 * @param skill - validated pin entry.
 * @returns human-readable violations, empty when the payload is complete.
 */
export function collectSkillViolations(root: string, skill: BundledSkillEntry): string[]

/**
 * Validate a whole assembled payload against a loaded pin.
 * @param root - the assembled bundled-skills directory.
 * @param pin - loaded pin from {@link loadSkillPin}.
 * @returns all violations across every pinned skill.
 */
export function validateBundledSkills(root: string, pin: { readonly skills: readonly BundledSkillEntry[] }): string[]

/**
 * Absolute path of the repository's desktop-bundled-skills.json.
 */
export function defaultSkillPinPath(): string
