/** Approval-gated export of staged commerce changes to a CSV file in the session workspace. */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type {
  CommerceChange,
  CommerceRecord,
  CommerceSourceId,
  CommerceValue,
  ListingId,
} from '@deepseek-ai/dsh-host-commerce'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { checkGuardrails } from './guardrails.ts'
import { gateHeld, held, holdRecoverableFailure, ok, outputFor, type ToolOutcome } from './outcome.ts'
import { boundSession, idList, type StagingConfig } from './staging.ts'
import type { StagedChange } from './types.ts'

// Type-only imports install the approval and sandbox-policy Context services.
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'

const EXPORT_DIRECTORY = 'commerce-exports'
const EXPORT_ID_HEX = 16

/**
 * Workspace-relative export path derived from the exported change ids, never from model arguments.
 * @param changeIds - exported change ids in any order.
 * @returns `commerce-exports/<first 16 hex of SHA-256 of the sorted ids>.csv`.
 */
export function exportPathFor(changeIds: readonly string[]): string {
  const digest = createHash('sha256').update([...changeIds].sort().join('\n')).digest('hex')
  return `${EXPORT_DIRECTORY}/${digest.slice(0, EXPORT_ID_HEX)}.csv`
}

/**
 * Convert ledger changes to provider export rows: one row per listing, or one row for a campaign.
 * @param changes - staged changes to export.
 * @returns rows the Provider renders as CSV.
 */
export function toCommerceChanges(changes: readonly StagedChange[]): CommerceChange[] {
  return changes.flatMap((change): CommerceChange[] => {
    if (change.kind === 'campaign') {
      const after: Record<string, CommerceValue> = {}
      for (const item of change.items) after[item.field] = item.after
      if (change.campaign !== undefined) {
        after.campaign_name = change.campaign.name
        after.listing_ids = change.campaign.listingIds.join(';')
      }
      if (change.window !== undefined) {
        after.starts_on = change.window.startsOn
        after.ends_on = change.window.endsOn
      }
      return [{ id: change.id, kind: change.kind, before: {}, after }]
    }
    const rows = new Map<ListingId, { before: Record<string, CommerceValue>; after: Record<string, CommerceValue> }>()
    for (const item of change.items) {
      if (item.listingId === null) continue
      const row = rows.get(item.listingId) ?? { before: {}, after: {} }
      row.before[item.field] = item.before
      row.after[item.field] = item.after
      rows.set(item.listingId, row)
    }
    return [...rows].map(([listingId, row]) => ({
      id: change.id,
      kind: change.kind,
      listingId,
      before: row.before,
      after: change.window === undefined
        ? row.after
        : { ...row.after, promotion_starts_on: change.window.startsOn, promotion_ends_on: change.window.endsOn },
    }))
  })
}

async function staleChanges(
  ctx: Context,
  sourceId: CommerceSourceId,
  changes: readonly StagedChange[],
  signal: AbortSignal,
): Promise<StagedChange[]> {
  const listingIds = new Set<ListingId>()
  for (const change of changes) {
    if (change.kind === 'restock' || change.kind === 'campaign') continue
    for (const item of change.items) if (item.listingId !== null) listingIds.add(item.listingId)
  }
  const records = new Map<ListingId, CommerceRecord>()
  for (const id of listingIds) records.set(id, (await ctx.commerce.getListing(sourceId, id, signal)).values)
  const stock = changes.some(change => change.kind === 'restock')
    ? new Map((await ctx.commerce.inventoryHealth(sourceId, signal)).items.map(item => [item.listingId, item.available]))
    : new Map<ListingId, number>()
  return changes.filter(change => change.items.some((item) => {
    if (item.listingId === null) return false
    if (change.kind === 'restock') return stock.get(item.listingId) !== item.before
    // A promotion line's before value is the listing price.
    const field = change.kind === 'promotion' ? 'price' : item.field
    const record = records.get(item.listingId)
    const current = record !== undefined && Object.hasOwn(record, field) ? record[field] ?? null : null
    return current !== item.before
  }))
}

function existingHeld(path: string): ToolOutcome {
  return held(`These changes may already be exported: ${path} already exists, and nothing was written. Check that file with the merchant before exporting again.`)
}

/**
 * Register the export tool on the current scope. The tool writes only after
 * the merchant approves and only inside the session workspace.
 * @param ctx - scope holding the commerce, tools, filesystem, approval, sandbox-policy, and projection services.
 * @param config - result bounds, ledger bound, and guardrails in force at export.
 */
export function registerExportTool(ctx: Context, config: StagingConfig): void {
  ctx.tools.register(defineTool({
    name: 'commerce_export_changes',
    description: 'Write staged commerce changes to a CSV file in this session workspace after the merchant approves. Nothing is sent to a store; the merchant uploads the file.',
    parameters: {
      change_ids: { type: 'array', required: true, description: 'Staged change ids to export.', items: { type: 'string' } },
      platform: { type: 'string', required: true, enum: [...ctx.commerce.platforms()], description: 'Platform mapping whose column headers the CSV uses.' },
    },
    output: outputFor(config),
    async execute(args, exec) {
      return holdRecoverableFailure(async () => {
        const session = boundSession(ctx, exec)
        if ('outcome' in session) return session.outcome
        const ids = [...new Set(args.change_ids)]
        if (ids.length === 0) return held('Provide at least one staged change id, then retry.')
        const ledger = new Map<string, StagedChange>(session.state.ledger.map(change => [change.id, change]))
        const missing = ids.filter(id => !ledger.has(id))
        if (missing.length > 0) {
          return gateHeld('ledger', `change ids ${idList(missing)} were not staged in this session`, 'Use change ids returned by staging tools.')
        }
        const changes = ids.flatMap(id => ledger.get(id) ?? [])
        const resolved = changes.filter(change => change.status !== 'staged')
        if (resolved.length > 0) {
          return gateHeld(
            'ledger',
            `changes ${resolved.map(change => `${change.id} (${change.status})`).join(', ')} are no longer staged`,
            'Export only changes that are still staged.',
          )
        }
        const stale = await staleChanges(ctx, session.sourceId, changes, exec.signal)
        if (stale.length > 0) {
          return gateHeld(
            'staleness',
            `the bound source no longer matches the staged before values of ${idList(stale.map(change => change.id))}`,
            'Discard those changes and stage them again from current reads.',
          )
        }
        const violations = changes.flatMap(change => checkGuardrails(change.kind, change.items, config.guardrails)
          .map(violation => `${change.id}: ${violation}`))
        if (violations.length > 0) {
          return gateHeld(
            'guardrail',
            `the changes no longer pass this store's guardrails: ${violations.join('; ')}`,
            'Discard them and stage compliant changes.',
          )
        }
        const rows = toCommerceChanges(changes)
        const path = exportPathFor(ids)
        const exported = ok({ path, changeIds: ids, rowCount: rows.length, rows }, [], false, config, {
          lead: `Exported ${String(ids.length)} staged ${ids.length === 1 ? 'change' : 'changes'} to ${path}. Nothing was sent to a store; the merchant uploads the file.`,
          exportedChangeIds: changes.map(change => change.id),
          exportPath: path,
        })
        if (exported.status === 'held') return exported
        const csv = await ctx.commerce.renderExport(rows, args.platform, exec.signal)
        const policy = ctx.sandboxPolicy.resolve({ session: session.agent.session })
        const workspace = await ctx.fs.resolve(policy.workspaceRoot, { signal: exec.signal })
        const target = await ctx.fs.resolve(path, { cwd: policy.workspaceRoot, signal: exec.signal })
        if (policy.mode === 'read-only' || !ctx.fs.contains(workspace, target)) {
          return gateHeld(
            'sandbox',
            "this session's file policy does not allow writing the export into the workspace",
            'Ask the merchant to switch Permissions to workspace-write, then export again.',
          )
        }
        if (await ctx.fs.stat(target, exec.signal) !== undefined) return existingHeld(path)
        const decision = await ctx.approval.request({
          agent: session.agent,
          toolName: exec.name,
          callId: exec.callId,
          reason: `Write ${String(rows.length)} CSV ${rows.length === 1 ? 'row' : 'rows'} for ${ids.join(', ')} to ${path}`,
          signal: exec.signal,
        })
        switch (decision) {
          case 'allowed-once':
            break
          case 'rejected':
            return (ctx.approval.overrideOf(session.agent.session) ?? ctx.approval.config.policy ?? 'ask') === 'never'
              ? held('Approval prompts are disabled in this session, so the export was not written. Ask the merchant to switch Permissions to workspace-write, then export again.')
              : held('The merchant rejected the export, and nothing was written. Ask what should change before exporting again.')
          case 'cancelled':
            return held('The export approval was cancelled, and nothing was written.')
          case 'unavailable':
            return held('No one was available to approve the export, and nothing was written. Export again when the merchant can approve it.')
        }
        try {
          await ctx.fs.writeText(target, csv, { kind: 'createIfAbsent' }, exec.signal, policy)
        } catch (error: unknown) {
          if (error instanceof FsError && error.code === 'FS_NOT_OBSERVED') return existingHeld(path)
          throw error
        }
        return exported
      }, config)
    },
  }))
}
