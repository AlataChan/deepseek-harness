import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectSkillViolations, loadSkillPin, validatedSkillEntry, validatedSkillName, validatedSkillRelativePath, validateBundledSkills } from './bundled-skill-files.mjs'

/**
 * Focused fixtures for the manifest-driven bundled-skills payload rules
 * (scripts/bundled-skill-files.mjs) and the two consumers that share them:
 * the seeder and the assembled-bundle validator CLI. No npm install or network
 * runs: fixture skills declare no dependencies, and the WeChat `node_modules`
 * requirement is exercised against hand-assembled payloads.
 */

const root = resolve(import.meta.dirname, '..')
const REAL_PIN = resolve(root, 'scripts', 'desktop-bundled-skills.json')
const VALIDATOR = resolve(root, 'scripts', 'verify-desktop-bundled-skills.mjs')
const SEEDER = resolve(root, 'scripts', 'seed-desktop-bundled-skills.mjs')
const HELPER = resolve(root, 'scripts', 'bundled-skill-files.mjs')

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `dsh-bundled-skill-${name}-`))
  tempDirs.push(dir)
  return realpathSync(dir)
}

/**
 * Assemble a synthetic bundled-skills payload that satisfies every requirement
 * declared by the real pin, plus one unpinned skill directory.
 * @param base - directory to create `bundled-skills` inside.
 * @returns the bundled-skills directory.
 */
function buildValidPayload(base: string): string {
  const skills = join(base, 'bundled-skills')
  const file = (relative: string, content: string): void => {
    const path = join(skills, relative)
    mkdirSync(resolve(path, '..'), { recursive: true })
    writeFileSync(path, content)
  }
  for (const name of ['wechat-article-extractor', 'archify', 'conversation-media-creation', 'term-glossary', 'team-orchestration', 'user-own-skill']) {
    file(`${name}/SKILL.md`, `# ${name}\n`)
  }
  file('wechat-article-extractor/scripts/rate-limit.js', 'export const limit = 8\n')
  mkdirSync(join(skills, 'wechat-article-extractor', 'node_modules', 'fixture-dep'), { recursive: true })
  file('archify/bin/archify.mjs', '#!/usr/bin/env node\n')
  file('conversation-media-creation/SKILL.md', '5. 打开文件不是播放。系统打开成功后只说「已请求系统打开文件」。\n')
  file('term-glossary/data/glossary.json', '{}\n')
  file('term-glossary/scripts/lookup.mjs', 'export {}\n')
  file('team-orchestration/references/task-spec.md', '# 任务模板\n')
  file('team-orchestration/references/recovery.md', '# 恢复\n')
  return skills
}

/** Run the real validator CLI against one payload. */
function runValidator(payloadRoot: string, pin = REAL_PIN): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [VALIDATOR, '--root', payloadRoot, '--pin', pin], { encoding: 'utf8', timeout: 30_000 })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

describe('bundled-skill-files manifest rules', () => {
  it('validates the real pin shape and collects every declared requirement', () => {
    const pin = loadSkillPin(REAL_PIN)
    expect(pin.skills.map(skill => skill.name)).toEqual([
      'wechat-article-extractor', 'archify', 'conversation-media-creation', 'term-glossary', 'team-orchestration',
    ])
    const byName = new Map(pin.skills.map(skill => [skill.name, skill]))
    expect(byName.get('wechat-article-extractor')?.requirements).toEqual([
      { kind: 'file', path: 'scripts/rate-limit.js' },
      { kind: 'directory', path: 'node_modules' },
    ])
    expect(byName.get('archify')?.requirements).toEqual([{ kind: 'file', path: 'bin/archify.mjs' }])
    expect(byName.get('conversation-media-creation')?.requirements).toEqual([
      { kind: 'text', path: 'SKILL.md', text: '已请求系统打开文件' },
    ])
    expect(byName.get('term-glossary')?.requirements).toEqual([
      { kind: 'file', path: 'data/glossary.json' },
      { kind: 'file', path: 'scripts/lookup.mjs' },
    ])
    expect(byName.get('team-orchestration')?.requirements).toEqual([
      { kind: 'file', path: 'references/task-spec.md' },
      { kind: 'file', path: 'references/recovery.md' },
    ])
  })

  it('rejects unsafe or malformed declared paths before any join', () => {
    for (const bad of ['../escape.md', '/abs/path.md', 'a\\b.md', 'a//b.md', './a.md', '']) {
      expect(() => validatedSkillRelativePath('skill', bad, 'requiredFiles')).toThrow()
    }
    expect(validatedSkillRelativePath('skill', 'references/task-spec.md', 'requiredFiles')).toBe('references/task-spec.md')
  })

  it('rejects unknown manifest fields and mistyped requirement arrays', () => {
    expect(() => validatedSkillEntry({ name: 'skill', typo: true }, 0)).toThrow(/unknown field "typo"/)
    expect(() => validatedSkillEntry({ name: 'skill', requiredFiles: 'references/task-spec.md' }, 0)).toThrow(/must be an array/)
    expect(() => validatedSkillEntry({ name: 'skill', requiredText: [{ file: 'SKILL.md' }] }, 0)).toThrow(/must be a non-empty string/)
    expect(validatedSkillEntry({ name: 'skill' }, 0).requirements).toEqual([])
  })

  it('rejects skill names that are not one safe lower-kebab segment', () => {
    for (const bad of ['../outside', 'a/b', 'a\\b', '.', '..', '.hidden', 'Skill', 'a--b', '-a', 'a-']) {
      expect(() => validatedSkillName(bad, 0), bad).toThrow(/must be one lower-kebab segment/)
    }
    expect(validatedSkillName('team-orchestration', 0)).toBe('team-orchestration')
  })

  it('rejects duplicate skill names before any copy', () => {
    const pinPath = join(tempDir('dup'), 'pin.json')
    writeFileSync(pinPath, JSON.stringify({ skills: [{ name: 'a' }, { name: 'b' }, { name: 'a' }] }))
    expect(() => loadSkillPin(pinPath)).toThrow('desktop-bundled-skills.json: skills[2] duplicates skill name "a"')
  })

  it('reports text and kind mismatches with the exact relative path', () => {
    const base = tempDir('violations')
    const skills = buildValidPayload(base)
    writeFileSync(join(skills, 'conversation-media-creation', 'SKILL.md'), 'missing the wording\n')
    rmSync(join(skills, 'archify', 'bin', 'archify.mjs'))
    mkdirSync(join(skills, 'archify', 'bin', 'archify.mjs'), { recursive: true })
    rmSync(join(skills, 'wechat-article-extractor', 'node_modules'), { recursive: true })
    writeFileSync(join(skills, 'wechat-article-extractor', 'node_modules'), 'now a file')
    rmSync(join(skills, 'team-orchestration', 'references', 'task-spec.md'))
    const pin = loadSkillPin(REAL_PIN)
    const violations = validateBundledSkills(skills, pin)
    expect(violations).toContain('bundled-skills/conversation-media-creation/SKILL.md does not contain the required text "已请求系统打开文件" declared in desktop-bundled-skills.json')
    expect(violations).toContain('bundled-skills/archify/bin/archify.mjs must be a file')
    expect(violations).toContain('bundled-skills/wechat-article-extractor/node_modules must be a directory')
    expect(violations).toContain('bundled-skills/team-orchestration/references/task-spec.md missing from bundled-skills payload')
  })

  it('reports a requiredText target that is a directory as a file mismatch, not a crash', () => {
    const base = tempDir('text-dir')
    const pinPath = join(base, 'pin.json')
    writeFileSync(pinPath, JSON.stringify({
      skills: [{ name: 'skill', requiredText: [{ file: 'payload', text: 'literal' }] }],
    }))
    const skills = join(base, 'bundled-skills')
    mkdirSync(join(skills, 'skill', 'payload'), { recursive: true })
    writeFileSync(join(skills, 'skill', 'SKILL.md'), '# skill\n')
    const violations = validateBundledSkills(skills, loadSkillPin(pinPath))
    expect(violations).toEqual(['bundled-skills/skill/payload must be a file'])
  })
})

describe('verify-desktop-bundled-skills CLI against the real pin', () => {
  it('accepts a complete payload and preserves unrelated skills', () => {
    const base = tempDir('valid')
    const skills = buildValidPayload(base)
    const run = runValidator(skills)
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain('5 bundled skill(s) match desktop-bundled-skills.json requirements')
    expect(existsSync(join(skills, 'user-own-skill', 'SKILL.md'))).toBe(true)
  })

  /** One payload-breaking case: label, expected exact relative path, and the mutation. */
  type MissingCase = readonly [label: string, relative: string, breakPayload: (skills: string) => void]
  const missingCases: readonly MissingCase[] = [
    ['team-orchestration reference task-spec', 'team-orchestration/references/task-spec.md', (skills) => { rmSync(join(skills, 'team-orchestration', 'references', 'task-spec.md')) }],
    ['team-orchestration reference recovery', 'team-orchestration/references/recovery.md', (skills) => { rmSync(join(skills, 'team-orchestration', 'references', 'recovery.md')) }],
    ['WeChat rate-limit script', 'wechat-article-extractor/scripts/rate-limit.js', (skills) => { rmSync(join(skills, 'wechat-article-extractor', 'scripts', 'rate-limit.js')) }],
    ['WeChat installed dependencies', 'wechat-article-extractor/node_modules', (skills) => { rmSync(join(skills, 'wechat-article-extractor', 'node_modules'), { recursive: true }) }],
    ['Archify executable', 'archify/bin/archify.mjs', (skills) => { rmSync(join(skills, 'archify', 'bin', 'archify.mjs')) }],
    ['glossary data', 'term-glossary/data/glossary.json', (skills) => { rmSync(join(skills, 'term-glossary', 'data', 'glossary.json')) }],
    ['glossary lookup script', 'term-glossary/scripts/lookup.mjs', (skills) => { rmSync(join(skills, 'term-glossary', 'scripts', 'lookup.mjs')) }],
    ['media required wording', 'conversation-media-creation/SKILL.md', (skills) => { writeFileSync(join(skills, 'conversation-media-creation', 'SKILL.md'), 'no wording\n') }],
  ]
  for (const [label, relative, breakPayload] of missingCases) {
    it(`fails with the exact relative path when ${label} is missing`, () => {
      const base = tempDir('missing')
      const skills = buildValidPayload(base)
      breakPayload(skills)
      const run = runValidator(skills)
      expect(run.status).toBe(1)
      expect(run.stderr).toContain(`bundled-skills/${relative}`)
    })
  }

  it('fails when a whole pinned skill is missing', () => {
    const base = tempDir('absent-skill')
    const skills = buildValidPayload(base)
    rmSync(join(skills, 'term-glossary'), { recursive: true })
    const run = runValidator(skills)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('bundled-skills/term-glossary missing from bundled-skills payload')
  })

  it('rejects a directory in place of the uniform SKILL.md entrypoint', () => {
    const base = tempDir('skill-md-dir')
    const skills = buildValidPayload(base)
    rmSync(join(skills, 'term-glossary', 'SKILL.md'))
    mkdirSync(join(skills, 'term-glossary', 'SKILL.md'))
    const run = runValidator(skills)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('bundled-skills/term-glossary/SKILL.md must be a file')
  })

  it('fails when a requiredFiles entry resolves to a directory', () => {
    const base = tempDir('file-vs-dir')
    const pinPath = join(base, 'pin.json')
    writeFileSync(pinPath, JSON.stringify({
      skills: [{ name: 'skill', path: '.agents/skills/skill', requiredFiles: ['payload'] }],
    }))
    const skills = join(base, 'bundled-skills')
    mkdirSync(join(skills, 'skill', 'payload'), { recursive: true })
    writeFileSync(join(skills, 'skill', 'SKILL.md'), '# skill\n')
    const run = runValidator(skills, pinPath)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('bundled-skills/skill/payload must be a file')
  })

  it('fails loud on a manifest that declares an escaping path', () => {
    const base = tempDir('bad-manifest')
    const pinPath = join(base, 'pin.json')
    writeFileSync(pinPath, JSON.stringify({
      skills: [{ name: 'skill', path: '.agents/skills/skill', requiredFiles: ['../outside.md'] }],
    }))
    const run = runValidator(join(base, 'bundled-skills'), pinPath)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('must not contain empty, ".", or ".." segments')
  })

  it('fails loud on a manifest whose skill name is not one safe segment', () => {
    const base = tempDir('bad-name')
    const pinPath = join(base, 'pin.json')
    writeFileSync(pinPath, JSON.stringify({ skills: [{ name: '../outside', path: 'x' }] }))
    const run = runValidator(join(base, 'bundled-skills'), pinPath)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('must be one lower-kebab segment')
  })

  it('fails loud on duplicate pin entries', () => {
    const base = tempDir('dup-pin')
    const pinPath = join(base, 'pin.json')
    writeFileSync(pinPath, JSON.stringify({ skills: [{ name: 'a' }, { name: 'a' }] }))
    const run = runValidator(join(base, 'bundled-skills'), pinPath)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('duplicates skill name "a"')
  })
})

describe('seed-desktop-bundled-skills in an isolated fixture repository', () => {
  /**
   * Copy the real seed and helper scripts into a fixture repo with a
   * workspace-only pin and matching skill sources. No npm skill is pinned, so
   * seeding never touches the network.
   */
  function makeFixtureRepo(): { repo: string; pinPath: string; sources: string } {
    const repo = tempDir('repo')
    const sources = join(repo, '.agents', 'skills')
    mkdirSync(join(repo, 'scripts'), { recursive: true })
    cpSync(SEEDER, join(repo, 'scripts', 'seed-desktop-bundled-skills.mjs'))
    cpSync(HELPER, join(repo, 'scripts', 'bundled-skill-files.mjs'))
    const pinPath = join(repo, 'scripts', 'desktop-bundled-skills.json')
    writeFileSync(pinPath, JSON.stringify({
      skills: [
        { name: 'team-orchestration', path: '.agents/skills/team-orchestration', requiredFiles: ['references/task-spec.md', 'references/recovery.md'] },
        { name: 'media-skill', path: '.agents/skills/media-skill', requiredText: [{ file: 'SKILL.md', text: '已请求系统打开文件' }] },
        { name: 'glossary-skill', path: '.agents/skills/glossary-skill', requiredFiles: ['data/glossary.json', 'scripts/lookup.mjs'] },
      ],
    }))
    const write = (relative: string, content: string): void => {
      const path = join(sources, relative)
      mkdirSync(resolve(path, '..'), { recursive: true })
      writeFileSync(path, content)
    }
    for (const name of ['team-orchestration', 'media-skill', 'glossary-skill']) {
      write(`${name}/SKILL.md`, `# ${name}\n`)
      write(`${name}/package.json`, JSON.stringify({ name, private: true, version: '0.1.0' }))
      write(`${name}/package-lock.json`, '{}\n')
      write(`${name}/.DS_Store`, 'junk\n')
    }
    write('team-orchestration/references/task-spec.md', '# 任务模板\n')
    write('team-orchestration/references/recovery.md', '# 恢复\n')
    write('media-skill/SKILL.md', '只说「已请求系统打开文件」。\n')
    write('glossary-skill/data/glossary.json', '{}\n')
    write('glossary-skill/scripts/lookup.mjs', 'export {}\n')
    return { repo, pinPath, sources }
  }

  function runSeeder(repo: string, out: string): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [join(repo, 'scripts', 'seed-desktop-bundled-skills.mjs'), '--out', out], { encoding: 'utf8', timeout: 60_000 })
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }

  it('performs a valid recursive copy honoring the skip list', () => {
    const { repo } = makeFixtureRepo()
    const out = join(tempDir('seed-out'), 'bundled-skills')
    const run = runSeeder(repo, out)
    expect(run.status, run.stderr).toBe(0)
    expect(existsSync(join(out, 'team-orchestration', 'references', 'task-spec.md'))).toBe(true)
    expect(existsSync(join(out, 'team-orchestration', 'references', 'recovery.md'))).toBe(true)
    expect(readFileSync(join(out, 'media-skill', 'SKILL.md'), 'utf8')).toContain('已请求系统打开文件')
    expect(existsSync(join(out, 'glossary-skill', 'scripts', 'lookup.mjs'))).toBe(true)
    expect(readdirSync(join(out, 'team-orchestration'))).not.toContain('package-lock.json')
    expect(existsSync(join(out, 'team-orchestration', '.DS_Store'))).toBe(false)
    const seeded = JSON.parse(readFileSync(join(out, '.seeded.json'), 'utf8')) as { skills?: string[] }
    expect(seeded.skills).toEqual([
      'team-orchestration', 'media-skill', 'glossary-skill',
    ])
  })

  it('fails with the exact relative path when a declared source reference is missing', () => {
    const { repo, sources } = makeFixtureRepo()
    rmSync(join(sources, 'team-orchestration', 'references', 'recovery.md'))
    const out = join(tempDir('seed-missing'), 'bundled-skills')
    const run = runSeeder(repo, out)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('bundled-skills/team-orchestration/references/recovery.md missing from bundled-skills payload')
    expect(run.stderr).toContain('does not satisfy its declared payload requirements')
  })

  it('rejects a fixture pin whose declared path escapes the skill directory', () => {
    const { repo, pinPath } = makeFixtureRepo()
    writeFileSync(pinPath, JSON.stringify({
      skills: [{ name: 'escaping', path: '.agents/skills/escaping', requiredFiles: ['../outside.md'] }],
    }))
    const out = join(tempDir('seed-escape'), 'bundled-skills')
    const run = runSeeder(repo, out)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('must not contain empty, ".", or ".." segments')
  })

  it('rejects a fixture pin whose skill name is not one safe segment', () => {
    const { repo, pinPath } = makeFixtureRepo()
    writeFileSync(pinPath, JSON.stringify({
      skills: [{ name: '../outside', path: '.agents/skills/outside' }],
    }))
    const out = join(tempDir('seed-bad-name'), 'bundled-skills')
    const run = runSeeder(repo, out)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('must be one lower-kebab segment')
    expect(existsSync(out)).toBe(false)
  })

  it('rejects a fixture pin with duplicate skill names', () => {
    const { repo, pinPath } = makeFixtureRepo()
    writeFileSync(pinPath, JSON.stringify({
      skills: [
        { name: 'media-skill', path: '.agents/skills/media-skill' },
        { name: 'media-skill', path: '.agents/skills/glossary-skill' },
      ],
    }))
    const out = join(tempDir('seed-dup'), 'bundled-skills')
    const run = runSeeder(repo, out)
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('duplicates skill name "media-skill"')
    expect(existsSync(out)).toBe(false)
  })
})

describe('real skill directory satisfies its own pin entry', () => {
  it('team-orchestration source carries both declared references', () => {
    const skillDir = resolve(root, '.agents', 'skills', 'team-orchestration')
    const pin = loadSkillPin(REAL_PIN)
    const entry = pin.skills.find(skill => skill.name === 'team-orchestration')
    expect(entry, 'real pin must declare team-orchestration').toBeDefined()
    if (entry !== undefined) expect(collectSkillViolations(resolve(skillDir, '..'), entry)).toEqual([])
  })
})
