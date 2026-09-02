/**
 * Ingest → propose → apply with per-library lock and three-stage compensation.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-knowledge/ingest
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { AskKnowledgeError } from '@deepseek-ai/dsh-host-ask-knowledge'
import type { AskKnowledgeIngestResult, AskKnowledgeLibraryId } from '@deepseek-ai/dsh-host-ask-knowledge'
import type { Context } from '@deepseek-ai/cordis'
import { assertVaultDir, requireLibrary } from './catalog.ts'
import { resolveProposeEnv } from './credentials-bridge.ts'
import { withLibraryLock } from './library-lock.ts'
import { rewriteProposalPageMetaFile } from './proposal-page-meta.ts'
import { runSidecar, type SidecarResponse } from './sidecar.ts'
import type { AskKnowledgeHomeConfig } from './knowledge-home.ts'

/** Progress stage published for UI. */
export type IngestStage = 'converting' | 'proposing' | 'applying'

/** One finishIngest run. */
export interface FinishIngestRequest {
  readonly libraryId: AskKnowledgeLibraryId
  readonly tempPath: string
  readonly reuseRawPath?: string
  readonly onStage?: (stage: IngestStage) => void
}

/**
 * Recover only when the sidecar reports a pending audit.
 * @param _ctx - unused; reserved for future logging.
 * @param config - sidecar home.
 * @param vault - absolute vault.
 * @param proposalId - id to recover.
 * @param signal - caller lifetime.
 */
export async function recoverIfPending(
  _ctx: Context,
  config: AskKnowledgeHomeConfig,
  vault: string,
  proposalId: string,
  signal?: AbortSignal,
): Promise<void> {
  const result = await runSidecar(config, {
    command: 'recover',
    vault,
    proposalId,
  }, { signal })
  void result
}

/**
 * List pending audit ids in `.octopus-kb` when the sidecar inbox reports them.
 * @param config - sidecar home.
 * @param vault - absolute vault.
 * @param signal - caller lifetime.
 * @returns pending count.
 */
export async function pendingAuditCount(
  config: AskKnowledgeHomeConfig,
  vault: string,
  signal?: AbortSignal,
): Promise<number> {
  try {
    const listed = await runSidecar(config, { command: 'inbox-list', vault }, { signal })
    const count = listed.deferredCount
    return typeof count === 'number' ? count : 0
  } catch {
    return 0
  }
}

/**
 * Run recover for every pending proposal the sidecar inbox lists.
 * @param ctx - Host context.
 * @param config - sidecar home.
 * @param vault - absolute vault.
 * @param signal - caller lifetime.
 */
export async function recoverPendingAudits(
  ctx: Context,
  config: AskKnowledgeHomeConfig,
  vault: string,
  signal?: AbortSignal,
): Promise<void> {
  const listed = await runSidecar(config, { command: 'inbox-list', vault }, { signal })
  const items = Array.isArray(listed.items) ? listed.items : []
  for (const item of items) {
    const id = typeof item === 'string'
      ? item
      : typeof item === 'object' && item !== null && 'proposal_id' in item
        ? String((item as { proposal_id: unknown }).proposal_id)
        : typeof item === 'object' && item !== null && 'id' in item
          ? String((item as { id: unknown }).id)
          : ''
    if (id === '') continue
    await recoverIfPending(ctx, config, vault, id, signal)
  }
}

/**
 * Finish one ingest under the library lock.
 * @param ctx - Host context for credentials.
 * @param config - sidecar / home config.
 * @param knowledgeHome - resolved app-data directory.
 * @param request - temp file and optional raw reuse.
 * @param signal - caller lifetime.
 * @returns applied, deferred, or failed.
 */
export async function finishIngestPipeline(
  ctx: Context,
  config: AskKnowledgeHomeConfig,
  knowledgeHome: string,
  request: FinishIngestRequest,
  signal?: AbortSignal,
): Promise<AskKnowledgeIngestResult> {
  return await withLibraryLock(request.libraryId, async () => {
    const row = await requireLibrary(knowledgeHome, request.libraryId)
    const vault = await assertVaultDir(knowledgeHome, row)
    await recoverPendingAudits(ctx, config, vault, signal)
    const beforeRaw = await listRawRelPaths(vault)
    let rawRelPath = request.reuseRawPath
    if (rawRelPath !== undefined) {
      assertRawRelPath(rawRelPath)
    } else {
      request.onStage?.('converting')
      const ingested = await runSidecar(config, {
        command: 'ingest-file',
        vault,
        path: request.tempPath,
      }, { signal })
      rawRelPath = typeof ingested.rawRelPath === 'string' ? ingested.rawRelPath : undefined
      if (rawRelPath === undefined) {
        throw new AskKnowledgeError('ingest-failed', 'ingest-file did not return rawRelPath')
      }
      const afterRaw = await listRawRelPaths(vault)
      const added = afterRaw.filter(path => !beforeRaw.includes(path))
      if (added.length !== 1 || added[0] !== rawRelPath) {
        throw new AskKnowledgeError('ingest-failed', 'ingest-file must add exactly one raw file')
      }
    }
    const rawAbs = resolve(vault, rawRelPath)
    request.onStage?.('proposing')
    let proposed: SidecarResponse
    try {
      const env = await resolveProposeEnv(ctx)
      proposed = await runSidecar(config, {
        command: 'propose',
        vault,
        rawFile: rawAbs,
      }, { signal, env })
    } catch (error: unknown) {
      if (error instanceof AskKnowledgeError && error.code === 'credentials-missing') throw error
      return failedIngest(rawRelPath, error)
    }
    const proposalId = typeof proposed.proposal_id === 'string'
      ? proposed.proposal_id
      : typeof proposed.proposalId === 'string' ? proposed.proposalId : undefined
    const proposalPath = typeof proposed.path === 'string' ? proposed.path : undefined
    if (proposalId === undefined || proposalPath === undefined) {
      return failedIngest(rawRelPath, undefined, {}, '整理词条没有产出可写入的提案。')
    }
    request.onStage?.('applying')
    try {
      const proposalAbs = resolve(vault, proposalPath)
      await rewriteProposalPageMetaFile(proposalAbs)
      const applied = await runSidecar(config, {
        command: 'validate-apply',
        vault,
        proposal: proposalAbs,
      }, { signal })
      if (typeof applied.status === 'string' && applied.status.startsWith('rejected')) {
        return failedIngest(
          rawRelPath,
          undefined,
          { proposalId },
          '整理词条没有写出可检索的页面。',
        )
      }
      const deferredCount = typeof applied.deferred_count === 'number'
        ? applied.deferred_count
        : typeof applied.deferredCount === 'number' ? applied.deferredCount : 0
      const status = applied.status === 'deferred' || deferredCount > 0 ? 'deferred' : 'applied'
      if (status === 'deferred') {
        return { status: 'deferred', deferredCount, rawRelPath, proposalId }
      }
      return { status: 'applied', rawRelPath, proposalId }
    } catch (error: unknown) {
      await recoverIfPending(ctx, config, vault, proposalId, signal)
      return failedIngest(rawRelPath, error, { proposalId })
    }
  })
}

/**
 * Re-propose after apply failure so the new proposal id can apply.
 * @param ctx - Host context.
 * @param config - sidecar home.
 * @param vault - absolute vault.
 * @param rawRelPath - preserved raw.
 * @param previousProposalId - id that must be rejected on re-apply.
 * @param signal - caller lifetime.
 * @returns the new proposal id.
 */
export async function reproposeAfterApplyFailure(
  ctx: Context,
  config: AskKnowledgeHomeConfig,
  vault: string,
  rawRelPath: string,
  previousProposalId: string,
  signal?: AbortSignal,
): Promise<string> {
  await recoverIfPending(ctx, config, vault, previousProposalId, signal)
  const env = await resolveProposeEnv(ctx)
  const proposed = await runSidecar(config, {
    command: 'propose',
    vault,
    rawFile: resolve(vault, rawRelPath),
  }, { signal, env })
  const proposalId = typeof proposed.proposal_id === 'string'
    ? proposed.proposal_id
    : typeof proposed.proposalId === 'string' ? proposed.proposalId : ''
  if (proposalId === '' || proposalId === previousProposalId) {
    throw new AskKnowledgeError('ingest-failed', 're-propose did not mint a new proposal id')
  }
  return proposalId
}

const SIDECAR_ERROR_ZH: Record<string, string> = {
  'LLM returned non-JSON output': '模型没有按词条格式返回。原文已经放进库，请再试一次。',
  'proposal schema invalid': '模型给出的词条格式不对，请再试一次。',
  'propose failed': '整理词条失败。',
  'apply failed': '写入词条失败。',
}

function failedIngest(
  rawRelPath: string,
  error: unknown,
  extra: { readonly proposalId?: string } = {},
  fallback = '整理词条失败。',
): AskKnowledgeIngestResult {
  const raw = error instanceof Error && error.message.trim() !== '' ? error.message : fallback
  return {
    status: 'failed',
    retryable: true,
    rawRelPath,
    error: SIDECAR_ERROR_ZH[raw] ?? raw,
    ...extra.proposalId === undefined ? {} : { proposalId: extra.proposalId },
  }
}

async function listRawRelPaths(vault: string): Promise<string[]> {
  const rawDir = join(vault, 'raw')
  await mkdir(rawDir, { recursive: true })
  const names = await readdir(rawDir)
  return names.filter(name => name.endsWith('.md')).map(name => `raw/${name}`).toSorted()
}

function assertRawRelPath(rawRelPath: string): void {
  if (rawRelPath.includes('..') || rawRelPath.includes('\0') || !rawRelPath.startsWith('raw/')) {
    throw new AskKnowledgeError('path-escape', 'reuseRawPath must stay under raw/')
  }
  const rel = relative('raw', rawRelPath)
  /* v8 ignore next 3 -- the string check above already rejects every `..` segment */
  if (rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new AskKnowledgeError('path-escape', 'reuseRawPath must stay under raw/')
  }
}

/**
 * Write a fixture proposal JSON for tests that mock apply without LLM.
 * @param vault - absolute vault.
 * @param proposalId - id.
 * @param body - JSON document.
 * @returns relative path.
 */
export async function writeTestProposal(
  vault: string,
  proposalId: string,
  body: unknown,
): Promise<string> {
  const rel = join('.octopus-kb', 'proposals', `${proposalId}.json`)
  const abs = join(vault, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  return rel
}

/**
 * Read one raw markdown file under a vault. Tests use this after ingest.
 * @param vault - absolute vault directory.
 * @param rawRelPath - path relative to the vault, starting with `raw/`.
 * @returns file text.
 * @internal
 */
export async function readRawFile(vault: string, rawRelPath: string): Promise<string> {
  return readFile(resolve(vault, rawRelPath), 'utf8')
}
