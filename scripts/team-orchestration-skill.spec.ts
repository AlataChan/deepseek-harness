import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FileSystem, FsTargetKey, FsVersion, type FsDirEntry, type FsEditOutcome, type FsEditRequest, type FsPathInfo, type FsTarget, type FsWriteIntent, type FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'

/**
 * Keyless acceptance checks for the team-orchestration skill: package
 * metadata, tool-name accuracy against the real Team tool registration source,
 * absence of nonexistent lifecycle operations, and actual discovery plus
 * explicit reference reads through the public filesystem skill provider
 * (project precedence over home-seeded content included).
 */

const root = resolve(import.meta.dirname, '..')
const SKILL_DIR = resolve(root, '.agents', 'skills', 'team-orchestration')
const TEAM_TOOL_SOURCE = resolve(root, 'packages', 'experimental', 'tool-agent-team', 'src', 'index.ts')

const SKILL_FILES = ['SKILL.md', 'package.json', 'references/task-spec.md', 'references/recovery.md'] as const

/** Model-facing operations the Team runtime does not expose; the skill must never present them as available. */
const BANNED_OPERATION_TOKENS = ['worker_done', 'respawn', 'exactly-once', 'terminal release', 'dispatch'] as const

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `dsh-team-skill-${name}-`))
  tempDirs.push(dir)
  return realpathSync(dir)
}

function skillFile(relative: string): string {
  return readFileSync(join(SKILL_DIR, relative), 'utf8')
}

function parseFrontmatter(source: string): Record<string, unknown> {
  const lines = source.split('\n')
  expect(lines[0]).toBe('---')
  const end = lines.indexOf('---', 1)
  expect(end).toBeGreaterThan(0)
  const metadata = load(lines.slice(1, end).join('\n'))
  expect(metadata).toBeInstanceOf(Object)
  return metadata as Record<string, unknown>
}

describe('team-orchestration package metadata', () => {
  it('is a private, dependency-free skill bundle with all four files', () => {
    for (const relative of SKILL_FILES) expect(existsSync(join(SKILL_DIR, relative)), relative).toBe(true)
    const manifest = JSON.parse(skillFile('package.json')) as { name?: string; private?: boolean; version?: string; dependencies?: unknown; devDependencies?: unknown }
    expect(manifest).toMatchObject({ name: 'team-orchestration', private: true, version: '0.1.0' })
    expect(manifest.dependencies).toBeUndefined()
    expect(manifest.devDependencies).toBeUndefined()
    const extra = readdirSync(SKILL_DIR).filter(name => name !== 'SKILL.md' && name !== 'package.json' && name !== 'references')
    expect(extra).toEqual([])
  })

  it('keeps a narrow frontmatter description that states the missing-tool limit', () => {
    const metadata = parseFrontmatter(skillFile('SKILL.md'))
    expect(metadata['name']).toBe('team-orchestration')
    for (const field of ['description', 'whenToUse']) expect(typeof metadata[field]).toBe('string')
    expect(skillFile('SKILL.md')).toContain('缺少 Team 工具时')
    expect(skillFile('SKILL.md')).toContain('不是权限 enforcement')
  })

  it('instructs the model to explicitly read both reference files by relative path', () => {
    const body = skillFile('SKILL.md')
    for (const reference of ['references/task-spec.md', 'references/recovery.md']) {
      expect(body).toContain(reference)
    }
    expect(body).toContain('skills.get()')
  })
})

describe('team-orchestration tool accuracy against the runtime registration', () => {
  /** Every tool name registered by `defineTool` in the Team tool plugin source. */
  function registeredToolNames(): string[] {
    const source = readFileSync(TEAM_TOOL_SOURCE, 'utf8')
    const names = [...source.matchAll(/name: '([a-z_]+)',\n\s+description: '/g)].flatMap(match => match[1] === undefined ? [] : [match[1]])
    expect(names.length, 'tool registration pattern drifted').toBeGreaterThanOrEqual(10)
    return names
  }

  const expectedTools = [
    'spawn_teammate', 'send_message', 'list_agents', 'wait_agent', 'interrupt_agent',
    'propose_action', 'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update',
  ]

  it('documents exactly the registered Team tool set', () => {
    const registered = registeredToolNames()
    expect(registered).toEqual(expect.arrayContaining(expectedTools))
    const body = skillFile('SKILL.md')
    const toolList = /工具集以此为准：(.+?)。/.exec(body)?.[1] ?? ''
    const documented = [...toolList.matchAll(/`([a-z_]+)`/g)].map(match => match[1])
    expect([...documented].sort()).toEqual([...registered].sort())
  })

  it('never mentions a tool-like operation the runtime does not register', () => {
    const registered = new Set(registeredToolNames())
    for (const relative of SKILL_FILES) {
      const text = skillFile(relative)
      const tokens = [...text.matchAll(/`([a-z](?:[a-z_]*[a-z])?)`/g)].flatMap(match => match[1] === undefined ? [] : [match[1]])
      for (const token of tokens) {
        if (!/^(team_|spawn_|send_|list_|wait_|interrupt_|propose_)/.test(token)) continue
        expect(registered.has(token), `${relative} names unregistered operation \`${token}\``).toBe(true)
      }
    }
  })

  it('never presents a nonexistent lifecycle operation as available', () => {
    for (const relative of SKILL_FILES) {
      const text = skillFile(relative).toLowerCase()
      for (const banned of BANNED_OPERATION_TOKENS) {
        expect(text.includes(banned), `${relative} mentions "${banned}"`).toBe(false)
      }
    }
  })

  it('reports the roster provider field as the delegation mechanism, not the effective LLM route', () => {
    const body = skillFile('SKILL.md')
    expect(body).toContain('`provider` 字段是委派机制')
    expect(body).toContain('不是生效的 LLM 服务商')
    expect(body).toContain('可能缺省')
    expect(body).toContain('未经核实')
  })

  it('routes the standing-squad no-seat fallback to the real home card, not a nonexistent Host settings page', () => {
    const body = skillFile('SKILL.md')
    expect(body).toContain('首页「机构常驻小队」卡片')
    expect(body).toContain('如实向用户转述 `list_agents` 的状态和诊断信息')
    expect(body).toContain('不保证 failed 的座位会被自动修复')
    expect(body).toContain('不用 `spawn_teammate` 顶替席位')
    for (const relative of SKILL_FILES) {
      expect(skillFile(relative)).not.toContain('Host 设置')
    }
  })

  it('relays only real Team error codes and keeps approval within propose_action semantics', () => {
    const runtime = [
      readFileSync(TEAM_TOOL_SOURCE, 'utf8'),
      readFileSync(resolve(root, 'packages', 'experimental', 'agent-team', 'src', 'task-board.ts'), 'utf8'),
      readFileSync(resolve(root, 'packages', 'experimental', 'agent-team', 'src', 'roster.ts'), 'utf8'),
    ].join('\n')
    const claimed = [
      'TEAM_FORK_NO_ROUTE_OVERRIDE', 'TEAM_MEMBER_NAME_TAKEN', 'TEAM_LEAD_REQUIRED',
      'TEAM_TASK_STALE_REVISION', 'TEAM_TASK_BLOCKED', 'TEAM_TASK_DEPENDENCY_CYCLE',
    ]
    for (const code of claimed) {
      expect(runtime.includes(code), `runtime does not define ${code}`).toBe(true)
      expect(SKILL_FILES.some(relative => skillFile(relative).includes(code)), `skill never relays ${code}`).toBe(true)
    }
    const skillText = skillFile('SKILL.md')
    expect(skillText).toContain('propose_action')
    expect(skillText).not.toContain('必须先')
  })
})

/**
 * Minimal real-behavior filesystem fixture backing the public skill provider.
 * Discovery and reads hit the actual temp files; watching is unsupported.
 */
class FixtureFileSystem extends FileSystem {
  override async resolve(path: string): Promise<FsTarget> {
    return { targetKey: FsTargetKey(path), displayPath: path }
  }

  override processPath(target: FsTarget): string { return target.displayPath }

  override fileUrl(target: FsTarget): string { return `file://${target.displayPath}` }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    return child.displayPath === parent.displayPath || child.displayPath.startsWith(`${parent.displayPath}/`)
  }

  override async stat(target: FsTarget): Promise<{ version: FsVersion; type: 'file' | 'directory' | 'other'; size: number } | undefined> {
    try {
      const info = await import('node:fs/promises').then(fs => fs.stat(target.displayPath))
      return {
        version: FsVersion(String(info.mtimeMs)),
        type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
        size: info.size,
      }
    } catch {
      return undefined
    }
  }

  override async lstat(path: string): Promise<FsPathInfo | undefined> {
    try {
      const info = await import('node:fs/promises').then(fs => fs.lstat(path))
      return {
        version: FsVersion(String(info.mtimeMs)),
        type: info.isSymbolicLink() ? 'symlink' : info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
        size: info.size,
      }
    } catch {
      return undefined
    }
  }

  override async readText(target: FsTarget): Promise<string> {
    return await import('node:fs/promises').then(fs => fs.readFile(target.displayPath, 'utf8'))
  }

  override async streamText(): Promise<AsyncIterable<string>> { throw new Error('not needed in this fixture') }
  override async readBytes(): Promise<Uint8Array> { throw new Error('not needed in this fixture') }
  override async readByteRange(): Promise<Uint8Array> { throw new Error('not needed in this fixture') }

  override async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    const entries = await import('node:fs/promises').then(fs => fs.readdir(target.displayPath, { withFileTypes: true }))
    return entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      target: {
        targetKey: FsTargetKey(join(target.displayPath, entry.name)),
        displayPath: join(target.displayPath, entry.name),
      },
    }))
  }

  override async writeText(target: FsTarget, content: string, _expected?: FsWriteIntent): Promise<FsWriteOutcome> {
    await import('node:fs/promises').then(fs => fs.mkdir(dirname(target.displayPath), { recursive: true }))
    await import('node:fs/promises').then(fs => fs.writeFile(target.displayPath, content))
    return { operation: 'create', version: FsVersion('fixture'), before: null, after: content }
  }

  override async editText(_target: FsTarget, _edit: FsEditRequest): Promise<FsEditOutcome> {
    throw new Error('not needed in this fixture')
  }
  override async deleteFile(): Promise<never> { throw new Error('fixture does not delete files') }
  override async moveFile(): Promise<never> { throw new Error('fixture does not move files') }
}

/** Copy the real skill into a temp project and seed a decoy copy in the home root. */
async function setupProviderWorkspace(): Promise<{ project: string; ctx: Context }> {
  const project = tempDir('project')
  const home = tempDir('home')
  mkdirSync(join(project, '.git'))
  const skillRoot = join(project, '.agents', 'skills', 'team-orchestration')
  mkdirSync(skillRoot, { recursive: true })
  cpSync(SKILL_DIR, skillRoot, { recursive: true })
  mkdirSync(join(home, '.dsh', 'skills', 'team-orchestration'), { recursive: true })
  writeFileSync(join(home, '.dsh', 'skills', 'team-orchestration', 'SKILL.md'), '---\nname: team-orchestration\ndescription: home decoy\n---\n\nHOME-DECOY-BODY\n')
  const ctx = new Context()
  await ctx.plugin(FixtureFileSystem)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFileSystem, {
    dshHome: join(home, '.dsh'),
    agentsHome: join(home, '.agents'),
    watch: false,
  })
  return { project, ctx }
}

describe('filesystem provider discovery and reference reads', () => {
  it('discovers the real skill from the project root ahead of home-seeded content', async () => {
    const { project, ctx } = await setupProviderWorkspace()
    const candidates = await ctx.skills.list({ cwd: project })
    const found = candidates.find(candidate => candidate.name === 'team-orchestration')
    expect(found).toBeDefined()
    expect(found?.source).toBe('project-agents')
    const definition = await ctx.skills.get('team-orchestration', { cwd: project })
    expect(definition?.source).toBe('project-agents')
    expect(definition?.content).toContain('Agent Teams 协作')
    expect(definition?.content).not.toContain('HOME-DECOY-BODY')
  })

  it('exposes a directory resourceBase the model can read both references through', async () => {
    const { project, ctx } = await setupProviderWorkspace()
    const definition = await ctx.skills.get('team-orchestration', { cwd: project })
    expect(definition?.resourceBase).toMatchObject({ kind: 'directory' })
    const resourceBase = definition?.resourceBase
    if (resourceBase?.kind !== 'directory') throw new Error('team-orchestration must expose a directory resourceBase')
    expect(resourceBase.path).toBe(join(project, '.agents', 'skills', 'team-orchestration'))
    const fs = ctx.fs
    for (const [reference, marker] of [['references/task-spec.md', '任务模板'], ['references/recovery.md', '恢复']] as const) {
      const text = await fs.readText(await fs.resolve(join(resourceBase.path, reference)))
      expect(text).toContain(marker)
    }
  })
})
