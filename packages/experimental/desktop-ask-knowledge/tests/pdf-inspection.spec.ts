import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { convertSourceFile } from '../src/conversion.ts'
import type { AskKnowledgeHomeConfig } from '../src/knowledge-home.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'conversion')

describe('pdf conversion and content inspection', () => {
  let tempDir: string
  let config: AskKnowledgeHomeConfig

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ak-pdf-test-'))
    const sidecarHome = join(tempDir, 'sidecar')
    await mkdir(sidecarHome, { recursive: true })
    await installPythonSidecar(sidecarHome)
    config = { sidecarRuntimePath: sidecarHome }
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('extracts full text from latin.pdf with complete status', async () => {
    const filePath = join(FIXTURES_DIR, 'latin.pdf')
    const result = await convertSourceFile(config, filePath, 'latin.pdf')

    expect(result.status).toBe('complete')
    expect(result.format).toBe('pdf')
    expect(result.markdown).toContain('Community Training Plan')
    expect(result.markdown).toContain('Budget 2000 dollars')
    expect(result.blocks.length).toBeGreaterThanOrEqual(1)
    expect(result.diagnostics.warnings).toEqual([])
  })

  it('extracts Chinese text from text.pdf without cloud OCR (AC7)', async () => {
    const filePath = join(FIXTURES_DIR, 'text.pdf')
    const result = await convertSourceFile(config, filePath, 'text.pdf')

    expect(result.status).toBe('complete')
    expect(result.markdown).toContain('社区培训计划')
    expect(result.markdown).toContain('预算2000元')
    expect(result.diagnostics.unsupportedFeatures).not.toContain('optical character recognition')
  })

  it('discloses mixed-pages omissions truthfully (AC6)', async () => {
    const filePath = join(FIXTURES_DIR, 'mixed-pages.pdf')
    const result = await convertSourceFile(config, filePath, 'mixed-pages.pdf')

    expect(result.status).toBe('partial')
    expect(result.markdown).toContain('Community Training Plan')
    expect(result.diagnostics.needsOcrPages).toContain(2)
    expect(result.diagnostics.warnings.some(w => w.includes('needs OCR'))).toBe(true)
    expect(result.diagnostics.omissions).toContain('page 2')
  })

  it('discloses cover-only text and image presence for mixed.pdf (AC6)', async () => {
    const filePath = join(FIXTURES_DIR, 'mixed.pdf')
    const result = await convertSourceFile(config, filePath, 'mixed.pdf')

    expect(result.status).toBe('partial')
    expect(result.diagnostics.warnings.some(w => w.includes('image'))).toBe(true)
  })

  it('identifies scanned image PDF as needs_ocr without cloud OCR upload', async () => {
    const filePath = join(FIXTURES_DIR, 'scan.pdf')
    const result = await convertSourceFile(config, filePath, 'scan.pdf')

    expect(result.status).toBe('needs_ocr')
    expect(result.markdown).toBe('')
    expect(result.diagnostics.needsOcrPages).toContain(1)
  })
})
