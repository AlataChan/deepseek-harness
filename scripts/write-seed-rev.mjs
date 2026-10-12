#!/usr/bin/env node
/**
 * Record the content revision of the seeded desktop payload.
 *
 * `resources/seed-rev.txt` hashes every file path and byte below
 * `profile-plugins/` and `bundled-skills/` in sorted relative-path order. The
 * desktop shell compares that revision with the stamp a completed seed writes,
 * and skips the copy while they match, so any payload change forces a reseed.
 * A symlink contributes its target text instead of copied bytes. Known
 * ceiling: an empty payload directory contributes nothing, so adding or
 * removing one does not change the revision.
 *
 * Usage: node scripts/write-seed-rev.mjs <resources-dir>
 */

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const SEED_DIRS = ['profile-plugins', 'bundled-skills']

const [resourcesArg] = process.argv.slice(2)
if (resourcesArg === '--help' || resourcesArg === '-h') {
  console.log('usage: node scripts/write-seed-rev.mjs <resources-dir>')
  process.exit(0)
}
if (resourcesArg === undefined || resourcesArg.startsWith('--')) {
  console.error('usage: node scripts/write-seed-rev.mjs <resources-dir>')
  process.exit(2)
}
const resources = resolve(resourcesArg)

/**
 * Every file below one seeded directory, labeled by its path under `resources`
 * with `/` separators so the revision is identical across build platforms.
 * @param name - the seed directory name.
 * @returns label and absolute path per file.
 */
function collect(name) {
  const root = join(resources, name)
  if (!existsSync(root)) {
    console.error(`write-seed-rev: missing seeded directory ${root} — run the seed phases first`)
    process.exit(1)
  }
  const found = []
  /** @param dir - directory to walk. */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else found.push({ label: `${name}/${relative(root, path).split(sep).join('/')}`, path })
    }
  }
  walk(root)
  return found
}

const entries = SEED_DIRS
  .flatMap(collect)
  .sort((left, right) => (left.label < right.label ? -1 : left.label > right.label ? 1 : 0))

const revision = createHash('sha256')
for (const entry of entries) {
  revision.update(`file ${entry.label}\n`)
  // A symlink hashes as its target so a retargeted link changes the revision.
  if (lstatSync(entry.path).isSymbolicLink()) revision.update(`link ${readlinkSync(entry.path)}\n`)
  else revision.update(readFileSync(entry.path))
}

const digest = revision.digest('hex')
writeFileSync(join(resources, 'seed-rev.txt'), `${digest}\n`)
console.log(`seed-rev.txt written (${digest})`)
