import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { splitMarkdownIntoBlocks } from '../src/conversion.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'
import { runSidecar } from '../src/sidecar.ts'

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'document-coverage')

describe('document chunking and span coverage', () => {
  let sidecarHome: string

  beforeAll(async () => {
    sidecarHome = await mkdtemp(join(tmpdir(), 'kb-chunk-test-'))
    await installPythonSidecar(sidecarHome)
  })

  afterAll(async () => {
    if (sidecarHome) {
      await rm(sidecarHome, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('divides long document into contiguous chunks with 100% verified coverage', async () => {
    const longDocPath = join(FIXTURES_DIR, 'long-document.md')
    const fullText = await readFile(longDocPath, 'utf8')
    const blocks = splitMarkdownIntoBlocks(fullText)

    const config = { sidecarRuntimePath: sidecarHome }

    const res = await runSidecar(config, {
      command: 'create-chunks',
      documentId: 'doc-long',
      revisionId: 'rev-001',
      blocks,
      fullText,
      maxChunkChars: 1500,
      overlapChars: 200,
    })

    expect(res.ok).toBe(true)
    expect(res.totalChunks).toBeGreaterThan(15)
    expect(res.totalChars).toBe(fullText.length)

    // Verify coverage via verify-chunks
    const verifyRes = await runSidecar(config, {
      command: 'verify-chunks',
      fullText,
      chunks: res.chunks,
    })

    expect(verifyRes.ok).toBe(true)
    expect(verifyRes.coveredChars).toBe(fullText.length)
    expect(verifyRes.errors).toEqual([])
  })

  it('preserves 100% contiguous coverage on a 200,000-character CJK document', async () => {
    // Generate 200,000-character synthetic document
    const basePara = '社区组织数字化发展指南，涵盖项目管理、财务核销与信息安全执行规范。每项支出必须保留原始凭证并归档。'
    const paragraphs: string[] = []
    let totalLen = 0
    let pIdx = 1

    while (totalLen < 200_000) {
      const p = `## 章节 ${pIdx}\n\n${basePara.repeat(25)}\n\n`
      paragraphs.push(p)
      totalLen += p.length
      pIdx++
    }
    const fullText = paragraphs.join('')
    const blocks = splitMarkdownIntoBlocks(fullText)

    const config = { sidecarRuntimePath: sidecarHome }

    const res = await runSidecar(config, {
      command: 'create-chunks',
      documentId: 'doc-200k',
      revisionId: 'rev-200k',
      blocks,
      fullText,
      maxChunkChars: 1500,
      overlapChars: 200,
    })

    expect(res.ok).toBe(true)
    expect(res.totalChunks).toBeGreaterThan(100)

    const verifyRes = await runSidecar(config, {
      command: 'verify-chunks',
      fullText,
      chunks: res.chunks,
    })

    expect(verifyRes.ok).toBe(true)
    expect(verifyRes.coveredChars).toBe(fullText.length)
    expect(verifyRes.errors).toEqual([])
  })

  it('repeats table headers for continuation chunks across table splits', async () => {
    const tableHeader = '| 项目 | 预算（元） | 说明 |\n| --- | --- | --- |\n'
    const rows = Array.from({ length: 150 }, (_, i) => `| 社区培训项目第${i + 1}期 | 2000 | 包含场地与材料费 |\n`).join('')
    const fullText = tableHeader + rows
    const blocks = splitMarkdownIntoBlocks(fullText)

    const config = { sidecarRuntimePath: sidecarHome }

    const res = await runSidecar(config, {
      command: 'create-chunks',
      documentId: 'doc-table',
      revisionId: 'rev-table',
      blocks,
      fullText,
      maxChunkChars: 800,
      overlapChars: 100,
    })

    expect(res.ok).toBe(true)
    expect(res.totalChunks).toBeGreaterThan(3)

    // Second chunk onward should have contextHeader with table header
    const chunk2 = (res.chunks as readonly { readonly contextHeader: string }[])[1]
    expect(chunk2.contextHeader).toContain('Table Context: | 项目 | 预算（元） | 说明 |')
  })

  it('rejects missing spans or gaps in independent coverage checker', async () => {
    const fullText = '第一部分内容。第二部分内容。第三部分内容。'
    const config = { sidecarRuntimePath: sidecarHome }

    // Chunks with an injected gap (chars 7 to 10 skipped)
    const faultyChunks = [
      {
        primaryStartChar: 0,
        primaryEndChar: 7,
        primaryText: fullText.slice(0, 7),
      },
      {
        primaryStartChar: 10,
        primaryEndChar: fullText.length,
        primaryText: fullText.slice(10),
      },
    ]

    const verifyRes = await runSidecar(config, {
      command: 'verify-chunks',
      fullText,
      chunks: faultyChunks,
    })

    expect(verifyRes.valid).toBe(false)
    expect((verifyRes.errors as string[]).some((e: string) => e.includes('Gap detected'))).toBe(true)
  })

  it('rejects duplicate or overlapping primary spans in independent coverage checker', async () => {
    const fullText = '第一部分内容。第二部分内容。第三部分内容。'
    const config = { sidecarRuntimePath: sidecarHome }

    // Chunks with overlapping primary ranges
    const overlappingChunks = [
      {
        primaryStartChar: 0,
        primaryEndChar: 15,
        primaryText: fullText.slice(0, 15),
      },
      {
        primaryStartChar: 10, // overlap 10 < 15
        primaryEndChar: fullText.length,
        primaryText: fullText.slice(10),
      },
    ]

    const verifyRes = await runSidecar(config, {
      command: 'verify-chunks',
      fullText,
      chunks: overlappingChunks,
    })

    expect(verifyRes.valid).toBe(false)
    expect((verifyRes.errors as string[]).some((e: string) => e.includes('Duplicate/overlapping'))).toBe(true)
  })
})
