import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    if (!chunk2) throw new Error('Expected a second structural chunk')
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

  it('fails execute-document if the final manifest span is deleted (A2 negative control)', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'kb-a2-neg-'))
    try {
      await mkdir(join(vault, 'raw'), { recursive: true })
      const fullText = `# 第一节\n\n${'第一部分制度要求。'.repeat(60)}\n\n# 第二节\n\n${'结尾附加例外条款。'.repeat(60)}\n`
      await writeFile(join(vault, 'raw', 'doc-a2.md'), fullText, 'utf8')
      const config = { sidecarRuntimePath: sidecarHome }
      const regRes = await runSidecar(config, {
        command: 'register-source-revision',
        vault,
        libraryId: 'lib-a2',
        documentId: 'doc-a2',
        filename: 'doc-a2.md',
        sha256: 'a'.repeat(64),
        byteLength: Buffer.byteLength(fullText, 'utf8'),
        objectPath: 'raw/doc-a2.md',
      })
      const revisionId = (regRes.revision as { revisionId: string }).revisionId
      const planRes = await runSidecar(config, {
        command: 'plan-document',
        vault,
        libraryId: 'lib-a2',
        documentId: 'doc-a2',
        revisionId,
        rawPath: 'raw/doc-a2.md',
        chunkChars: 400,
      })
      expect(planRes.ok).toBe(true)
      expect(Number(planRes.totalChunks)).toBeGreaterThan(1)

      // Tamper with the persisted plan manifest by deleting the final span
      const { createHash } = await import('node:crypto')
      const planFile = `${createHash('sha256').update('doc-a2').digest('hex')}.json`
      const planPath = join(vault, '.octopus-kb', 'document-plans', planFile)
      const plan = JSON.parse(await readFile(planPath, 'utf8')) as Record<string, unknown> & { chunks: unknown[] }
      plan.chunks.pop()
      await writeFile(planPath, JSON.stringify(plan), 'utf8')

      // 1. Tampering without recomputing planHash fails frozen manifest integrity check
      await expect(runSidecar(config, {
        command: 'execute-document',
        vault,
        libraryId: 'lib-a2',
        documentId: 'doc-a2',
        revisionId,
        expectedPlanHash: String(planRes.planHash),
        approvedTokens: Number(planRes.estimatedTokens),
      })).rejects.toThrow(/Frozen request manifest integrity check failed/)

      // 2. Even if planHash is recomputed over the truncated chunks, verify_chunk_coverage rejects the missing final span
      const frozenKeys = [
        'version', 'documentId', 'revisionId', 'libraryId', 'rawPath',
        'rawSha256', 'route', 'promptVersion', 'conversion', 'chunks', 'tokenEstimate',
        'retryReserve', 'estimator', 'totalChunks', 'totalChars', 'retryNonce',
        'chunkChars', 'outputReserve', 'contextChars', 'conversionStatus',
      ]
      const sortDeep = (val: unknown): unknown => {
        if (Array.isArray(val)) return val.map(sortDeep)
        if (val !== null && typeof val === 'object') {
          return Object.fromEntries(
            Object.keys(val as Record<string, unknown>)
              .sort()
              .map(k => [k, sortDeep((val as Record<string, unknown>)[k])]),
          )
        }
        return val
      }
      const frozenObj = Object.fromEntries(frozenKeys.sort().map(k => [k, sortDeep(plan[k])]))
      const forgedHash = createHash('sha256').update(JSON.stringify(frozenObj)).digest('hex')
      plan.planHash = forgedHash
      await writeFile(planPath, JSON.stringify(plan), 'utf8')

      await expect(runSidecar(config, {
        command: 'execute-document',
        vault,
        libraryId: 'lib-a2',
        documentId: 'doc-a2',
        revisionId,
        expectedPlanHash: forgedHash,
        approvedTokens: Number(planRes.estimatedTokens),
      })).rejects.toThrow(/Range manifest failed full-document coverage.*Trailing gap/)
    } finally {
      await rm(vault, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('surfaces redacted HTTP status diagnostics on non-JSON LLM responses and bypasses HTTP_PROXY for loopback', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'kb-http-diag-'))
    let mode: 'empty-403' | 'html-502' = 'empty-403'
    const server = createServer((_req, res) => {
      if (mode === 'empty-403') {
        res.writeHead(403, { 'content-type': 'text/plain' })
        res.end('')
        return
      }
      res.writeHead(502, { 'content-type': 'text/html' })
      res.end('<html>Gateway Error for Bearer secret-token-99999999, sk-secretkey1234567890, and api_key=synthetic-provider-credential-1234567890 (raw synthetic-provider-credential-1234567890)</html>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const prevHttpProxy = process.env.HTTP_PROXY
    const prevLowerHttpProxy = process.env.http_proxy
    process.env.HTTP_PROXY = 'http://127.0.0.1:1'
    process.env.http_proxy = 'http://127.0.0.1:1'
    try {
      const config = { sidecarRuntimePath: sidecarHome }
      await mkdir(join(vault, 'raw'), { recursive: true })
      await mkdir(join(vault, 'wiki'), { recursive: true })
      await mkdir(join(vault, '.octopus-kb'), { recursive: true })
      await writeFile(
        join(vault, '.octopus-kb', 'config.toml'),
        `version = 1\n[llm]\ndefault_profile = "deepseek"\n[llm.profiles.deepseek]\nbase_url = "http://127.0.0.1:${port}/v1"\nmodel = "deepseek-v4-flash"\napi_key_env = "DEEPSEEK_API_KEY"\n`,
        'utf8',
      )
      const body = '# 标题\n\n核销流程说明。\n'
      await writeFile(join(vault, 'raw', 'doc-diag.md'), body, 'utf8')
      const regRes = await runSidecar(config, {
        command: 'register-source-revision',
        vault,
        libraryId: 'lib-diag',
        documentId: 'doc-diag',
        filename: 'doc-diag.md',
        sha256: 'b'.repeat(64),
        byteLength: Buffer.byteLength(body, 'utf8'),
        objectPath: 'raw/doc-diag.md',
      })
      const revisionId = (regRes.revision as { revisionId: string }).revisionId
      const planRes = await runSidecar(config, {
        command: 'plan-document',
        vault,
        libraryId: 'lib-diag',
        documentId: 'doc-diag',
        revisionId,
        rawPath: 'raw/doc-diag.md',
      })
      const expectedPlanHash = String(planRes.planHash)
      const approvedTokens = Number(planRes.estimatedTokens)

      await expect(runSidecar(config, {
        command: 'execute-document',
        vault,
        libraryId: 'lib-diag',
        documentId: 'doc-diag',
        revisionId,
        expectedPlanHash,
        approvedTokens,
      }, {
        env: {
          DEEPSEEK_API_KEY: 'synthetic-provider-credential-1234567890',
        },
      })).rejects.toThrow(/HTTP 403 \(empty response body\)/)

      mode = 'html-502'
      const regRes2 = await runSidecar(config, {
        command: 'register-source-revision',
        vault,
        libraryId: 'lib-diag',
        documentId: 'doc-diag-2',
        filename: 'doc-diag.md',
        sha256: 'c'.repeat(64),
        byteLength: Buffer.byteLength(body, 'utf8'),
        objectPath: 'raw/doc-diag.md',
      })
      const revisionId2 = (regRes2.revision as { revisionId: string }).revisionId
      const planRes2 = await runSidecar(config, {
        command: 'plan-document',
        vault,
        libraryId: 'lib-diag',
        documentId: 'doc-diag-2',
        revisionId: revisionId2,
        rawPath: 'raw/doc-diag.md',
      })
      await expect(runSidecar(config, {
        command: 'execute-document',
        vault,
        libraryId: 'lib-diag',
        documentId: 'doc-diag-2',
        revisionId: revisionId2,
        expectedPlanHash: String(planRes2.planHash),
        approvedTokens: Number(planRes2.estimatedTokens),
      }, {
        env: {
          DEEPSEEK_API_KEY: 'synthetic-provider-credential-1234567890',
        },
      })).rejects.toSatisfy((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        return msg.includes('HTTP 502')
          && msg.includes('[REDACTED]')
          && !msg.includes('secret-token-99999999')
          && !msg.includes('sk-secretkey1234567890')
          && !msg.includes('synthetic-provider-credential-1234567890')
      })
    } finally {
      if (prevHttpProxy === undefined) delete process.env.HTTP_PROXY
      else process.env.HTTP_PROXY = prevHttpProxy
      if (prevLowerHttpProxy === undefined) delete process.env.http_proxy
      else process.env.http_proxy = prevLowerHttpProxy
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(vault, { recursive: true, force: true }).catch(() => {})
    }
  })
})
