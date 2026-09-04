#!/usr/bin/env node
/**
 * Prepare fork-owned bundled skills for the octopus_DSH DMG.
 *
 * Reads scripts/desktop-bundled-skills.json, copies each skill (without
 * node_modules / rate-limit state), runs `npm install --omit=dev`, and writes
 * the result under --out (Resources/resources/bundled-skills/).
 *
 * Usage:
 *   node scripts/seed-desktop-bundled-skills.mjs --out <dir>
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
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

function main() {
  const { out } = parseArgs(process.argv.slice(2))
  if (!existsSync(PIN_PATH)) fail(`missing ${PIN_PATH}`)
  const pin = JSON.parse(readFileSync(PIN_PATH, 'utf8'))
  if (!Array.isArray(pin.skills) || pin.skills.length === 0) {
    fail('desktop-bundled-skills.json must list at least one skill')
  }

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  for (const entry of pin.skills) {
    const name = entry?.name
    const rel = entry?.path
    if (typeof name !== 'string' || typeof rel !== 'string') {
      fail('each skill needs name and path')
    }
    const src = resolve(REPO_ROOT, rel)
    if (!existsSync(join(src, 'SKILL.md'))) fail(`missing SKILL.md in ${src}`)
    if (!existsSync(join(src, 'package.json'))) fail(`missing package.json in ${src}`)
    const dest = join(out, name)
    copySkill(src, dest)
    const install = spawnSync('npm', ['install', '--omit=dev', '--no-fund', '--no-audit'], {
      cwd: dest,
      stdio: 'inherit',
      env: process.env,
    })
    if (install.status !== 0) fail(`npm install failed for ${name}`)
    if (!existsSync(join(dest, 'node_modules'))) fail(`${name}: node_modules missing after install`)
    console.log(`bundled skill ready: ${name}`)
  }

  writeFileSync(join(out, '.seeded.json'), `${JSON.stringify({
    seededAt: new Date().toISOString(),
    skills: pin.skills.map(skill => skill.name),
  }, null, 2)}\n`)
}

main()
