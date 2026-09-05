#!/usr/bin/env node
/**
 * Prepare fork-owned bundled skills for the octopus_DSH DMG.
 *
 * Reads scripts/desktop-bundled-skills.json. Each entry is either:
 * - workspace: `{ name, path }` — copy from the repo (WeChat extractor)
 * - npm: `{ name, source: "npm", package, version, skillSubpath }` — pack the
 *   npm identity and copy one skill directory (Archify)
 *
 * Then runs `npm install --omit=dev` when the skill declares dependencies, and
 * writes the result under --out (Resources/resources/bundled-skills/).
 *
 * Usage:
 *   node scripts/seed-desktop-bundled-skills.mjs --out <dir>
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const PIN_PATH = join(SCRIPT_DIR, 'desktop-bundled-skills.json')

const SKIP_NAMES = new Set([
  'node_modules',
  '.rate-limit-state.json',
  '.DS_Store',
  'package-lock.json',
])

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv) {
  let out
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      out = argv[++i]
    }
  }
  if (!out) fail('usage: node scripts/seed-desktop-bundled-skills.mjs --out <dir>')
  return { out: resolve(out) }
}

function copySkill(src, dest) {
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    if (SKIP_NAMES.has(name)) continue
    const from = join(src, name)
    const to = join(dest, name)
    const stat = statSync(from)
    if (stat.isDirectory()) {
      copySkill(from, to)
    } else {
      cpSync(from, to)
    }
  }
}

function hasProdDependencies(manifest) {
  const deps = manifest?.dependencies
  return deps !== undefined && deps !== null && Object.keys(deps).length > 0
}

function installSkillDeps(name, dest) {
  const manifest = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'))
  if (!hasProdDependencies(manifest)) {
    console.log(`bundled skill ready: ${name} (no npm dependencies)`)
    return
  }
  const install = spawnSync('npm', ['install', '--omit=dev', '--no-fund', '--no-audit'], {
    cwd: dest,
    stdio: 'inherit',
    env: process.env,
  })
  if (install.status !== 0) fail(`npm install failed for ${name}`)
  if (!existsSync(join(dest, 'node_modules'))) fail(`${name}: node_modules missing after install`)
  console.log(`bundled skill ready: ${name}`)
}

/**
 * @param {{ name: string, path: string }} entry
 * @param {string} dest
 */
function seedWorkspaceSkill(entry, dest) {
  const src = resolve(REPO_ROOT, entry.path)
  if (!existsSync(join(src, 'SKILL.md'))) fail(`missing SKILL.md in ${src}`)
  if (!existsSync(join(src, 'package.json'))) fail(`missing package.json in ${src}`)
  copySkill(src, dest)
  installSkillDeps(entry.name, dest)
}

/**
 * @param {{
 *   name: string,
 *   package: string,
 *   version: string,
 *   skillSubpath: string,
 * }} entry
 * @param {string} dest
 */
function seedNpmSkill(entry, dest) {
  const packRef = `${entry.package}@${entry.version}`
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-bundled-skill-'))
  try {
    const pack = spawnSync('npm', ['pack', packRef, '--pack-destination', scratch], {
      cwd: scratch,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: process.env,
      encoding: 'utf8',
    })
    if (pack.status !== 0) fail(`npm pack failed for ${packRef}`)
    const tarball = (pack.stdout ?? '').trim().split('\n').filter(Boolean).at(-1)
    if (typeof tarball !== 'string' || tarball === '') {
      fail(`npm pack produced no tarball for ${packRef}`)
    }
    const tarballPath = join(scratch, tarball)
    const extract = spawnSync('tar', ['-xzf', tarballPath, '-C', scratch], {
      stdio: 'inherit',
      env: process.env,
    })
    if (extract.status !== 0) fail(`tar extract failed for ${packRef}`)
    const skillSrc = join(scratch, 'package', entry.skillSubpath)
    if (!existsSync(join(skillSrc, 'SKILL.md'))) {
      fail(`missing SKILL.md in ${packRef}:${entry.skillSubpath}`)
    }
    if (!existsSync(join(skillSrc, 'package.json'))) {
      fail(`missing package.json in ${packRef}:${entry.skillSubpath}`)
    }
    copySkill(skillSrc, dest)
    installSkillDeps(entry.name, dest)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function main() {
  const { out } = parseArgs(process.argv.slice(2))
  if (!existsSync(PIN_PATH)) fail(`missing ${PIN_PATH}`)
  const pin = JSON.parse(readFileSync(PIN_PATH, 'utf8'))
  if (!Array.isArray(pin.skills) || pin.skills.length === 0) {
    fail('desktop-bundled-skills.json must list at least one skill')
  }

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  const seeded = []
  for (const entry of pin.skills) {
    const name = entry?.name
    if (typeof name !== 'string' || name === '') fail('each skill needs a name')
    const dest = join(out, name)
    if (entry.source === 'npm') {
      if (typeof entry.package !== 'string' || typeof entry.version !== 'string'
        || typeof entry.skillSubpath !== 'string') {
        fail(`npm skill ${name} needs package, version, and skillSubpath`)
      }
      seedNpmSkill(entry, dest)
    } else {
      if (typeof entry.path !== 'string' || entry.path === '') {
        fail(`workspace skill ${name} needs path`)
      }
      seedWorkspaceSkill(entry, dest)
    }
    seeded.push(name)
  }

  writeFileSync(join(out, '.seeded.json'), `${JSON.stringify({
    seededAt: new Date().toISOString(),
    skills: seeded,
  }, null, 2)}\n`)
}

main()
