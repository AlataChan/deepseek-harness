/**
 * Document coverage baseline characterization and acceptance fixture tests.
 * Characterizes current production caller bounds (propose 12k, extract 32k, retrieve 4k)
 * and verifies self-contained synthetic fixtures without external dependencies.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ASK_KNOWLEDGE_EXTRACT_MAX_CHARS } from '@deepseek-ai/dsh-host-ask-knowledge'
import { clipExtractText } from '../src/extract.ts'
import { extractDocxBytes } from '../src/extract-docx.ts'
import { clipItemText, ITEM_TEXT_LIMIT } from '../src/result-bounds.ts'

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/document-coverage', import.meta.url))

interface ExpectedFact {
  id: string
  location: string
  section: string
  query: string
  text: string
  must_appear_before_char?: number
  must_appear_after_char?: number
  must_appear_between_chars?: [number, number]
}

interface ExpectedFactsManifest {
  version: string
  long_document: {
    filename: string
    facts: ExpectedFact[]
  }
  distractor_document: {
    filename: string
    description: string
    keywords: string[]
  }
  short_terms: {
    filename: string
    terms: string[]
  }
  evaluation_fixtures: Record<string, unknown>
}

interface BaselineReport {
  report_version: string
  evaluated_at: string
  production_caps: {
    RAW_PROPOSE_CHARS: number
    ASK_KNOWLEDGE_EXTRACT_MAX_CHARS: number
    ITEM_TEXT_LIMIT: number
    DEFAULT_MAX_RESULT_CHARS: number
    DEFAULT_MAX_RESULT_TOKENS: number
  }
  observed_production_behavior: Record<string, unknown>
  format_routing_baseline: Record<string, string>
}

describe('document coverage baseline characterization', () => {
  it('loads and validates the expected facts manifest and offsets in long-document.md', async () => {
    const manifestRaw = await readFile(join(FIXTURES_DIR, 'expected-facts.json'), 'utf8')
    const manifest: ExpectedFactsManifest = JSON.parse(manifestRaw)
    expect(manifest.version).toBe('1.0.0')

    const longDoc = await readFile(join(FIXTURES_DIR, manifest.long_document.filename), 'utf8')
    const codePointCount = [...longDoc].length
    expect(codePointCount).toBeGreaterThan(35_000)

    for (const fact of manifest.long_document.facts) {
      const idx = [...longDoc.slice(0, longDoc.indexOf(fact.text))].length
      expect(longDoc).toContain(fact.text)
      if (fact.must_appear_before_char !== undefined) {
        expect(idx).toBeLessThan(fact.must_appear_before_char)
      }
      if (fact.must_appear_after_char !== undefined) {
        expect(idx).toBeGreaterThan(fact.must_appear_after_char)
      }
      if (fact.must_appear_between_chars !== undefined) {
        const [lo, hi] = fact.must_appear_between_chars
        expect(idx).toBeGreaterThanOrEqual(lo)
        expect(idx).toBeLessThanOrEqual(hi)
      }
    }
  })

  it('characterizes production extract.ts 32,000-char truncation on long document', async () => {
    const longDoc = await readFile(join(FIXTURES_DIR, 'long-document.md'), 'utf8')
    const manifestRaw = await readFile(join(FIXTURES_DIR, 'expected-facts.json'), 'utf8')
    const manifest: ExpectedFactsManifest = JSON.parse(manifestRaw)

    const clipped = clipExtractText(longDoc)
    expect(clipped.truncated).toBe(true)
    expect([...clipped.text].length).toBe(ASK_KNOWLEDGE_EXTRACT_MAX_CHARS)
    expect(ASK_KNOWLEDGE_EXTRACT_MAX_CHARS).toBe(32_000)

    // Beginning fact (< 1000 chars) is preserved
    const begFact = manifest.long_document.facts.find(f => f.id === 'fact-beginning')
    expect(begFact).toBeDefined()
    expect(clipped.text).toContain(begFact!.text)

    // Final facts (> 32,000 chars) are clipped and absent
    const finalFact = manifest.long_document.facts.find(f => f.id === 'fact-final')
    const lateTable = manifest.long_document.facts.find(f => f.id === 'fact-late-table')
    const exception = manifest.long_document.facts.find(f => f.id === 'fact-exception')
    expect(finalFact).toBeDefined()
    expect(lateTable).toBeDefined()
    expect(exception).toBeDefined()

    expect(clipped.text).not.toContain(finalFact!.text)
    expect(clipped.text).not.toContain(lateTable!.text)
    expect(clipped.text).not.toContain(exception!.text)
  })

  it('characterizes production result-bounds.ts 4,000-char item limit', async () => {
    const longDoc = await readFile(join(FIXTURES_DIR, 'long-document.md'), 'utf8')
    const manifestRaw = await readFile(join(FIXTURES_DIR, 'expected-facts.json'), 'utf8')
    const manifest: ExpectedFactsManifest = JSON.parse(manifestRaw)

    expect(ITEM_TEXT_LIMIT).toBe(4000)
    const clipped = clipItemText(longDoc)
    expect([...clipped].length).toBe(ITEM_TEXT_LIMIT)

    const begFact = manifest.long_document.facts.find(f => f.id === 'fact-beginning')
    const midFact = manifest.long_document.facts.find(f => f.id === 'fact-middle')
    const finalFact = manifest.long_document.facts.find(f => f.id === 'fact-final')

    expect(clipped).toContain(begFact!.text)
    expect(clipped).not.toContain(midFact!.text)
    expect(clipped).not.toContain(finalFact!.text)
  })

  it('characterizes production extract-docx.ts flattening and footnote omission', async () => {
    const docxBytes = new Uint8Array(await readFile(join(FIXTURES_DIR, 'sample.docx')))
    const extracted = extractDocxBytes(docxBytes)

    // Current extractDocxBytes flattens paragraphs and extracts text
    expect(extracted).toContain('社区项目执行规范')
    expect(extracted).toContain('社区培训')
    expect(extracted).toContain('2000')

    // But it does not format headings with Markdown '#'
    expect(extracted).not.toMatch(/^# 社区项目执行规范/m)

    // And it omits footnote text (which lives in word/footnotes.xml)
    expect(extracted).not.toContain('电子发票同样需要归档。')
  })

  it('characterizes distractor keywords and short-term radials/punctuation', async () => {
    const distractor = await readFile(join(FIXTURES_DIR, 'distractor.md'), 'utf8')
    const manifestRaw = await readFile(join(FIXTURES_DIR, 'expected-facts.json'), 'utf8')
    const manifest: ExpectedFactsManifest = JSON.parse(manifestRaw)

    // Distractor shares all target keywords
    for (const kw of manifest.distractor_document.keywords) {
      expect(distractor).toContain(kw)
    }
    // But does not contain the policy facts
    for (const fact of manifest.long_document.facts) {
      expect(distractor).not.toContain(fact.text)
    }

    const shortTerms = await readFile(join(FIXTURES_DIR, 'short-terms.md'), 'utf8')
    for (const term of manifest.short_terms.terms) {
      expect(shortTerms).toContain(term)
    }
  })

  it('verifies baseline report matches production configurations', async () => {
    const reportRaw = await readFile(join(FIXTURES_DIR, 'baseline-report.json'), 'utf8')
    const report: BaselineReport = JSON.parse(reportRaw)
    expect(report.production_caps.RAW_PROPOSE_CHARS).toBe(12_000)
    expect(report.production_caps.ASK_KNOWLEDGE_EXTRACT_MAX_CHARS).toBe(32_000)
    expect(report.production_caps.ITEM_TEXT_LIMIT).toBe(4_000)
    expect(report.production_caps.DEFAULT_MAX_RESULT_CHARS).toBe(24_000)
    expect(report.production_caps.DEFAULT_MAX_RESULT_TOKENS).toBe(6_000)
    expect(report.observed_production_behavior.propose_reads_prefix_only).toBeDefined()
  })
})
