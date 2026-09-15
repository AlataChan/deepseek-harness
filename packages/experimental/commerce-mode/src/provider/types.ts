/** Provider configuration and fixed-table declarations. */

import type { CommerceDataKind } from '@deepseek-ai/dsh-host-commerce'

/** Canonical field to source-header mapping for one fixed table. */
export type ColumnMapping = Readonly<Record<string, string>>

/** Per-kind mappings for one commerce platform. */
export type PlatformConfig = Readonly<Partial<Record<CommerceDataKind, ColumnMapping>>>

/** Deployment bounds for analysis subprocesses. */
export interface AnalysisConfig {
  /** Maximum returned rows before `truncated` becomes true. */
  readonly maxRows: number
  /** Maximum collected stdout bytes before process-tree termination. */
  readonly maxOutputBytes: number
  /** Wall-clock deadline for one sqlite3 process. */
  readonly timeoutMs: number
  /** SIGTERM-to-SIGKILL grace supplied to the subprocess service. */
  readonly graceMs: number
}

/** Validated commerce-mode Host configuration. */
export interface Config {
  /** Absolute directory containing the manifest and source databases. */
  readonly sourcesRoot: string
  /** Platform ids mapped to canonical fields and incoming column headers. */
  readonly platforms: Readonly<Record<string, PlatformConfig>>
  /** Query row, byte, time, and termination bounds. */
  readonly analysis: AnalysisConfig
  /** Maximum wait, in milliseconds, for the cross-process source-store lock an import holds. */
  readonly lockWaitMs: number
  /** Optional sqlite3 executable; an omitted value resolves `sqlite3`. */
  readonly sqlite3Path?: string
}
