/**
 * Shared manifest-driven payload requirements for fork-owned bundled skills.
 *
 * scripts/desktop-bundled-skills.json declares every per-skill payload
 * requirement; the seeder and the assembled-bundle verifiers both consume this
 * module so the two packaging paths share one rule set. Checks are manifest
 * driven — never helper branches keyed by skill name:
 *
 * - `requiredFiles`: file paths that must exist inside the seeded skill.
 * - `requiredDirectories`: directory payloads that must exist.
 * - `requiredText`: `{ file, text }` entries requiring a literal inside a file.
 *
 * `SKILL.md` is a uniform base requirement for every bundled skill and is not
 * declared per entry. The seeder keeps its own SKILL.md/package.json source
 * checks; this module validates seeded and assembled payloads.
 * @module scripts/bundled-skill-files
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, posix, resolve } from 'node:path'
/**
 * One declared payload requirement.
 * @typedef {{ kind: 'file' | 'directory' | 'text', path: string, text?: string }} SkillRequirement
 */

/** Uniform per-skill base requirement: a bundled skill must be discoverable. */
export const REQUIRED_SKILL_ENTRY_FILE = 'SKILL.md'

/**
 * Validate one workspace-relative skill path declared by the manifest before
 * any join. Paths are POSIX-style relative to the skill directory.
 * @param {string} skillName - owning skill, for error messages.
 * @param {string} relative - declared path relative to the skill directory.
 * @param {string} field - manifest field being validated, for error messages.
 * @returns the validated POSIX relative path.
 */
export function validatedSkillRelativePath(skillName, relative, field) {
  const fail = (reason) => {
    throw new Error(`desktop-bundled-skills.json: ${skillName}.${field} ${JSON.stringify(relative ?? null)} ${reason}`)
  }
  if (typeof relative !== 'string' || relative === '') fail('must be a non-empty string')
  if (relative.includes('\\')) fail('must use POSIX / separators')
  if (isAbsolute(relative) || relative.startsWith('/')) fail('must be a relative path')
  const segments = relative.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    fail('must not contain empty, ".", or ".." segments')
  }
  return segments.join(posix.sep)
}

/** Accepted skill `name` syntax: one lower-kebab segment, e.g. `team-orchestration`. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Validate one pinned skill `name` as a single safe path segment before any
 * join or copy. The name becomes a directory under the seeded output and the
 * assembled payload root, so anything beyond one lower-kebab segment
 * (separators, dot segments, case, empty) is rejected.
 * @param {unknown} name - declared skill name.
 * @param {number} index - element position in the pin's `skills` array.
 * @returns the validated name.
 */
export function validatedSkillName(name, index) {
  const where = `desktop-bundled-skills.json: skills[${index}]`
  if (typeof name !== 'string' || name === '') throw new Error(`${where} needs a name`)
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(`${where} name ${JSON.stringify(name)} must be one lower-kebab segment (a-z, 0-9, single "-")`)
  }
  return name
}

/**
 * Validate one pinned skill entry's shape and return its normalized payload
 * requirements. Unknown requirement fields fail loud instead of being skipped.
 * @param {unknown} entry - one element of the pin's `skills` array.
 * @param {number} index - element position, for error messages.
 * @returns {{
 *   name: string,
 *   requirements: SkillRequirement[],
 * }}
 */
export function validatedSkillEntry(entry, index) {
  const where = `desktop-bundled-skills.json: skills[${index}]`
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new Error(`${where} must be an object`)
  }
  const name = validatedSkillName(entry.name, index)
  const knownFields = new Set(['name', 'path', 'source', 'package', 'version', 'skillSubpath', 'requiredFiles', 'requiredDirectories', 'requiredText'])
  for (const field of Object.keys(entry)) {
    if (!knownFields.has(field)) throw new Error(`${where} has unknown field "${field}"`)
  }
  const requirements = []
  const files = entry.requiredFiles ?? []
  if (!Array.isArray(files)) throw new Error(`${where}.requiredFiles must be an array`)
  for (const file of files) {
    requirements.push({ kind: 'file', path: validatedSkillRelativePath(name, file, 'requiredFiles') })
  }
  const directories = entry.requiredDirectories ?? []
  if (!Array.isArray(directories)) throw new Error(`${where}.requiredDirectories must be an array`)
  for (const directory of directories) {
    requirements.push({ kind: 'directory', path: validatedSkillRelativePath(name, directory, 'requiredDirectories') })
  }
  const texts = entry.requiredText ?? []
  if (!Array.isArray(texts)) throw new Error(`${where}.requiredText must be an array`)
  for (const [textIndex, required] of texts.entries()) {
    if (typeof required !== 'object' || required === null) {
      throw new Error(`${where}.requiredText[${textIndex}] must be an object with file and text`)
    }
    const file = validatedSkillRelativePath(name, required.file, `requiredText[${textIndex}].file`)
    if (typeof required.text !== 'string' || required.text === '') {
      throw new Error(`${where}.requiredText[${textIndex}].text must be a non-empty string`)
    }
    requirements.push({ kind: 'text', path: file, text: required.text })
  }
  return { name, requirements }
}

/**
 * Read and validate the bundled-skills pin.
 * @param {string} pinPath - absolute path to desktop-bundled-skills.json.
 * @returns {{ skills: Array<{ name: string, requirements: SkillRequirement[] }>, raw: Array<object> }}
 */
export function loadSkillPin(pinPath) {
  if (!existsSync(pinPath)) throw new Error(`missing ${pinPath}`)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(pinPath, 'utf8'))
  } catch (error) {
    throw new Error(`desktop-bundled-skills.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.skills) || parsed.skills.length === 0) {
    throw new Error('desktop-bundled-skills.json must list at least one skill')
  }
  const skills = parsed.skills.map((entry, index) => validatedSkillEntry(entry, index))
  const seen = new Set()
  for (const [index, skill] of skills.entries()) {
    if (seen.has(skill.name)) {
      throw new Error(`desktop-bundled-skills.json: skills[${index}] duplicates skill name "${skill.name}"`)
    }
    seen.add(skill.name)
  }
  return { skills, raw: parsed.skills }
}

/**
 * Collect payload violations for one skill directory under an assembled
 * bundled-skills root. Every violation names its exact relative path.
 * @param {string} root - the assembled bundled-skills directory.
 * @param {{ name: string, requirements: SkillRequirement[] }} skill - validated pin entry.
 * @returns {string[]} human-readable violations, empty when the payload is complete.
 */
export function collectSkillViolations(root, skill) {
  const violations = []
  const skillDir = join(root, skill.name)
  if (!existsSync(skillDir)) {
    return [`bundled-skills/${skill.name} missing from bundled-skills payload`]
  }
  for (const relative of [REQUIRED_SKILL_ENTRY_FILE, ...skill.requirements.map(requirement => requirement.path)]) {
    if (!existsSync(join(skillDir, relative))) {
      violations.push(`bundled-skills/${skill.name}/${relative} missing from bundled-skills payload`)
    }
  }
  const entryPath = join(skillDir, REQUIRED_SKILL_ENTRY_FILE)
  if (existsSync(entryPath) && !statSync(entryPath).isFile()) {
    violations.push(`bundled-skills/${skill.name}/${REQUIRED_SKILL_ENTRY_FILE} must be a file`)
  }
  for (const requirement of skill.requirements) {
    if (requirement.kind === 'file') {
      const path = join(skillDir, requirement.path)
      if (existsSync(path) && !statSync(path).isFile()) {
        violations.push(`bundled-skills/${skill.name}/${requirement.path} must be a file`)
      }
    }
    if (requirement.kind === 'directory') {
      const path = join(skillDir, requirement.path)
      if (existsSync(path) && !statSync(path).isDirectory()) {
        violations.push(`bundled-skills/${skill.name}/${requirement.path} must be a directory`)
      }
    }
    if (requirement.kind === 'text') {
      const path = join(skillDir, requirement.path)
      if (!existsSync(path)) continue
      if (!statSync(path).isFile()) {
        violations.push(`bundled-skills/${skill.name}/${requirement.path} must be a file`)
        continue
      }
      if (!readFileSync(path, 'utf8').includes(requirement.text)) {
        violations.push(`bundled-skills/${skill.name}/${requirement.path} does not contain the required text ${JSON.stringify(requirement.text)} declared in desktop-bundled-skills.json`)
      }
    }
  }
  return violations
}

/**
 * Validate an assembled bundled-skills directory against the pin.
 * @param {string} root - the assembled bundled-skills directory.
 * @param {{ skills: Array<object> }} pin - parsed pin from {@link loadSkillPin}.
 * @returns {string[]} all violations across pinned skills, empty when complete.
 */
export function validateBundledSkills(root, pin) {
  return pin.skills.flatMap(skill => collectSkillViolations(root, skill))
}

/** Absolute path of this repository's bundled-skills pin. */
export function defaultSkillPinPath() {
  return resolve(import.meta.dirname, 'desktop-bundled-skills.json')
}
