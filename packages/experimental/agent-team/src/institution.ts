/** Institution-squad catalog: three standing 编制 rows and their Lead Session bindings. */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'
import { TeamError } from './error.ts'
import type {
  InstitutionSeatView,
  InstitutionSquadId,
  InstitutionSquadView,
  UpdateInstitutionSeatRequest,
} from './types.ts'

/** Product-constant squad slugs. */
export const INSTITUTION_SQUAD_IDS = ['document', 'case', 'comms'] as const

/** One baked-in seat. */
export interface InstitutionSeatDefinition {
  readonly name: string
  readonly title: string
  readonly titleEn: string
  readonly duty: string
}

/** One baked-in institution squad. */
export interface InstitutionSquadDefinition {
  readonly id: InstitutionSquadId
  readonly displayName: string
  readonly displayNameEn: string
  readonly seats: readonly InstitutionSeatDefinition[]
}

/** Standing 编制. Names are lower-kebab; titles are the Chinese role labels. */
export const INSTITUTION_SQUADS: readonly InstitutionSquadDefinition[] = [
  {
    id: 'document',
    displayName: '文书组',
    displayNameEn: 'Document squad',
    seats: [
      { name: 'archivist', title: '资料员', titleEn: 'Archivist', duty: '只收材料、建索引、列缺失项，不编数据' },
      { name: 'drafter', title: '文书员', titleEn: 'Drafter', duty: '按模板出结构完整初稿；无来源章节只写「缺失项清单」' },
      {
        name: 'metric-checker',
        title: '指标核对员',
        titleEn: 'Metric checker',
        duty: '对照原始表核数字/单位/目标达成，出差异清单',
      },
      { name: 'reviewer', title: '审核员', titleEn: 'Reviewer', duty: '查对外承诺、财务敏感、口径风险；不替机构提交资方' },
    ],
  },
  {
    id: 'case',
    displayName: '案例组',
    displayNameEn: 'Case squad',
    seats: [
      { name: 'notetaker', title: '记录整理员', titleEn: 'Notetaker', duty: '忠实整理现场/访谈笔记，不润色事实' },
      { name: 'redactor', title: '脱敏员', titleEn: 'Redactor', duty: '去姓名手机身份证，地址不超过区县' },
      {
        name: 'case-writer',
        title: '案例萃取员',
        titleEn: 'Case writer',
        duty: '做成标准案例卡（背景-行动-结果-手法）',
      },
      { name: 'librarian', title: '入库审核员', titleEn: 'Librarian', duty: '五分类归档并更新索引，缺字段标待补' },
    ],
  },
  {
    id: 'comms',
    displayName: '传播部',
    displayNameEn: 'Comms squad',
    seats: [
      { name: 'sourcer', title: '资料员', titleEn: 'Sourcer', duty: '汇素材与口径边界（含脱敏要求）' },
      { name: 'outliner', title: '结构员', titleEn: 'Outliner', duty: '定标题/提纲/段落结构' },
      { name: 'copywriter', title: '写作员', titleEn: 'Copywriter', duty: '出「说人话」初稿，不编成效数字' },
      {
        name: 'compliance-reviewer',
        title: '审核员',
        titleEn: 'Compliance reviewer',
        duty: '发布前审校敏感信息与过度承诺；不代发微信/平台',
      },
    ],
  },
]

const seatBindingSchema = z.object({
  provider: z.string().min(1).max(200).optional(),
  model: z.string().min(1).max(200).optional(),
})

const catalogSchema = z.object({
  version: z.literal(1),
  leads: z.object({
    document: z.string().min(1).optional(),
    case: z.string().min(1).optional(),
    comms: z.string().min(1).optional(),
  }).default({}),
  seats: z.object({
    document: z.record(z.string(), seatBindingSchema).optional(),
    case: z.record(z.string(), seatBindingSchema).optional(),
    comms: z.record(z.string(), seatBindingSchema).optional(),
  }).default({}),
})

/** On-disk catalog after validation. */
export type InstitutionCatalogFile = z.infer<typeof catalogSchema>

const EMPTY_CATALOG: InstitutionCatalogFile = { version: 1, leads: {}, seats: {} }

/**
 * Resolve the catalog path, using `$DSH_HOME/institution-squads.json` when unset.
 * @param configured - optional absolute or home-relative path from Config.
 * @returns the path the catalog reads and writes.
 */
export function resolveInstitutionCatalogPath(configured?: string): string {
  const trimmed = configured?.trim() ?? ''
  return trimmed === '' ? dshHomePath('institution-squads.json') : trimmed
}

/**
 * Return the baked-in squad, or throw when the slug is not one of the three.
 * @param id - candidate squad slug.
 * @returns the definition.
 */
export function requireInstitutionSquad(id: string): InstitutionSquadDefinition {
  const squad = INSTITUTION_SQUADS.find(row => row.id === id)
  if (squad === undefined) {
    throw new TeamError(`unknown institution squad "${id}"`, 'TEAM_INSTITUTION_SQUAD_UNKNOWN')
  }
  return squad
}

/**
 * Return the baked-in seat, or throw when the name is not on that squad.
 * @param squad - resolved squad.
 * @param name - candidate teammate name.
 * @returns the seat definition.
 */
export function requireInstitutionSeat(
  squad: InstitutionSquadDefinition,
  name: string,
): InstitutionSeatDefinition {
  const seat = squad.seats.find(row => row.name === name)
  if (seat === undefined) {
    throw new TeamError(
      `unknown institution seat "${name}" on squad "${squad.id}"`,
      'TEAM_INSTITUTION_SEAT_UNKNOWN',
    )
  }
  return seat
}

/**
 * Standing first prompt for a provisioned seat. It does not assign a topic.
 * @param squad - parent squad.
 * @param seat - seat being spawned.
 * @returns one model-visible text block.
 */
export function standingSeatPrompt(
  squad: InstitutionSquadDefinition,
  seat: InstitutionSeatDefinition,
): string {
  return (
    `You are a standing teammate named ${seat.name} (${seat.title}) `
    + `on the institution squad「${squad.displayName}」. Duty: ${seat.duty}. `
    + 'Keep this role and prior context across topics. Wait for the Lead to assign work. '
    + 'Do not invent facts, numbers, or outcomes. Do not spawn further teammates.'
  )
}

/**
 * File-backed institution catalog. Writes are serialized on one instance.
 */
export class InstitutionCatalog {
  private writeChain: Promise<void> = Promise.resolve()

  /**
   * @param path - catalog JSON path.
   */
  constructor(private readonly path: string) {}

  /**
   * Read the catalog, or an empty v1 document when the file is absent.
   * @returns the validated catalog.
   */
  async read(): Promise<InstitutionCatalogFile> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_CATALOG
      throw error
    }
    return parseCatalog(raw, this.path)
  }

  /**
   * Apply one mutation and persist the next catalog.
   * @param mutate - synchronous editor over the current file.
   * @returns the written catalog.
   */
  async update(mutate: (current: InstitutionCatalogFile) => InstitutionCatalogFile): Promise<InstitutionCatalogFile> {
    const run = this.writeChain.then(async () => {
      const next = mutate(await this.read())
      await persistCatalog(this.path, next)
      return next
    })
    this.writeChain = run.then(() => undefined, () => undefined)
    return await run
  }
}

/**
 * Project one squad for the Client, overlaying catalog bindings and an optional live model.
 * @param squad - baked-in definition.
 * @param file - current catalog.
 * @param liveModels - teammate name → model observed on a live Lead, when loaded.
 * @returns the Client row.
 */
export function projectInstitutionSquad(
  squad: InstitutionSquadDefinition,
  file: InstitutionCatalogFile,
  liveModels: Readonly<Record<string, string | undefined>> = {},
): InstitutionSquadView {
  const lead = file.leads[squad.id]
  const bindings = file.seats[squad.id] ?? {}
  const seats: InstitutionSeatView[] = squad.seats.map((seat) => {
    const binding = bindings[seat.name]
    const live = liveModels[seat.name]
    const provider = binding?.provider
    const model = live ?? binding?.model
    return {
      name: seat.name,
      title: seat.title,
      titleEn: seat.titleEn,
      duty: seat.duty,
      ...provider === undefined ? {} : { provider },
      ...model === undefined ? {} : { model },
    }
  })
  return {
    id: squad.id,
    displayName: squad.displayName,
    displayNameEn: squad.displayNameEn,
    ...lead === undefined ? {} : { leadSessionId: lead as SessionId },
    established: lead !== undefined,
    seats,
  }
}

/**
 * Merge one seat route into the catalog file.
 * @param file - current catalog.
 * @param request - seat identity and optional route.
 * @returns the next catalog.
 */
export function applySeatUpdate(
  file: InstitutionCatalogFile,
  request: UpdateInstitutionSeatRequest,
): InstitutionCatalogFile {
  const squad = requireInstitutionSquad(request.squadId)
  requireInstitutionSeat(squad, request.name)
  const provider = normalizeOptionalText(request.provider)
  const model = normalizeOptionalText(request.model)
  const current = { ...file.seats[squad.id] }
  const nextSeats = provider === undefined && model === undefined
    ? Object.fromEntries(Object.entries(current).filter(([name]) => name !== request.name))
    : {
      ...current,
      [request.name]: {
        ...provider === undefined ? {} : { provider },
        ...model === undefined ? {} : { model },
      },
    }
  return {
    version: 1,
    leads: { ...file.leads },
    seats: { ...file.seats, [squad.id]: nextSeats },
  }
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? undefined : trimmed
}

function parseCatalog(raw: string, path: string): InstitutionCatalogFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error: unknown) {
    throw new TeamError(
      `institution catalog at "${path}" is not JSON: ${error instanceof Error ? error.message : 'parse failed'}`,
      'TEAM_INSTITUTION_CATALOG',
      { cause: error },
    )
  }
  const result = catalogSchema.safeParse(parsed)
  if (!result.success) {
    throw new TeamError(
      `institution catalog at "${path}" failed validation`,
      'TEAM_INSTITUTION_CATALOG',
      { cause: result.error },
    )
  }
  return result.data
}

async function persistCatalog(path: string, file: InstitutionCatalogFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}
