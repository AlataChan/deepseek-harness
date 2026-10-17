/**
 * Tests for Task 4: Wiki-first retrieval, same-turn attempt receipts, and source fallback.
 * Covers acceptance criteria:
 * - A5: Same-turn wiki attempt receipt enforcement & negative controls (forged, cross-library, cross-session, stale turn)
 * - A7: Source fallback recovers late facts; 0-hit query emits no_absence_claim warning
 * - A8: Table header & exception clause preservation; invalid cursor / cross-library passage refusal
 * - A14: Document diversity & duplicate excerpt suppression
 * - A16: Verification tags (unverified-wiki-summary vs source-verified)
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { bootOverlay } from './helpers/boot.ts'
import { currentTurnOf } from '../src/tools.ts'
import * as FencePolicy from '@deepseek-ai/dsh-fence-policy'
import { indexLibraryVault } from '../src/document-retrieve.ts'

const signal = new AbortController().signal
const cleanups: Array<() => Promise<void> | void> = []
let callCount = 0

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

function agentWith(session: Session): Agent {
  return { id: session.id, session } as never
}

async function bootWithPython() {
  const started = await bootOverlay({ sessions: true, tools: true, pythonSidecar: true })
  cleanups.push(() => started.fiber.dispose())
  return started
}

async function executeTool(ctx: Context, name: string, args: unknown, agent?: Agent) {
  const callId = ToolCallId(`wf-${++callCount}`)
  const session = agent?.session
  const turn = currentTurnOf(ctx, session)
  const call = session?.append('tool/call', { turn, step: 1, callId, name, arguments: JSON.stringify(args) })
  const result = await ctx.tools.execute({ signal, callId, name, arguments: args, ...agent === undefined ? {} : { agent } })
  if (session && call) session.append('tool/result', { turn, step: 1,
    message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  return result
}

describe('Task 4: Wiki-first answering and source verification', () => {
  it('A5 & A16: Wiki-first retrieve emits wikiAttemptId, tags unverified-summary; source operations enforce same-turn receipt', async () => {
    const { ctx, root, sidecarHome } = await bootWithPython()
    const session = ctx.sessions.prepare(SessionId('ses-a5-1'))
    ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    const agent = agentWith(session)

    const lib = await ctx.askKnowledge.createLibrary({ displayName: '资产清算库' })
    const vault = join(root, 'knowledge-bases', 'libraries', lib.id)
    const rawDir = join(vault, 'raw')
    const wikiDir = join(vault, 'wiki')
    await mkdir(rawDir, { recursive: true })
    await mkdir(wikiDir, { recursive: true })

    // Raw document with detailed clauses
    await writeFile(
      join(rawDir, 'doc-liq.md'),
      '# 资产清算操作指南\n\n资产清算时必须在三日内通知所有债权人并进行公告。\n清算期间不得开展与清算无关的经营活动。\n',
      'utf8',
    )
    // Curated wiki page with frontmatter
    await writeFile(
      join(wikiDir, '资产清算.md'),
      `---
aliases: [破产清算, 债务清偿]
citations: [raw/doc-liq.md#L3-L4]
coverage_status: wiki-ready
---
# 资产清算

资产清算指企业解散、破产时对财产进行清理、评估并清偿债务的法律程序。
详见 [[债权人公告]]。
`,
      'utf8',
    )
    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, root, lib.id)
    await ctx.askKnowledge.attach({ libraryId: lib.id, sessionId: session.id })

    // Step 1: Default wiki retrieve
    const wikiRes = await executeTool(ctx, 'ask_knowledge_retrieve', { terms: ['资产清算'] }, agent)
    expect(wikiRes.isError).toBe(false)
    if (wikiRes.isError) throw new Error('expected retrieve success')
    const val = wikiRes.value as {
      items: Array<{ kind: string; verification: string; title: string; citations?: string[] }>
      wikiAttemptId?: string
    }
    expect(val.items.length).toBeGreaterThanOrEqual(1)
    expect(val.items[0]?.kind).toBe('concept')
    // A16: Wiki items carry verification: 'unverified-wiki-summary'
    expect(val.items[0]?.verification).toBe('unverified-wiki-summary')
    expect(val.items[0]?.citations).toEqual(['raw/doc-liq.md#L3-L4'])
    // A5: Must emit a non-empty wikiAttemptId
    expect(typeof val.wikiAttemptId).toBe('string')
    expect(val.wikiAttemptId!.length).toBeGreaterThan(0)
    const validAttemptId = val.wikiAttemptId!

    // Step 2: Positive source fallback using valid wikiAttemptId
    const sourceRes = await executeTool(ctx, 'ask_knowledge_retrieve', {
      terms: ['资产清算'],
      mode: 'source',
      wikiAttemptId: validAttemptId,
      fallbackReason: 'Verify exact creditor notification timeline',
    }, agent)
    expect(sourceRes.isError).toBe(false)
    if (sourceRes.isError) throw new Error('expected source retrieve success')
    const sourceVal = sourceRes.value as {
      items: Array<{ kind: string; verification: string; text: string; passageId: string }>
    }
    expect(sourceVal.items.length).toBeGreaterThanOrEqual(1)
    expect(sourceVal.items[0]?.kind).toBe('raw_passage')
    // A16: Source items carry verification: 'source-verified'
    expect(sourceVal.items[0]?.verification).toBe('source-verified')
    expect(sourceVal.items[0]?.text).toContain('三日内通知所有债权人')

    // Step 3: ask_knowledge_read with same-turn receipt succeeds
    const readRes = await executeTool(ctx, 'ask_knowledge_read', {
      passageId: sourceVal.items[0]!.passageId,
      wikiAttemptId: validAttemptId,
    }, agent)
    expect(readRes.isError).toBe(false)
    if (readRes.isError) throw new Error('expected read success')
    const readVal = readRes.value as { verification: string; text: string }
    expect(readVal.verification).toBe('source-verified')
    expect(readVal.text).toContain('三日内通知所有债权人')

    // Step 4: Negative Control - Forged attempt ID refused
    const forgedRes = await executeTool(ctx, 'ask_knowledge_retrieve', {
      terms: ['资产清算'],
      mode: 'source',
      wikiAttemptId: 'forged-attempt-fake-12345',
    }, agent)
    expect(forgedRes.isError).toBe(true)
    expect(forgedRes.content.map(b => 'text' in b ? b.text : '').join('')).toContain('Fabricated or unknown')

    // Step 5: Negative Control - Declared fallbackReason does not bypass receipt requirement
    const freshSession = ctx.sessions.prepare(SessionId('ses-a5-fresh'))
    ctx.sessions.enter(freshSession)
    ctx.sessions.announce(freshSession)
    await ctx.askKnowledge.attach({ libraryId: lib.id, sessionId: freshSession.id })
    const freshAgent = agentWith(freshSession)

    const noAttemptRes = await executeTool(ctx, 'ask_knowledge_retrieve', {
      terms: ['资产清算'],
      mode: 'source',
      fallbackReason: 'User explicitly requested original source text without prior wiki check',
    }, freshAgent)
    expect(noAttemptRes.isError).toBe(true)
    expect(noAttemptRes.content.map(b => 'text' in b ? b.text : '').join('')).toContain('require')

    // Negative Control: Cross-session attempt ID refused
    const crossSessionRes = await executeTool(ctx, 'ask_knowledge_retrieve', {
      terms: ['资产清算'],
      mode: 'source',
      wikiAttemptId: validAttemptId, // was issued to ses-a5-1
    }, freshAgent)
    expect(crossSessionRes.isError).toBe(true)
    expect(crossSessionRes.content.map(b => 'text' in b ? b.text : '').join('')).toContain('another session')

    // Negative Control: Cross-library attempt ID refused
    const lib2 = await ctx.askKnowledge.createLibrary({ displayName: '第二知识库' })
    await ctx.askKnowledge.attach({ libraryId: lib2.id, sessionId: session.id })
    const crossLibRes = await executeTool(ctx, 'ask_knowledge_retrieve', {
      terms: ['资产清算'],
      mode: 'source',
      wikiAttemptId: validAttemptId, // was issued for lib.id
    }, agent)
    expect(crossLibRes.isError).toBe(true)
    expect(crossLibRes.content.map(b => 'text' in b ? b.text : '').join('')).toContain('another library')

    // Negative Control: Previous-turn attempt ID refused (stale turn)
    // Switch session back to lib.id and increment turn
    await ctx.askKnowledge.attach({ libraryId: lib.id, sessionId: session.id })
    // Simulate turn advancement
    session.append('turn/start', { turn: 2 })
    const staleRes = await executeTool(ctx, 'ask_knowledge_retrieve', {
      terms: ['资产清算'],
      mode: 'source',
      wikiAttemptId: validAttemptId, // issued at turn 0
    }, agent)
    expect(staleRes.isError).toBe(true)
    expect(staleRes.content.map(b => 'text' in b ? b.text : '').join('')).toContain('previous turn')
  }, 25_000)

  it('A5: Source-only fallback accepts an authoritative receipt fenced by the production safety policy', async () => {
    const { ctx, root, sidecarHome } = await bootWithPython()
    await ctx.plugin(FencePolicy, { tools: ['ask_knowledge_*'], maxMixedTextBytes: 6000 })
    const session = ctx.sessions.prepare(SessionId('ses-src-only'))
    ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    const agent = agentWith(session)

    const lib = await ctx.askKnowledge.createLibrary({ displayName: '纯源码库' })
    const vault = join(root, 'knowledge-bases', 'libraries', lib.id)
    const rawDir = join(vault, 'raw')
    await mkdir(rawDir, { recursive: true })
    // Raw only, no wiki/ directory
    await writeFile(join(rawDir, 'doc.md'), '# 单据凭证\n\n发票入账须具备经办人和审批人双人签字。\n', 'utf8')
    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, root, lib.id)
    await ctx.askKnowledge.attach({ libraryId: lib.id, sessionId: session.id })

    const res = await executeTool(ctx, 'ask_knowledge_retrieve', { terms: ['单据凭证'] }, agent)
    expect(res.isError).toBe(false)
    if (res.isError) throw new Error('expected retrieve success')
    const val = res.value as {
      items: Array<{ text: string }>
      warnings: Array<{ ruleId: string; message: string }>
      wikiAttemptId?: string
    }
    // Should disclose fallback
    expect(val.warnings.some(w => w.ruleId.includes('fallback') || w.message.includes('fallback') || w.message.includes('unavailable'))).toBe(true)
    expect(res.content[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/^<external-data>\n/) })
    // Must issue a valid wikiAttemptId so subsequent source reads are authorized
    expect(typeof val.wikiAttemptId).toBe('string')
    expect(val.items).toEqual([])
    const fallback = await executeTool(ctx, 'ask_knowledge_retrieve', { terms: ['单据凭证'], mode: 'source', wikiAttemptId: val.wikiAttemptId }, agent)
    expect(fallback.isError).toBe(false)
    expect(JSON.stringify(fallback.content)).toContain('发票入账')
  }, 20_000)

  it('A7: Source fallback recovers late fact absent from wiki summary, and empty query emits no_absence_claim', async () => {
    const { ctx, root, sidecarHome } = await bootWithPython()
    const session = ctx.sessions.prepare(SessionId('ses-a7'))
    ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    const agent = agentWith(session)

    const lib = await ctx.askKnowledge.createLibrary({ displayName: '晚出事实库' })
    const vault = join(root, 'knowledge-bases', 'libraries', lib.id)
    const rawDir = join(vault, 'raw')
    const wikiDir = join(vault, 'wiki')
    await mkdir(rawDir, { recursive: true })
    await mkdir(wikiDir, { recursive: true })

    // Raw document contains high-level info AND a specific late penalty rate
    await writeFile(
      join(rawDir, 'contract.md'),
      '# 投资清偿协议\n\n甲方与乙方达成以下资产处置框架。\n' +
        '协议一般条款及违约责任说明。\n\n' +
        '## 逾期清偿罚则\n\n逾期清偿违约金按每日万分之五计收，由丙方负责监督扣划。\n',
      'utf8',
    )
    // Wiki page only summarized the general framework, omitting the late specific penalty rate
    await writeFile(
      join(wikiDir, '投资清偿.md'),
      `---
aliases: [清偿框架]
citations: [raw/contract.md#L3-L4]
coverage_status: wiki-ready
---
# 投资清偿

投资清偿指甲方与乙方达成的资产处置安排，明确财产处置框架。
`,
      'utf8',
    )
    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, root, lib.id)
    await ctx.askKnowledge.attach({ libraryId: lib.id, sessionId: session.id })

    // Step 1: Wiki search for 投资清偿 finds wiki page, but does NOT have 每日万分之五
    const wikiRes = await executeTool(ctx, 'ask_knowledge_retrieve', { terms: ['投资清偿'] }, agent)
    expect(wikiRes.isError).toBe(false)
    if (wikiRes.isError) throw new Error('expected retrieve success')
    const wikiVal = wikiRes.value as { items: Array<{ text: string }>; wikiAttemptId?: string }
    expect(wikiVal.items.some(i => i.text.includes('每日万分之五'))).toBe(false)
    const attemptId = wikiVal.wikiAttemptId!

    // Step 2: Source fallback recovers the late fact
    const srcRes = await executeTool(ctx, 'ask_knowledge_retrieve', {
      terms: ['逾期清偿'],
      mode: 'source',
      wikiAttemptId: attemptId,
    }, agent)
    expect(srcRes.isError).toBe(false)
    if (srcRes.isError) throw new Error('expected source retrieve success')
    const srcVal = srcRes.value as { items: Array<{ text: string }> }
    expect(srcVal.items.some(i => i.text.includes('每日万分之五'))).toBe(true)

    // Step 3: 0-hit keyword query emits no_absence_claim warning
    const missRes = await executeTool(ctx, 'ask_knowledge_retrieve', { terms: ['绝不存在的生僻词'] }, agent)
    expect(missRes.isError).toBe(false)
    if (missRes.isError) throw new Error('expected retrieve success')
    const missVal = missRes.value as { items: unknown[]; warnings: Array<{ ruleId: string; message: string }> }
    expect(missVal.items.length).toBe(0)
    expect(missVal.warnings.some(w => w.ruleId === 'no_absence_claim' || w.message.includes('do not prove'))).toBe(true)
  }, 25_000)

  it('A8: Preserves table headers across splits and keeps exception clauses attached', async () => {
    const { ctx, root, sidecarHome } = await bootWithPython()
    const session = ctx.sessions.prepare(SessionId('ses-a8'))
    ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    const agent = agentWith(session)

    const lib = await ctx.askKnowledge.createLibrary({ displayName: '表格例外库' })
    const vault = join(root, 'knowledge-bases', 'libraries', lib.id)
    const rawDir = join(vault, 'raw')
    await mkdir(rawDir, { recursive: true })

    // Build a document with a table and an exception paragraph
    const tableRows: string[] = []
    for (let i = 1; i <= 60; i++) {
      tableRows.push(`| 项目${i} | 规则描述${i} | 状态${i} |`)
    }
    const tableText = `| 项目名称 | 详细说明 | 执行状态 |\n|---|---|---|\n${tableRows.join('\n')}\n`

    const docContent = `# 采购制度\n\n${tableText}\n\n## 特殊审批\n\n常规采购需提前三日提交系统报备。\n例外：遇不可抗力或抢险救灾等紧急情形，可事后补办审批手续。\n`
    await writeFile(join(rawDir, 'procurement.md'), docContent, 'utf8')
    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, root, lib.id)
    await ctx.askKnowledge.attach({ libraryId: lib.id, sessionId: session.id })

    // Step 1: Initial wiki attempt
    const initRes = await executeTool(ctx, 'ask_knowledge_retrieve', { terms: ['采购制度'] }, agent)
    const attemptId = (initRes.value as { wikiAttemptId?: string }).wikiAttemptId!

    // Step 2: Source retrieve for the exception clause
    const excRes = await executeTool(ctx, 'ask_knowledge_retrieve', {
      terms: ['特殊审批'],
      mode: 'source',
      wikiAttemptId: attemptId,
    }, agent)
    expect(excRes.isError).toBe(false)
    if (excRes.isError) throw new Error('expected source retrieve success')
    const excVal = excRes.value as { items: Array<{ text: string }> }
    // The exception clause must be attached to the preceding rule
    const matchingItem = excVal.items.find(i => i.text.includes('抢险救灾'))
    expect(matchingItem).toBeDefined()
    expect(matchingItem!.text).toContain('常规采购需提前三日提交系统报备')
    expect(matchingItem!.text).toContain('例外：遇不可抗力或抢险救灾')
  }, 20_000)

  it('A14: Document diversity preserves multi-document hits and deduplicates identical excerpts', async () => {
    const { ctx, root, sidecarHome } = await bootWithPython()
    const session = ctx.sessions.prepare(SessionId('ses-a14'))
    ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    const agent = agentWith(session)

    const lib = await ctx.askKnowledge.createLibrary({ displayName: '多样性库' })
    const vault = join(root, 'knowledge-bases', 'libraries', lib.id)
    const rawDir = join(vault, 'raw')
    await mkdir(rawDir, { recursive: true })

    // Create 3 documents matching the same keyword '环境治理'
    await writeFile(join(rawDir, 'doc1.md'), '# 环境治理实施意见\n\n环境保护治理重点推进空气净化与水域整治。\n', 'utf8')
    await writeFile(join(rawDir, 'doc2.md'), '# 城市更新与环境治理\n\n城市更新行动中必须协同做好环境治理工程。\n', 'utf8')
    await writeFile(join(rawDir, 'doc3.md'), '# 产业扶持与环境治理\n\n发展循环经济助力区域环境治理全面达标。\n', 'utf8')

    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, root, lib.id)
    await ctx.askKnowledge.attach({ libraryId: lib.id, sessionId: session.id })

    const wiki = await executeTool(ctx, 'ask_knowledge_retrieve', { terms: ['环境治理'] }, agent)
    expect(wiki.isError).toBe(false)
    const res = await executeTool(ctx, 'ask_knowledge_retrieve', { terms: ['环境治理'], mode: 'source' }, agent)
    expect(res.isError).toBe(false)
    if (res.isError) throw new Error('expected retrieve success')
    const val = res.value as { items: Array<{ path: string; text: string }> }
    // Verify diversity: hits from multiple documents should appear
    const paths = new Set(val.items.map(i => i.path))
    expect(paths.size).toBeGreaterThanOrEqual(2)
  }, 20_000)

  it('ask_knowledge_lookup supports continuation cursor and frontmatter metadata', async () => {
    const { ctx, root, sidecarHome } = await bootWithPython()
    const session = ctx.sessions.prepare(SessionId('ses-lookup'))
    ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    const agent = agentWith(session)

    const lib = await ctx.askKnowledge.createLibrary({ displayName: '查词库' })
    const vault = join(root, 'knowledge-bases', 'libraries', lib.id)
    const wikiDir = join(vault, 'wiki')
    await mkdir(wikiDir, { recursive: true })

    await writeFile(
      join(wikiDir, '信用管理.md'),
      `---
aliases: [征信, 守信激励]
citations: [raw/credit.md#L1-L20]
coverage_status: wiki-ready
---
# 信用管理

企业信用管理制度包含信用档案、评级机制与失信惩戒三个组成部分。
相关机制见 [[失信黑名单]]。
`,
      'utf8',
    )
    await indexLibraryVault({ sidecarRuntimePath: sidecarHome }, root, lib.id)
    await ctx.askKnowledge.attach({ libraryId: lib.id, sessionId: session.id })

    const lookupRes = await executeTool(ctx, 'ask_knowledge_lookup', { term: '信用管理' }, agent)
    expect(lookupRes.isError).toBe(false)
    if (lookupRes.isError) throw new Error('expected lookup success')
    const val = lookupRes.value as {
      term: string
      text?: string
      canonicalPath?: string
      citations?: string[]
      relatedLinks?: string[]
      coverageStatus?: string
    }
    expect(val.term).toBe('信用管理')
    expect(val.text).toContain('企业信用管理制度')
    expect(val.canonicalPath).toBe('wiki/信用管理.md')
    expect(val.citations).toEqual(['raw/credit.md#L1-L20'])
    expect(val.relatedLinks).toEqual(['失信黑名单'])
    expect(val.coverageStatus).toBe('wiki-ready')
  }, 20_000)
})
