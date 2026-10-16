/** Sidecar spawn, env isolation, abort, and vault bootstrap. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import { BOOTSTRAP_CONFIG_TOML } from '../src/bootstrap-vault.ts'
import { packagePythonDir, runSidecar } from '../src/sidecar.ts'
import { installFakeSidecar, installPythonSidecar } from './helpers/install-sidecar.ts'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

describe('ask-knowledge sidecar', () => {
  it('spawns the fake sidecar and omits companion DEEPSEEK_API_KEY unless env sets it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-sidecar-'))
    await installFakeSidecar(home)
    const previous = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = 'sk-companion-must-not-leak'
    cleanups.push(() => {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY
      else process.env.DEEPSEEK_API_KEY = previous
    })
    const without = await runSidecar({ sidecarRuntimePath: home }, { command: 'self-test' }, {
      env: { ASK_KNOWLEDGE_SIDECAR_KEY_HASH: '1' },
    })
    expect(without.ok).toBe(true)
    expect(without.hasDeepseekKey).toBe(false)
    expect(without.keyHash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    const withKey = await runSidecar({ sidecarRuntimePath: home }, { command: 'self-test' }, {
      env: {
        DEEPSEEK_API_KEY: 'sk-injected-once',
        ASK_KNOWLEDGE_SIDECAR_KEY_HASH: '1',
      },
    })
    expect(withKey.hasDeepseekKey).toBe(true)
    expect(JSON.stringify(withKey)).not.toContain('sk-injected-once')
    expect(JSON.stringify(withKey)).not.toContain('sk-companion-must-not-leak')
  })

  it('aborts an in-flight sidecar', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-abort-'))
    await installFakeSidecar(home)
    const ac = new AbortController()
    const pending = runSidecar({ sidecarRuntimePath: home }, { command: 'self-test' }, {
      env: { ASK_KNOWLEDGE_FAKE_HOLD_MS: '5000' },
      signal: ac.signal,
    })
    ac.abort()
    await expect(pending).rejects.toBeInstanceOf(AskKnowledgeError)
  })

  it('writes DeepSeek config via Python bootstrap and rejects Ollama defaults', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-py-'))
    await installPythonSidecar(home)
    const vault = join(home, 'vault')
    await mkdir(vault, { recursive: true })
    const result = await runSidecar({ sidecarRuntimePath: home }, { command: 'bootstrap', vault })
    expect(result.ok).toBe(true)
    const config = await readFile(join(vault, '.octopus-kb', 'config.toml'), 'utf8')
    expect(config).toBe(BOOTSTRAP_CONFIG_TOML)
    expect(config).not.toContain('11434')
    expect(config).not.toContain('qwen')
    expect(packagePythonDir()).toContain('python')
    const empty = join(home, 'empty.md')
    await writeFile(empty, '', 'utf8')
    await expect(runSidecar({ sidecarRuntimePath: home }, {
      command: 'ingest-file',
      path: empty,
      vault,
    })).rejects.toMatchObject({
      code: 'ingest-failed',
      message: '这份文件没有可提取的文字。',
    })
  })

  it('returns a large session conversion through file results without losing its tail', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-large-file-result-'))
    try {
      await installPythonSidecar(home)
      const source = join(home, 'large.md')
      await writeFile(source, '全量文档。'.repeat(200_000) + 'SESSION_FINAL_MARKER_9241')
      const result = await runSidecar({ sidecarRuntimePath: home }, { command: 'convert-file', path: source })
      expect(result.ok).toBe(true)
      expect(typeof result.body).toBe('string')
      expect(String(result.body)).toContain('SESSION_FINAL_MARKER_9241')
      expect(Buffer.byteLength(String(result.body))).toBeGreaterThan(2 * 1024 * 1024)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it.each(['ascii', 'cp1252'])('keeps the JSON wire UTF-8 under a %s process locale', async (encoding) => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-json-encoding-'))
    try {
      await installPythonSidecar(home)
      const source = join(home, '中文资料.md')
      await writeFile(source, '# 中文标题\n保留完整中文内容。\n', 'utf8')
      const result = await runSidecar({ sidecarRuntimePath: home }, { command: 'convert-file', path: source }, {
        env: { PYTHONIOENCODING: encoding },
      })
      expect(result.body).toContain('保留完整中文内容。')
      expect(result.title).toBe('中文资料')
      await expect(runSidecar({ sidecarRuntimePath: home }, { command: '不存在命令' }, {
        env: { PYTHONIOENCODING: encoding },
      })).rejects.toMatchObject({ code: 'ingest-failed', message: 'unknown command: 不存在命令' })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('fails retrieve when sidecar home is missing', async () => {
    await expect(runSidecar({ sidecarRuntimePath: '' }, { command: 'self-test' }))
      .rejects.toMatchObject({ code: 'sidecar-home-missing' })
  })

  it('converts a markdown file without writing a vault', { timeout: 20_000 }, async () => {
    const home = await mkdtemp(join(tmpdir(), 'ask-knowledge-convert-'))
    await installPythonSidecar(home)
    const source = join(home, 'note.md')
    await writeFile(source, '# 仅本会话\n正文\n', 'utf8')
    const result = await runSidecar({ sidecarRuntimePath: home }, {
      command: 'convert-file',
      path: source,
    })
    expect(result.ok).toBe(true)
    expect(result.body).toContain('正文')
    expect(result.title).toBe('note')
    expect(result.sourceFile).toBe('note.md')
    await expect(readFile(join(home, 'raw', 'note.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await writeFile(join(home, 'empty.md'), '', 'utf8')
    await expect(runSidecar({ sidecarRuntimePath: home }, {
      command: 'convert-file',
      path: join(home, 'empty.md'),
    })).rejects.toMatchObject({
      code: 'ingest-failed',
      message: '这份文件没有可提取的文字。',
    })
    await writeFile(join(home, '表.xlsx'), 'not-a-workbook', 'utf8')
    await expect(runSidecar({ sidecarRuntimePath: home }, {
      command: 'convert-file',
      path: join(home, '表.xlsx'),
    })).rejects.toMatchObject({
      code: 'ingest-failed',
      message: '仅支持 Markdown、TXT、HTML、PDF。表格请走问数据。',
    })
  })
})
