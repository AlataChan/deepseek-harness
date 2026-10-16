import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import { convertSourceFile, splitMarkdownIntoBlocks } from '../src/conversion.ts'
import { runAnyDocWorker } from '../src/converters/anydoc.ts'
import type { AskKnowledgeHomeConfig } from '../src/knowledge-home.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'conversion')

describe('document conversion and normalization', () => {
  let tempDir: string
  let config: AskKnowledgeHomeConfig

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ak-conv-test-'))
    const sidecarHome = join(tempDir, 'sidecar')
    await mkdir(sidecarHome, { recursive: true })
    await installPythonSidecar(sidecarHome)
    config = { sidecarRuntimePath: sidecarHome }
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('splits markdown text into normalized blocks with correct kinds and offsets', () => {
    const md = '# Title\n\nParagraph 1.\n\n- Item 1\n- Item 2\n\n| H1 | H2 |\n| --- | --- |\n| D1 | D2 |\n\n> Quote text\n\n```ts\nconst x = 1\n```\n\n[^1]: Footnote text'
    const blocks = splitMarkdownIntoBlocks(md)

    expect(blocks.length).toBe(7)
    expect(blocks[0]?.kind).toBe('heading')
    expect(blocks[0]?.level).toBe(1)
    expect(blocks[1]?.kind).toBe('paragraph')
    expect(blocks[2]?.kind).toBe('list')
    expect(blocks[3]?.kind).toBe('table')
    expect(blocks[4]?.kind).toBe('quote')
    expect(blocks[5]?.kind).toBe('code')
    expect(blocks[6]?.kind).toBe('footnote')

    expect(blocks[0]?.charOffset).toBe(0)
    expect(blocks[1]?.charOffset).toBeGreaterThan(0)
  })

  it('converts markdown and text files directly with UTF-8 decoding', async () => {
    const filePath = join(FIXTURES_DIR, 'sample.md')
    const result = await convertSourceFile(config, filePath, 'sample.md')

    expect(result.status).toBe('complete')
    expect(result.format).toBe('md')
    expect(result.blocks.length).toBeGreaterThanOrEqual(1)
    expect(result.diagnostics.warnings).toEqual([])
  })

  it('converts JSON files safely into structured code blocks', async () => {
    const filePath = join(FIXTURES_DIR, 'sample.json')
    const result = await convertSourceFile(config, filePath, 'sample.json')

    expect(result.status).toBe('complete')
    expect(result.format).toBe('json')
    expect(result.markdown).toContain('```json')
    expect(result.blocks[0]?.kind).toBe('code')
  })

  it('converts CSV files into structured table blocks', async () => {
    const filePath = join(FIXTURES_DIR, 'sample.csv')
    const result = await convertSourceFile(config, filePath, 'sample.csv')

    expect(result.status).toBe('complete')
    expect(result.format).toBe('csv')
    expect(result.blocks.length).toBeGreaterThanOrEqual(2)
    expect(result.markdown).toContain('|')
  })

  it('converts DOCX files with native extractor and preserves structural elements', async () => {
    const filePath = join(FIXTURES_DIR, 'sample.docx')
    const result = await convertSourceFile(config, filePath, 'sample.docx', { preferWorker: false })

    expect(result.status).toBe('partial')
    expect(result.diagnostics.omissions).toContain('headers and footers')
    expect(result.format).toBe('docx')
    expect(result.markdown).toContain('社区项目执行规范')
    expect(result.blocks.length).toBeGreaterThanOrEqual(1)
    expect(result.blocks.some(b => b.kind === 'paragraph')).toBe(true)
  })

  it('rejects legacy formats (.doc, .ppt, .xls, .odt) as unsupported', async () => {
    const legacyPath = join(tempDir, 'legacy.doc')
    await writeFile(legacyPath, 'dummy legacy bytes')

    const result = await convertSourceFile(config, legacyPath, 'legacy.doc')
    expect(result.status).toBe('unsupported')
    expect(result.diagnostics.warnings[0]).toContain('not supported')
  })

  it('enforces maximum output size limit', async () => {
    const bigFile = join(tempDir, 'big.txt')
    await writeFile(bigFile, 'a'.repeat(2000))

    await expect(convertSourceFile(config, bigFile, 'big.txt', { maxBytes: 500 }))
      .rejects.toThrow(AskKnowledgeError)
  })

  it('reports malformed native inputs as failed, never complete', async () => {
    const dummyPath = join(tempDir, 'test.docx')
    await writeFile(dummyPath, 'content')
    const res = await runAnyDocWorker(config, { inputPath: dummyPath, format: 'docx' })
    expect(res.status).toBe('failed')
    expect(res.error).toBeTruthy()
    expect(res.markdown).toBe('')
  })

  it('converts the real DOCX fixture with the installed native addon', async () => {
    const res = await runAnyDocWorker(config, { inputPath: join(FIXTURES_DIR, 'sample.docx'), format: 'docx' })
    expect(res.status).toBe('complete')
    expect(res.markdown).toContain('社区项目执行规范')
    expect(res.blocks.every(block => res.markdown.slice(block.charOffset).startsWith(block.text))).toBe(true)
  })

  it('terminates converter worker immediately on AbortSignal', async () => {
    const dummyPath = join(tempDir, 'test.docx')
    await writeFile(dummyPath, 'content')

    const controller = new AbortController()
    const promise = runAnyDocWorker(config, {
      inputPath: dummyPath,
      format: 'docx',
      signal: controller.signal,
    })

    controller.abort()
    await expect(promise).rejects.toThrow(AskKnowledgeError)
  })
})
