#!/usr/bin/env node
/**
 * Validate an assembled bundled-skills directory against the pin.
 *
 * The actual DMG verifier (scripts/verify-desktop-bundle.sh) and the Windows
 * verifier (scripts/verify-desktop-exe.mjs) both call this manifest-driven
 * validator instead of keeping hardcoded per-skill shell blocks; the seeder
 * shares the same declared requirements through scripts/bundled-skill-files.mjs.
 *
 * Usage:
 *   node scripts/verify-desktop-bundled-skills.mjs --root <bundled-skills-directory> [--pin <pin.json>]
 *
 * Exit 0 when every pinned skill payload is complete; exit 1 with one line per
 * violation naming the exact relative path otherwise.
 */

import { defaultSkillPinPath, loadSkillPin, validateBundledSkills } from './bundled-skill-files.mjs'

function parseArgs(argv) {
  let root
  let pin
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') root = argv[++i]
    else if (argv[i] === '--pin') pin = argv[++i]
  }
  if (!root) {
    console.error('usage: node scripts/verify-desktop-bundled-skills.mjs --root <bundled-skills-directory> [--pin <pin.json>]')
    process.exit(2)
  }
  return { root, pin: pin ?? defaultSkillPinPath() }
}

const { root, pin: pinPath } = parseArgs(process.argv.slice(2))
try {
  const pin = loadSkillPin(pinPath)
  const violations = validateBundledSkills(root, pin)
  if (violations.length > 0) {
    for (const violation of violations) console.error(`✗ ${violation}`)
    process.exit(1)
  }
  console.log(`✓ ${pin.skills.length} bundled skill(s) match desktop-bundled-skills.json requirements`)
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
