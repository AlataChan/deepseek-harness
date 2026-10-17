import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installPythonSidecar } from './helpers/install-sidecar.ts'
import { runSidecar } from '../src/sidecar.ts'

describe('full-manifest token budget planning and preflight verification', () => {
  let sidecarHome: string

  beforeAll(async () => {
    sidecarHome = await mkdtemp(join(tmpdir(), 'kb-budget-test-'))
    await installPythonSidecar(sidecarHome)
  })

  afterAll(async () => {
    if (sidecarHome) {
      await rm(sidecarHome, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('calculates full manifest token budget under byte-fallback policy for 200k CJK workload', async () => {
    const config = { sidecarRuntimePath: sidecarHome }

    // Mock 100 chunks representing 200,000 CJK characters (~2,000 chars each)
    const sampleText = '社区数字化能力建设指南，涵盖合规核销、原始凭证管理与信息安全。'.repeat(30)
    const mockChunks = Array.from({ length: 100 }, (_, i) => ({
      chunkId: `c_${i + 1}`,
      primaryText: sampleText,
      fullText: sampleText,
    }))

    const res = await runSidecar(config, {
      command: 'calculate-budget',
      policy: 'byte-fallback',
      chunks: mockChunks,
      approvedBudget: 1_000_000,
    })

    expect(res.ok).toBe(true)
    expect(res.policy).toBe('byte-fallback')
    expect(res.totalChunks).toBe(100)
    expect(res.inputTokens).toBeGreaterThan(200_000)
    expect(res.outputTokensReserved).toBe(2048 * 100)
    expect(res.totalTokensRequired).toBeGreaterThan(450_000)
    expect(res.canProceed).toBe(true)
    expect(res.deficit).toBe(0)
  })

  it('refuses an exact policy when no verified tokenizer is available', async () => {
    const config = { sidecarRuntimePath: sidecarHome }

    const sampleText = '社区培训项目执行规范与财务核销制度。'.repeat(40)
    const mockChunks = Array.from({ length: 50 }, (_, i) => ({
      chunkId: `c_${i + 1}`,
      primaryText: sampleText,
      fullText: sampleText,
    }))

    await expect(runSidecar(config, {
      command: 'calculate-budget',
      policy: 'deepseek-chat',
      chunks: mockChunks,
    })).rejects.toThrow(/Exact tokenizer unavailable/)

  })

  it('rejects inadequate prefix-only budget with explicit deficit (AC20)', async () => {
    const config = { sidecarRuntimePath: sidecarHome }

    const sampleText = '社区项目执行规范。'.repeat(50)
    const mockChunks = Array.from({ length: 50 }, (_, i) => ({
      chunkId: `c_${i + 1}`,
      primaryText: sampleText,
      fullText: sampleText,
    }))

    // Inadequate budget of only 5,000 tokens for a 50-chunk job
    const res = await runSidecar(config, {
      command: 'calculate-budget',
      policy: 'byte-fallback',
      chunks: mockChunks,
      approvedBudget: 5_000,
    })

    expect(res.ok).toBe(true)
    expect(res.canProceed).toBe(false)
    expect(res.deficit).toBeGreaterThan(150_000)
  })

  it('rejects unknown token estimation policy', async () => {
    const config = { sidecarRuntimePath: sidecarHome }

    await expect(runSidecar(config, {
      command: 'calculate-budget',
      policy: 'heuristic-chars-div-4', // forbidden by AC20
      chunks: [{ primaryText: 'test' }],
    })).rejects.toThrow()
  })
})
