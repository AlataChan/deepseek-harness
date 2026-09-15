/**
 * Experimental file-backed commerce Provider.
 * @module @deepseek-ai/dsh-experimental-commerce-mode
 */

import z from '@deepseek-ai/schemastery'
import CommerceModeProvider from './provider/index.ts'
import type { Config } from './provider/types.ts'

export type {
  AnalysisConfig,
  ColumnMapping,
  Config,
  PlatformConfig,
} from './provider/types.ts'

/** File-backed commerce Provider with load-validated deployment configuration. */
export default class CommerceMode extends CommerceModeProvider {
  static override inject = ['sessionProjections', 'subprocess']

  /** Validated file-provider and analysis configuration. */
  static Config: z<Config> = z.object({
    sourcesRoot: z.string().required(),
    platforms: z.dict(z.object({
      orders: z.dict(z.string()),
      products: z.dict(z.string()),
      inventory: z.dict(z.string()),
    })).required(),
    analysis: z.object({
      maxRows: z.number().step(1).min(1).required(),
      maxOutputBytes: z.number().step(1).min(1).required(),
      timeoutMs: z.number().step(1).min(1).required(),
      graceMs: z.number().step(1).min(1).required(),
    }).required(),
    lockWaitMs: z.number().step(1).min(1).required(),
    sqlite3Path: z.string().default(''),
  })
}
