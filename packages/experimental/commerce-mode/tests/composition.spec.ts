/** Real Loader composition for commerce preset visibility and recorded provenance. */

import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import CommerceMode from '@deepseek-ai/dsh-experimental-commerce-mode'
import * as CommercePreset from '../src/preset/index.ts'
import * as CommerceTools from '../src/tools/index.ts'
import { writeFakeSqlite } from './helpers/fake-sqlite.ts'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, {
  createUserMessage,
  LlmAdapter,
  ToolCallId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

let root: string | undefined
let context: Context | undefined
const previousDshHome = process.env.DSH_HOME

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  adapter.script.splice(0)
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
})

function toolCall(callId: string, name: string, args: object): StreamChunk[] {
  const id = ToolCallId(callId)
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function textReply(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  readonly script: StreamChunk[][] = []
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const next = this.script.shift()
    if (next === undefined) throw new Error('commerce composition script exhausted')
    for (const chunk of next) yield chunk
  }
}

const adapter = new ScriptedAdapter()
const approvalAnswer: { current: ApprovalOutcome } = { current: 'allowed-once' }
const approver = {
  name: 'commerce-test-approver',
  inject: ['approval'],
  apply(ctx: Context): void { ctx.on('approval/request', () => Promise.resolve(approvalAnswer.current)) },
}
const mockLlm = {
  name: 'commerce-test-llm',
  inject: ['llm'],
  apply(ctx: Context): void { ctx.llm.registerAdapter(['mock'], adapter) },
}

async function writePreset(directory: string, id: string): Promise<void> {
  const target = join(directory, id)
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'agent.cordis.yml'), '[]\n')
  await writeFile(join(target, 'preset.yml'), `name: ${id}\ndescription: Test ${id} preset.\norder: ${id === 'standard' ? 1 : 2}\n`)
}

async function loadComposition(
  mount: 'preset' | 'root' | 'both',
  options: { readonly failingSqlite?: boolean } = {},
): Promise<{ ctx: Context; workspace: string }> {
  root = await mkdtemp(join(tmpdir(), 'commerce-loader-'))
  process.env.DSH_HOME = join(root, 'home')
  const presetRoot = join(process.env.DSH_HOME, '.agent-presets')
  const workspace = join(root, 'workspace')
  const sourcesRoot = join(root, 'sources')
  await Promise.all([mkdir(workspace), writePreset(presetRoot, 'standard'), writePreset(presetRoot, 'commerce')])
  const configPath = join(root, 'cordis.yml')
  const sqlite3Path = options.failingSqlite === true ? await writeFakeSqlite(join(root, 'bin'), '3.51.0') : 'sqlite3'
  const rosterRows = mount !== 'root'
    ? ["- name: '@deepseek-ai/dsh-agent-presets'", '  config:', '    default: standard', '    roots: []', '    includeShippedRoot: false', '    includeUserRoot: true']
    : []
  const toolBounds = '  config: { maxResultChars: 5000, maxListingIds: 20, maxMetaBytes: 4096, maxImportBytes: 1048576, maxStagedChanges: 20, guardrails: { maxItemsPerChange: 25, maxPriceDeltaPct: 20, maxPromotionDiscountPct: 50, maxRestockQuantity: 500, maxCampaignBudget: 10000, maxListingFieldChars: 2000, protectedFields: [listing_id, currency], priceBearingFields: [price], listingUpdateBlockedFields: [price, stock, available] } }'
  const mountRows = [
    ...mount === 'root' ? [] : ["- name: '@deepseek-ai/dsh-experimental-commerce-mode/preset'", toolBounds],
    ...mount === 'preset' ? [] : ["- name: '@deepseek-ai/dsh-experimental-commerce-mode/tools'", toolBounds],
  ]
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-agent-loop'",
    '  config: { agents: [] }',
    "- name: '@deepseek-ai/dsh-fs-local'",
    `  config: { cwd: ${JSON.stringify(workspace)} }`,
    "- name: '@deepseek-ai/dsh-subprocess-local'",
    "- name: '@deepseek-ai/dsh-user-approval'",
    "- name: '@deepseek-ai/dsh-sandbox-policy'",
    `  config: { mode: workspace-write, workspaceRoot: ${JSON.stringify(workspace)} }`,
    '- name: commerce-test-approver',
    ...rosterRows,
    "- name: '@deepseek-ai/dsh-experimental-commerce-mode'",
    '  config:',
    `    sourcesRoot: ${JSON.stringify(sourcesRoot)}`,
    '    platforms:',
    '      sample:',
    '        orders: { order_id: order, listing_id: listing, quantity: quantity, gross_sales: sales, currency: currency, ordered_at: date }',
    '        products: { listing_id: listing, title: title, sku: sku, status: status, parent_id: parent, price: price, description: description }',
    '        inventory: { listing_id: listing, available: available, low_stock_threshold: threshold }',
    '    analysis: { maxRows: 20, maxOutputBytes: 65536, timeoutMs: 2000, graceMs: 100 }',
    '    lockWaitMs: 5000',
    `    sqlite3Path: ${JSON.stringify(sqlite3Path)}`,
    ...mountRows,
    '- name: commerce-test-llm',
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
    ['@deepseek-ai/dsh-user-approval', ApprovalService],
    ['@deepseek-ai/dsh-sandbox-policy', SandboxPolicyService],
    ['commerce-test-approver', approver],
    ['@deepseek-ai/dsh-agent-presets', AgentPresets],
    ['@deepseek-ai/dsh-experimental-commerce-mode', CommerceMode],
    ['@deepseek-ai/dsh-experimental-commerce-mode/preset', CommercePreset],
    ['@deepseek-ai/dsh-experimental-commerce-mode/tools', CommerceTools],
    ['commerce-test-llm', mockLlm],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { ctx, workspace }
}

describe('real commerce Loader composition', () => {
  it('scopes tools to commerce, records binding and provenance, replays, and disposes', { timeout: 30_000 }, async () => {
    const { ctx, workspace } = await loadComposition('preset')
    const standard = await ctx.agents.create({
      sessionId: SessionId('standard-agent'), meta: { cwd: workspace },
      agentOptions: { provider: 'mock', model: 'mock' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    const commerce = await ctx.agents.create({
      sessionId: SessionId('commerce-agent'), meta: { cwd: workspace },
      agentOptions: { provider: 'mock', model: 'mock' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'commerce').then(() => undefined),
    })
    expect(ctx.tools.schemas(standard.agent).some(tool => tool.name.startsWith('commerce_'))).toBe(false)
    expect(ctx.tools.schemas(commerce.agent).filter(tool => tool.name.startsWith('commerce_'))).toHaveLength(14)

    adapter.script.push(
      toolCall('load-sample', 'commerce_load_sample', {}),
      toolCall('search', 'commerce_search_listings', { query: 'tea', limit: 2 }),
      toolCall('analyze', 'commerce_analysis_query', { query: 'SELECT listing_id FROM products ORDER BY listing_id' }),
      textReply('Analysis complete.'),
    )
    commerce.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Load and analyze.' }], source: { kind: 'user' } }))
    await commerce.agent.whenIdle()
    const events = commerce.agent.session.snapshotEvents()
    expect(events.some(event => event.type === 'commerce/bound')).toBe(true)
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(3)
    const live = ctx.sessionProjections.stateOf(commerce.agent.session, 'commerceSession')
    expect(live?.binding?.sourceId).toBeTruthy()
    expect(live?.readListingIds.length).toBeGreaterThan(0)
    const replay = Session.create(SessionId('commerce-replay'), events)
    expect(ctx.sessionProjections.stateOf(replay, 'commerceSession')).toEqual(live)

    const row = [...ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-experimental-commerce-mode/preset')
    if (row?.fiber === undefined) throw new Error('commerce preset row was not loaded')
    await row.fiber.dispose()
    expect(ctx.tools.schemas(commerce.agent).some(tool => tool.name.startsWith('commerce_'))).toBe(false)
    await Promise.all([commerce.dispose(), standard.dispose()])
  })

  it('mounts the tools at the root for every agent in a deployment without a preset roster', { timeout: 30_000 }, async () => {
    const { ctx, workspace } = await loadComposition('root')
    const bare = await ctx.agents.create({
      sessionId: SessionId('bare-agent'), meta: { cwd: workspace },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(ctx.tools.schemas(bare.agent).filter(tool => tool.name.startsWith('commerce_'))).toHaveLength(14)

    adapter.script.push(
      toolCall('load-sample', 'commerce_load_sample', {}),
      toolCall('search', 'commerce_search_listings', { query: 'Jasmine', limit: 5 }),
      toolCall('stage', 'commerce_stage_price_change', {
        summary: 'Raise the jasmine tea price', items: [{ listing_id: 'P-100', price: 21.9 }],
      }),
      textReply('Staged.'),
    )
    bare.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Load the sample and stage a price change.' }], source: { kind: 'user' } }))
    await bare.agent.whenIdle()
    const events = bare.agent.session.snapshotEvents()
    expect(events.some(event => event.type === 'commerce/bound')).toBe(true)
    const live = ctx.sessionProjections.stateOf(bare.agent.session, 'commerceSession')
    expect(live?.ledger).toEqual([{
      id: 'chg-0001', kind: 'price-change', summary: 'Raise the jasmine tea price', status: 'staged',
      items: [{ listingId: 'P-100', field: 'price', before: 19.9, after: 21.9 }],
    }])
    expect(ctx.sessionProjections.stateOf(Session.create(SessionId('bare-replay'), events), 'commerceSession')).toEqual(live)

    const row = [...ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-experimental-commerce-mode/tools')
    if (row?.fiber === undefined) throw new Error('commerce tools row was not loaded')
    await row.fiber.dispose()
    expect(ctx.tools.schemas(bare.agent).some(tool => tool.name.startsWith('commerce_'))).toBe(false)
    await bare.dispose()
  })

  it('fails the second tool mount when a composition adds both mount rows', { timeout: 30_000 }, async () => {
    await expect(loadComposition('both')).rejects.toThrow('add either the ./preset row or a root ./tools row, not both')
  })

  it('keeps an import storage failure as a tool error instead of an input hold', { timeout: 30_000 }, async () => {
    const { ctx, workspace } = await loadComposition('root', { failingSqlite: true })
    await writeFile(join(workspace, 'products.csv'), 'listing,title,sku,status,parent\nP-1,Tea,TEA-1,active,\n')
    const created = await ctx.agents.create({
      sessionId: SessionId('storage-failure-agent'), meta: { cwd: workspace },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    adapter.script.push(
      toolCall('import', 'commerce_import_file', { path: 'products.csv', kind: 'products', platform: 'sample' }),
      textReply('Import attempted.'),
    )
    created.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Import the products.' }], source: { kind: 'user' } }))
    await created.agent.whenIdle()
    const events = created.agent.session.snapshotEvents()
    const result = events.find(event => event.type === 'tool/result')
    const block = result?.type === 'tool/result' ? result.data.message.content[0] : undefined
    expect(block?.type === 'tool-result' ? block.isError : undefined).toBe(true)
    expect(events.some(event => event.type === 'commerce/bound')).toBe(false)
    await created.dispose()
  })

  for (const [answer, written] of [['allowed-once', true], ['rejected', false]] as const) {
    it(`${written ? 'writes' : 'does not write'} the export when approval is ${answer}`, { timeout: 30_000 }, async () => {
      approvalAnswer.current = answer
      const { ctx, workspace } = await loadComposition('root')
      const created = await ctx.agents.create({
        sessionId: SessionId(`export-${answer}`), meta: { cwd: workspace },
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      adapter.script.push(
        toolCall('load-sample', 'commerce_load_sample', {}),
        toolCall('search', 'commerce_search_listings', { query: 'Jasmine', limit: 5 }),
        toolCall('stage', 'commerce_stage_price_change', { summary: 'Raise the jasmine tea price', items: [{ listing_id: 'P-100', price: 21.9 }] }),
        toolCall('export', 'commerce_export_changes', { change_ids: ['chg-0001'], platform: 'sample' }),
        textReply('Done.'),
      )
      created.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Stage and export a price change.' }], source: { kind: 'user' } }))
      await created.agent.whenIdle()
      const ledger = ctx.sessionProjections.stateOf(created.agent.session, 'commerceSession')?.ledger
      expect(ledger?.map(change => change.status)).toEqual([written ? 'exported' : 'staged'])
      const exportsDir = join(workspace, 'commerce-exports')
      const files = await readdir(exportsDir).catch(() => [])
      expect(files).toHaveLength(written ? 1 : 0)
      if (written) {
        const csv = await readFile(join(exportsDir, files[0] ?? ''), 'utf8')
        expect(csv).toContain('chg-0001,price-change,P-100,21.9')
      }
      await created.dispose()
    })
  }
})
