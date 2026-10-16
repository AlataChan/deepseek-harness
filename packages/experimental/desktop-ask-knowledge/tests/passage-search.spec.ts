/**
 * Full-text passage search, offset mapping, radical equivalence, hostile syntax,
 * continuation cursors, and late fact retrieval tests.
 */

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import {
  checkSqliteRuntime,
  indexLibraryVault,
  searchLibraryPassages,
} from '../src/document-retrieve.ts'
import { tokenEstimate } from '../src/result-bounds.ts'
import { installPythonSidecar } from './helpers/install-sidecar.ts'

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/document-coverage', import.meta.url))
const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function setupTestVault() {
  const root = await mkdtemp(join(tmpdir(), 'ak-passage-test-'))
  const sidecarHome = join(root, 'sidecar')
  const knowledgeHome = join(root, 'knowledge')
  const kbRoot = join(knowledgeHome, 'knowledge-bases')
  const vaultDir = join(kbRoot, 'libraries', '11111111-1111-1111-1111-111111111111')
  const rawDir = join(vaultDir, 'raw')

  await mkdir(sidecarHome, { recursive: true })
  await mkdir(rawDir, { recursive: true })
  await installPythonSidecar(sidecarHome)

  // Write proper catalog.json under knowledge-bases/
  await mkdir(kbRoot, { recursive: true })
  await writeFile(
    join(kbRoot, 'catalog.json'),
    JSON.stringify({
      version: 1,
      libraries: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          displayName: '测试知识库',
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          vaultRelPath: 'libraries/11111111-1111-1111-1111-111111111111',
        },
      ],
    }),
    'utf8',
  )

  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true })
  })

  return { root, sidecarHome, knowledgeHome, vaultDir, rawDir, kbRoot }
}

describe('ask-knowledge passage search and indexing', () => {
  it('preflights python sqlite runtime capabilities', async () => {
    const { sidecarHome } = await setupTestVault()
    const check = await checkSqliteRuntime({ sidecarRuntimePath: sidecarHome })
    expect(check.ok).toBe(true)
    expect(check.fts5).toBe(true)
    expect(check.trigram).toBe(true)
    expect(check.error).toBeNull()
  })

  it('retrieves late facts past 12,000 and 32,000 character boundaries', async () => {
    const { sidecarHome, knowledgeHome, rawDir } = await setupTestVault()

    // Copy long-document.md (>39k characters) into vault raw/
    await copyFile(join(FIXTURES_DIR, 'long-document.md'), join(rawDir, '管理办法.md'))

    const libId = AskKnowledgeLibraryId('11111111-1111-1111-1111-111111111111')
    const idx = await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, knowledgeHome, libId)
    expect(idx.indexedFiles).toBe(1)
    expect(idx.totalPassages).toBeGreaterThan(15)

    // 1. Beginning fact (< 1000 chars)
    const beg = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['基础津贴'] },
    )
    expect(beg.items.length).toBeGreaterThan(0)
    expect(beg.items[0]?.text).toContain('第一条：基础津贴标准为每月五百元整')

    // 2. Middle fact (> 17,000 chars, past old 12,000 limit)
    const mid = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['中途审批'] },
    )
    expect(mid.items.length).toBeGreaterThan(0)
    expect(mid.items[0]?.text).toContain('第四十五条：中途审批必须在三个工作日内由财务部复核')

    // 3. Footnote (> 17,000 chars)
    const footnote = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['涉外项目'] },
    )
    expect(footnote.items.length).toBeGreaterThan(0)
    expect(footnote.items[0]?.text).toContain('[^1]: 补充说明：涉外项目开支执行单独的外币兑换核算标准。')

    // 4. Final fact (> 34,000 chars, past old 32,000 limit)
    const fin = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['年终清算'] },
    )
    expect(fin.items.length).toBeGreaterThan(0)
    expect(fin.items[0]?.text).toContain('第一百二十条：末尾条款特别声明：所有年终清算款项必须在十二月三十一日前结算归零。')

    // 5. Late table row (> 35,000 chars)
    const tbl = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['结算尾项'] },
    )
    expect(tbl.items.length).toBeGreaterThan(0)
    expect(tbl.items[0]?.text).toContain('| 结算尾项 | 9999元 | 最终确认无误 |')

    // 6. Cross-section exception
    const exc = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['紧急救援'] },
    )
    expect(exc.items.length).toBeGreaterThan(0)
    expect(exc.items[0]?.text).toContain('例外规定：紧急救援支出不受第一百二十条清算期限限制。')
  })

  it('supports 2-character Chinese queries, radical equivalence, and folded characters', async () => {
    const { sidecarHome, knowledgeHome, rawDir } = await setupTestVault()

    // Document with Kangxi radical U+2F00 (⼀), German ß, combining e+acute
    const text = [
      '# 词条规程',
      '第⼀条：基础津贴与报销制度。', // ⼀ is Kangxi radical U+2F00
      '第二条：各级干部必须严守政治纪律与工作条例。',
      '第三条：有关 Straße 与 café 的涉外规定。', // combining / German
    ].join('\n\n')
    await writeFile(join(rawDir, 'radicals.md'), text, 'utf8')

    const libId = AskKnowledgeLibraryId('11111111-1111-1111-1111-111111111111')
    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, knowledgeHome, libId)

    // 2-character queries
    const expense = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['报销'] },
    )
    expect(expense.items.length).toBeGreaterThan(0)
    expect(expense.items[0]?.text).toContain('报销制度')

    const discipline = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['纪律', '条例'] },
    )
    expect(discipline.items.length).toBeGreaterThan(0)
    expect(discipline.items[0]?.text).toContain('政治纪律与工作条例')

    // Radical equivalence: standard '第一条' matches Kangxi '第⼀条'
    const radical = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['第一条'] },
    )
    expect(radical.items.length).toBeGreaterThan(0)
    // Quoted display text preserves the original raw file bytes
    expect(radical.items[0]?.text).toContain('第⼀条')

    // German ß matching 'strasse'
    const strasse = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['strasse'] },
    )
    expect(strasse.items.length).toBeGreaterThan(0)
    expect(strasse.items[0]?.text).toContain('Straße')
  })

  it('neutralizes hostile FTS syntax and prevents operator injection', async () => {
    const { sidecarHome, knowledgeHome, rawDir } = await setupTestVault()

    await writeFile(
      join(rawDir, 'syntax.md'),
      '# 特殊语法测试\n\n包含引号 "培训" 与括号 (AND/OR) 100% 的政策条例。\n',
      'utf8',
    )

    const libId = AskKnowledgeLibraryId('11111111-1111-1111-1111-111111111111')
    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, knowledgeHome, libId)

    // Hostile syntax queries that would crash unquoted FTS5
    const hostileQueries = [
      '*"OR"*',
      'AND (OR) NOT',
      '"""""',
      'NEAR(培训, 10)',
      '培训 OR "NOT',
    ]

    for (const q of hostileQueries) {
      const res = await searchLibraryPassages(
        { sidecarRuntimePath: sidecarHome },
        knowledgeHome,
        { libraryId: libId, queries: [q] },
      )
      expect(res.warnings).toBeDefined()
    }
  })

  it('distinguishes target policy from distractor with same keywords', async () => {
    const { sidecarHome, knowledgeHome, rawDir } = await setupTestVault()

    await copyFile(join(FIXTURES_DIR, 'long-document.md'), join(rawDir, '政策.md'))
    await copyFile(join(FIXTURES_DIR, 'distractor.md'), join(rawDir, '古代故事.md'))

    const libId = AskKnowledgeLibraryId('11111111-1111-1111-1111-111111111111')
    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, knowledgeHome, libId)

    const res = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['基础津贴'] },
    )
    expect(res.items.length).toBeGreaterThan(0)
    // The policy document ranks higher than ancient market distractor
    expect(res.items[0]?.path).toBe('raw/政策.md')
    expect(res.items[0]?.text).toContain('第一条：基础津贴标准为每月五百元整')
  })

  it('supports pagination with continuation cursors and refuses forged/cross-library cursors', async () => {
    const { sidecarHome, knowledgeHome, rawDir, kbRoot } = await setupTestVault()

    for (let i = 1; i <= 6; i++) {
      await writeFile(
        join(rawDir, `doc_${i}.md`),
        `# 规程第${i}号\n\n这里记录专项清算与审批规章第${i}条内容。\n`,
        'utf8',
      )
    }

    const libId = AskKnowledgeLibraryId('11111111-1111-1111-1111-111111111111')
    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, knowledgeHome, libId)

    // Page 1
    const p1 = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['清算'], limit: 2 },
    )
    expect(p1.items.length).toBe(2)
    expect(p1.cursor).toBeTruthy()

    // Page 2 using cursor
    const p2 = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['清算'], limit: 2, cursor: p1.cursor! },
    )
    expect(p2.items.length).toBe(2)
    expect(p2.items[0]?.passageId).not.toBe(p1.items[0]?.passageId)

    // Forged cursor
    await expect(
      searchLibraryPassages(
        { sidecarRuntimePath: sidecarHome },
        knowledgeHome,
        { libraryId: libId, queries: ['清算'], cursor: 'tampered-signature-cursor' },
      ),
    ).rejects.toThrow()

    // Cross-library cursor refusal:
    // Create second library
    const catalogRaw = await readFile(join(kbRoot, 'catalog.json'), 'utf8')
    const catalog = JSON.parse(catalogRaw)
    catalog.libraries.push({
      id: '22222222-2222-2222-2222-222222222222',
      displayName: '第二库',
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      vaultRelPath: 'libraries/22222222-2222-2222-2222-222222222222',
    })
    await writeFile(join(kbRoot, 'catalog.json'), JSON.stringify(catalog), 'utf8')
    await mkdir(join(kbRoot, 'libraries', '22222222-2222-2222-2222-222222222222', 'raw'), { recursive: true })
    const lib2Id = AskKnowledgeLibraryId('22222222-2222-2222-2222-222222222222')
    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, knowledgeHome, lib2Id)

    // Using cursor from lib-1 on lib-2 must fail
    await expect(
      searchLibraryPassages(
        { sidecarRuntimePath: sidecarHome },
        knowledgeHome,
        { libraryId: lib2Id, queries: ['清算'], cursor: p1.cursor! },
      ),
    ).rejects.toThrow(/cross-library|signature/i)
  }, 15_000)

  it('updates index when raw files change or are deleted', async () => {
    const { sidecarHome, knowledgeHome, rawDir } = await setupTestVault()

    const fileA = join(rawDir, 'doc_a.md')
    await writeFile(fileA, '# 初始版本\n初始条款内容。\n', 'utf8')

    const libId = AskKnowledgeLibraryId('11111111-1111-1111-1111-111111111111')
    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, knowledgeHome, libId)

    const before = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['初始条款'] },
    )
    expect(before.items.length).toBe(1)

    // Update file
    await writeFile(fileA, '# 更新版本\n已修改为全新结算条款。\n', 'utf8')
    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, knowledgeHome, libId)

    const afterUpdate = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['全新结算'] },
    )
    expect(afterUpdate.items.length).toBe(1)

    // Delete file
    await rm(fileA)
    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, knowledgeHome, libId)

    const afterDelete = await searchLibraryPassages(
      { sidecarRuntimePath: sidecarHome },
      knowledgeHome,
      { libraryId: libId, queries: ['全新结算'] },
    )
    expect(afterDelete.items.length).toBe(0)
  })

  it('estimates Chinese tokens conservatively avoiding characters/4 undercounting', () => {
    const chineseText = '社区社会组织综合管理办法' // 12 Chinese characters
    const estimate = tokenEstimate(chineseText)
    // 12 chars / 4 would be only 3 tokens!
    // But 12 Chinese chars are 36 UTF-8 bytes, which should budget >= 14 tokens
    expect(estimate).toBeGreaterThanOrEqual(14)
  })
})
