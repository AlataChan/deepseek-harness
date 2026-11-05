/**
 * Post-migration source audit for session-projection registrations and
 * agent/request listeners. The frozen M0 ledgers stay the census. This module
 * compares them with the current source tree and never marks that comparison
 * accepted. `m2Closed` means this gate stays closed, not that M2 is complete.
 * A clean clone must contain the two census ledgers; the command throws when
 * either file is missing. Census files are the permitted sites. Extra
 * registration, reader, and listener sites need
 * `.plans/rc1-execution/m1-runtime-site-supplement.json`.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/** Repository-relative path of the frozen projection census. */
export const PROJECTION_DISPOSITIONS = '.plans/upstream-0.2.2-rc1-assessment-2026-11-04/projection-dispositions.json'

/** Repository-relative path of the frozen request-listener census. */
export const REQUEST_DISPOSITIONS = '.plans/upstream-0.2.2-rc1-assessment-2026-11-04/request-dispositions.json'

const SITE_SUPPLEMENT = '.plans/rc1-execution/m1-runtime-site-supplement.json'
const CORRECTIONS = '.plans/rc1-execution/m1-runtime-corrections.json'

/** Qualified P0 commit. A census correction hashes this blob, not `HEAD`. */
export const QUALIFIED_BASELINE_REVISION = '3f528c60a419f1c71c097d44f5c6a78f131256c2'

/** Qualified-blob copy directory. Proof name is the historical path plus `.txt`; shallow CI reads it when `git show` has no object. */
export const BASELINE_EVIDENCE = '.plans/rc1-execution/baselines'
const BASELINE_EVIDENCE_SUFFIX = '.txt'
const EVIDENCE_PATH = '.plans/rc1-execution/m1-runtime-consumer-evidence.json'
const FINDINGS_PATH = '.plans/rc1-execution/m1-runtime-consumer-findings.md'
const VERIFICATION = 'PNPM_CONFIG_ENABLE_GLOBAL_VIRTUAL_STORE=false pnpm --config.enable-global-virtual-store=false --config.verify-deps-before-run=error exec tsx scripts/verify-upstream-runtime-consumers.ts'
const METHODS = new Set([
  'register', 'onChanged', 'onEventChanged', 'stateOf', 'snapshot', 'cachedSnapshot',
  'checkpoint', 'restoreFloor', 'viewCheckpoint', 'restore', 'hydrate', 'summaryKeys', 'readerFor',
])
const KEYED_READERS = new Set(['stateOf', 'readerFor'])
const ROUTE_FIELDS = ['provider', 'model', 'reasoningEffort'] as const
const MUTATION_FIELDS = new Set<string>([...ROUTE_FIELDS, 'maxTokens'])
const SKIP_DIRECTORIES = new Set(['node_modules', 'lib', 'dist', 'coverage', 'tests', '__tests__', 'fixtures', 'target', '.git'])

/** One in-memory source file. Paths are repository-relative and use `/`. */
export interface RuntimeConsumerSource {
  readonly path: string
  readonly text: string
}

/** One frozen projection registration row. */
export interface ProjectionDispositionRow {
  readonly id: string
  readonly file: string
  readonly key: string
  readonly stateVersion: number
  readonly newOwner: string
  readonly awaited: boolean
}

/** One frozen keyed reader row. */
export interface ProjectionReaderRow {
  readonly id: string
  readonly file: string
  readonly key: string | readonly string[] | null
  readonly method: string
}

/** Reviewed census correction. The raw census row stays in the ledger. */
export interface CensusCorrection {
  readonly id: string
  readonly key: string
  readonly symbol: string
  readonly file: string
  readonly censusStateVersion: number
  readonly actualStateVersion: number
  readonly baselineHash: string
  /** Full commit whose blob `baselineHash` must match. The loader requires {@link QUALIFIED_BASELINE_REVISION}. */
  readonly baselineRevision?: string
  readonly behavior: string
  readonly baselineMatches?: boolean
}

/** One moved reader. It counts only when the named file's AST contains the call. */
export interface ReaderReplacement {
  readonly id: string
  readonly key: string
  readonly file: string
  readonly symbol: string
  readonly receiver?: string
  readonly line: number
}

/** One extra current site. Census files stay allowed without an entry here. */
export interface SiteSupplementEntry {
  readonly id: string
  readonly file: string
  readonly key?: string
  readonly method?: string
}

/** Reviewed additions to the frozen census. An empty supplement allows no extra site. */
export interface RuntimeSiteSupplement {
  readonly registrations: readonly SiteSupplementEntry[]
  readonly readers: readonly SiteSupplementEntry[]
  readonly listeners: readonly SiteSupplementEntry[]
}

/** One frozen agent/request listener row. */
export interface RequestDispositionRow {
  readonly id: string
  readonly file: string
  readonly decision: string
  readonly mutates: readonly string[]
}

/** Injected audit input. Fixture callers pass this explicitly. */
export interface RuntimeConsumerAuditInput {
  readonly sources: readonly RuntimeConsumerSource[]
  readonly projectionDispositions: { readonly registrations: readonly ProjectionDispositionRow[] }
  readonly readers?: readonly ProjectionReaderRow[]
  readonly requestDispositions: { readonly listeners: readonly RequestDispositionRow[] }
  readonly siteSupplement?: RuntimeSiteSupplement
  readonly corrections?: readonly CensusCorrection[]
  readonly readerReplacements?: readonly ReaderReplacement[]
  readonly packages?: readonly { readonly name: string; readonly entry: string }[]
}

/** One current-source failure. Acceptance stays closed either way. */
export interface RuntimeConsumerFinding {
  readonly code: 'synchronous-registration' | 'unresolved-owner' | 'conflicting-owner' | 'obsolete-model-selection' | 'uncovered-caller' | 'listener'
  readonly file: string
  readonly line: number
  readonly message: string
  readonly owner: string
}

/** One M0 registration compared with the current definition. */
export interface RuntimeConsumerRow {
  readonly id: string
  readonly key: string
  readonly m0File: string
  readonly m0StateVersion: number
  readonly owner: string | null
  readonly replacement: string | null
  readonly canonicalKey: string
  readonly stateVersion: number | null
  readonly sourceHash: string | null
  readonly awaited: boolean
  readonly shared: boolean
  readonly sites: readonly { readonly file: string; readonly line: number; readonly awaited: boolean }[]
}

/** One M0 listener compared with the current callback. */
export interface RuntimeListenerRow {
  readonly id: string
  readonly file: string
  readonly decision: string
  readonly present: boolean
  readonly assigns: readonly string[]
  readonly image: boolean
}

/** Fresh evidence. `accepted` stays false; M2 stays closed. */
export interface RuntimeConsumerReport {
  readonly kind: 'm1-runtime-consumer-evidence'
  readonly accepted: false
  readonly m2Closed: true
  readonly verification: string
  readonly rows: readonly RuntimeConsumerRow[]
  readonly listeners: readonly RuntimeListenerRow[]
  readonly readers: readonly {
    readonly id: string
    readonly file: string
    readonly key: string | readonly string[] | null
    readonly method: string
    readonly present: boolean
  }[]
  readonly findings: readonly RuntimeConsumerFinding[]
}

interface Canonical {
  readonly identity: string
  readonly key: string
  readonly stateVersion: number | undefined
  readonly file: string
}

interface RegisterSite {
  readonly file: string
  readonly line: number
  readonly awaited: boolean
  readonly ignored: boolean
  readonly via: string
  readonly canonicals: readonly Canonical[]
}

interface ReaderSite {
  readonly file: string
  readonly line: number
  readonly method: string
  readonly key: string | undefined
}

interface ListenerHit {
  readonly line: number
  readonly assigns: ReadonlySet<string>
  readonly image: boolean
}

type Binding =
  | { kind: 'registry' }
  | { kind: 'method'; method: string }
  | { kind: 'expr'; name: string; file: string; expression: ts.Expression }
  | { kind: 'import'; specifier: string; exportName: string }
  | { kind: 'canonicals'; canonicals: readonly Canonical[] }

interface Program {
  readonly files: ReadonlyMap<string, ts.SourceFile>
  readonly text: ReadonlyMap<string, string>
  readonly packages: ReadonlyMap<string, string>
  readonly packageDirs: ReadonlyMap<string, string>
}

/**
 * Audit explicit sources against explicit disposition rows.
 * @param input - sources, package entries, and the frozen rows to compare.
 * @returns the closed evidence report.
 */
export function auditRuntimeConsumers(input: RuntimeConsumerAuditInput): RuntimeConsumerReport {
  const files = new Map<string, ts.SourceFile>()
  const text = new Map<string, string>()
  for (const source of input.sources) {
    const path = source.path.replaceAll('\\', '/')
    text.set(path, source.text)
    files.set(path, ts.createSourceFile(path, source.text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS))
  }
  const packages = new Map<string, string>()
  const packageDirs = new Map<string, string>()
  for (const entry of input.packages ?? []) {
    packages.set(entry.name, entry.entry)
    packageDirs.set(entry.name, posix.dirname(posix.dirname(entry.entry)))
  }
  return compare(input, scan({ files, text, packages, packageDirs }))
}

/**
 * Audit `packages/` and `apps/` source in a checkout.
 * Test trees, fixtures, and built `lib/` are not shipped source.
 * The walk and compare are one case. The measured duration must stay inside the budget.
 * @param root - repository root that contains the frozen ledgers.
 * @param options - per-case budget in milliseconds. The default is 30000.
 * @returns the closed evidence report.
 * @throws {Error} when either frozen ledger is missing or malformed, the budget is not a positive integer, or the scan exceeds that budget.
 */
export function auditRepository(root: string, options?: { readonly timeoutMs?: number }): RuntimeConsumerReport {
  const timeoutMs = options?.timeoutMs ?? 30_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('runtime-consumer: per-case timeout must be a positive integer')
  }
  const started = Date.now()
  const report = auditRepositoryNow(root)
  const elapsed = Date.now() - started
  if (elapsed > timeoutMs) {
    throw new Error(`runtime-consumer: per-case scan exceeded ${String(timeoutMs)}ms (${String(elapsed)}ms)`)
  }
  return report
}

function auditRepositoryNow(root: string): RuntimeConsumerReport {
  const projectionText = readRequired(root, PROJECTION_DISPOSITIONS)
  const requestText = readRequired(root, REQUEST_DISPOSITIONS)
  const ledger = parseProjectionLedger(projectionText)
  const sources: RuntimeConsumerSource[] = []
  const packages: { name: string; entry: string }[] = []
  for (const tree of ['packages', 'apps']) {
    const absolute = join(root, tree)
    if (!existsSync(absolute)) continue
    walk(absolute, root, sources, packages)
  }
  return auditRuntimeConsumers({
    sources,
    packages,
    projectionDispositions: { registrations: ledger.registrations },
    readers: ledger.readers,
    requestDispositions: parseRequestLedger(requestText),
    siteSupplement: readSupplement(root),
    ...readCorrections(root),
  })
}

/**
 * Render findings as intake violations.
 * @param report - audit report.
 * @returns one stable line per finding.
 */
export function formatRuntimeConsumerViolations(report: RuntimeConsumerReport): string[] {
  return report.findings.map(item => `runtime-consumer: [${item.owner}] ${item.message}`)
}

/**
 * Write the evidence JSON and the findings note. Both keep acceptance false.
 * @param report - audit report.
 * @param root - repository root.
 */
export function writeRuntimeConsumerEvidence(report: RuntimeConsumerReport, root: string): void {
  const evidence = resolve(root, EVIDENCE_PATH)
  const findings = resolve(root, FINDINGS_PATH)
  mkdirSync(dirname(evidence), { recursive: true })
  writeFileSync(evidence, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(findings, findingsMarkdown(report))
}

function readRequired(root: string, path: string): string {
  const absolute = resolve(root, path)
  if (!existsSync(absolute)) throw new Error(`runtime-consumer: disposition ledger is missing: ${path}`)
  return readFileSync(absolute, 'utf8')
}

function walk(directory: string, root: string, sources: RuntimeConsumerSource[], packages: { name: string; entry: string }[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      walk(absolute, root, sources, packages)
      continue
    }
    const relativePath = posix.normalize(absolute.slice(root.length + 1).replaceAll('\\', '/'))
    if (entry.name === 'package.json') addPackage(absolute, relativePath, sources, packages)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue
    if (entry.name.endsWith('.d.ts') || entry.name.includes('.spec.') || entry.name.includes('.e2e.')) continue
    sources.push({ path: relativePath, text: readFileSync(absolute, 'utf8') })
  }
}

function addPackage(
  absolute: string,
  relativePath: string,
  sources: RuntimeConsumerSource[],
  packages: { name: string; entry: string }[],
): void {
  const value: unknown = JSON.parse(readFileSync(absolute, 'utf8'))
  if (!isRecord(value) || typeof value.name !== 'string') return
  const directory = posix.dirname(relativePath)
  const entry = `${directory}/src/index.ts`
  if (sources.some(source => source.path === entry) || existsSync(join(absolute, '..', 'src', 'index.ts'))) {
    packages.push({ name: value.name, entry })
  }
}

function parseProjectionLedger(text: string): { registrations: ProjectionDispositionRow[]; readers: ProjectionReaderRow[] } {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || !Array.isArray(value.registrations)) {
    throw new Error('runtime-consumer: projection disposition ledger has no registrations')
  }
  if (!Array.isArray(value.readers)) {
    throw new Error('runtime-consumer: projection disposition ledger has no readers')
  }
  return { registrations: value.registrations.map(projectionRow), readers: value.readers.map(readerRow) }
}

function readerRow(value: unknown): ProjectionReaderRow {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.file !== 'string' || typeof value.method !== 'string' || !isReaderKey(value.key)) {
    throw new Error('runtime-consumer: a projection reader row is missing id, file, key, or method')
  }
  return { id: value.id, file: value.file, key: value.key, method: value.method }
}

function isReaderKey(value: unknown): value is string | readonly string[] | null {
  return value === null || typeof value === 'string' || (Array.isArray(value) && value.every(item => typeof item === 'string'))
}

function readSupplement(root: string): RuntimeSiteSupplement {
  const absolute = resolve(root, SITE_SUPPLEMENT)
  if (!existsSync(absolute)) return { registrations: [], readers: [], listeners: [] }
  const value: unknown = JSON.parse(readFileSync(absolute, 'utf8'))
  if (!isRecord(value) || !Array.isArray(value.registrations) || !Array.isArray(value.readers) || !Array.isArray(value.listeners)) {
    throw new Error('runtime-consumer: site supplement is missing registrations, readers, or listeners')
  }
  return {
    registrations: value.registrations.map(entry => siteEntry(entry, 'registration')),
    readers: value.readers.map(entry => siteEntry(entry, 'reader')),
    listeners: value.listeners.map(entry => siteEntry(entry, 'listener')),
  }
}

function siteEntry(value: unknown, kind: 'registration' | 'reader' | 'listener'): SiteSupplementEntry {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.file !== 'string') {
    throw new Error(`runtime-consumer: a ${kind} supplement entry is missing id or file`)
  }
  if (kind !== 'listener' && typeof value.key !== 'string') {
    throw new Error(`runtime-consumer: a ${kind} supplement entry is missing key`)
  }
  if (kind === 'reader' && typeof value.method !== 'string') {
    throw new Error('runtime-consumer: a reader supplement entry is missing method')
  }
  return {
    id: value.id,
    file: value.file,
    ...typeof value.key === 'string' ? { key: value.key } : {},
    ...typeof value.method === 'string' ? { method: value.method } : {},
  }
}

/**
 * Load reviewed corrections and compare each baseline hash with the qualified blob.
 * @param root - repository root used for `git show`.
 * @param text - corrections JSON. Omission reads the reviewed file. A missing file yields empty lists.
 * @returns corrections with `baselineMatches` set, plus reader replacements.
 * @throws {Error} when the JSON is missing a required correction field or `baselineRevision` is not 40 hex digits.
 */
export function loadCensusCorrections(
  root: string,
  text?: string,
): { corrections: CensusCorrection[]; readerReplacements: ReaderReplacement[] } {
  const payload = text ?? readOptional(root, CORRECTIONS)
  if (payload === undefined) return { corrections: [], readerReplacements: [] }
  const value: unknown = JSON.parse(payload)
  if (!isRecord(value) || !Array.isArray(value.corrections) || !Array.isArray(value.readerReplacements)) {
    throw new Error('runtime-consumer: corrections file is missing corrections or readerReplacements')
  }
  return {
    corrections: value.corrections.map(entry => correctionEntry(entry, root)),
    readerReplacements: value.readerReplacements.map(replacementEntry),
  }
}

function readCorrections(root: string): { corrections: CensusCorrection[]; readerReplacements: ReaderReplacement[] } {
  return loadCensusCorrections(root)
}

function readOptional(root: string, path: string): string | undefined {
  const absolute = resolve(root, path)
  if (!existsSync(absolute)) return undefined
  return readFileSync(absolute, 'utf8')
}

function correctionEntry(value: unknown, root: string): CensusCorrection {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.key !== 'string' || typeof value.symbol !== 'string'
    || typeof value.file !== 'string' || typeof value.censusStateVersion !== 'number' || typeof value.actualStateVersion !== 'number'
    || typeof value.baselineHash !== 'string' || typeof value.baselineRevision !== 'string' || typeof value.behavior !== 'string'
    || !/^[0-9a-f]{40}$/.test(value.baselineRevision)) {
    throw new Error('runtime-consumer: a census correction is missing id, key, symbol, file, versions, baselineHash, baselineRevision, or behavior')
  }
  const baselineRevision = value.baselineRevision
  const anchored = baselineRevision === QUALIFIED_BASELINE_REVISION
  const blob = anchored ? blobHash(root, baselineRevision, value.file) : undefined
  return {
    id: value.id,
    key: value.key,
    symbol: value.symbol,
    file: value.file,
    censusStateVersion: value.censusStateVersion,
    actualStateVersion: value.actualStateVersion,
    baselineHash: value.baselineHash,
    baselineRevision,
    behavior: value.behavior,
    baselineMatches: anchored && blob !== undefined && blob === value.baselineHash,
  }
}

function replacementEntry(value: unknown): ReaderReplacement {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.key !== 'string' || typeof value.file !== 'string'
    || typeof value.symbol !== 'string' || typeof value.line !== 'number') {
    throw new Error('runtime-consumer: a reader replacement is missing id, key, file, symbol, or line')
  }
  return {
    id: value.id,
    key: value.key,
    file: value.file,
    symbol: value.symbol,
    ...typeof value.receiver === 'string' ? { receiver: value.receiver } : {},
    line: value.line,
  }
}

/**
 * Resolve a correction's baseline digest.
 * The committed evidence file is required. A git blob may be absent in a
 * shallow checkout; when that blob is present it must equal the evidence digest.
 * @param evidence - sha256 of the committed qualified blob, or undefined when that file is absent.
 * @param git - sha256 of `git show revision:file`, or undefined when that object is absent.
 * @returns the evidence digest, or undefined when proof is missing or the two digests differ.
 */
export function baselineProof(evidence: string | undefined, git: string | undefined): string | undefined {
  if (evidence === undefined) return undefined
  if (git !== undefined && git !== evidence) return undefined
  return evidence
}

function blobHash(root: string, revision: string, file: string): string | undefined {
  return baselineProof(fileHash(resolve(root, BASELINE_EVIDENCE, revision, baselineEvidenceFile(file))), gitBlob(root, revision, file))
}

function baselineEvidenceFile(file: string): string {
  return `${file}${BASELINE_EVIDENCE_SUFFIX}`
}

function fileHash(file: string): string | undefined {
  if (!existsSync(file)) return undefined
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function gitBlob(root: string, revision: string, file: string): string | undefined {
  try {
    const output = execFileSync('git', ['-C', root, 'show', `${revision}:${file}`], { stdio: ['ignore', 'pipe', 'pipe'] })
    return createHash('sha256').update(output).digest('hex')
  } catch (error: unknown) {
    // A shallow checkout has no qualified object. The committed evidence file remains the proof.
    void error
    return undefined
  }
}

function parseRequestLedger(text: string): { listeners: RequestDispositionRow[] } {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value) || !Array.isArray(value.listeners)) {
    throw new Error('runtime-consumer: request disposition ledger has no listeners')
  }
  return { listeners: value.listeners.map(requestRow) }
}

function projectionRow(value: unknown): ProjectionDispositionRow {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.file !== 'string' || typeof value.key !== 'string'
    || typeof value.newOwner !== 'string' || typeof value.stateVersion !== 'number' || typeof value.awaited !== 'boolean') {
    throw new Error('runtime-consumer: a projection disposition row is missing id, file, key, stateVersion, newOwner, or awaited')
  }
  return {
    id: value.id, file: value.file, key: value.key,
    stateVersion: value.stateVersion, newOwner: value.newOwner, awaited: value.awaited,
  }
}

function requestRow(value: unknown): RequestDispositionRow {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.file !== 'string' || typeof value.decision !== 'string'
    || !Array.isArray(value.mutates) || value.mutates.some(field => typeof field !== 'string')) {
    throw new Error('runtime-consumer: a request disposition row is missing id, file, decision, or mutates')
  }
  return { id: value.id, file: value.file, decision: value.decision, mutates: value.mutates.filter((field): field is string => typeof field === 'string') }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface SymbolCall {
  readonly symbol: string
  readonly receivers: readonly string[]
}

interface Scan {
  readonly registers: readonly RegisterSite[]
  readonly readers: readonly ReaderSite[]
  readonly listeners: ReadonlyMap<string, readonly ListenerHit[]>
  readonly calls: ReadonlyMap<string, readonly SymbolCall[]>
}

function scan(program: Program): Scan {
  const registers: RegisterSite[] = []
  const readers: ReaderSite[] = []
  const listeners = new Map<string, ListenerHit[]>()
  const calls = new Map<string, SymbolCall[]>()
  for (const [file, source] of program.files) {
    const scopes: Map<string, Binding>[] = [new Map<string, Binding>()]
    const lookup = (name: string): Binding | undefined => {
      for (let index = scopes.length - 1; index >= 0; index -= 1) {
        const found = scopes[index]?.get(name)
        if (found) return found
      }
      return undefined
    }
    const scope = (): Map<string, Binding> => scopes[scopes.length - 1] ?? new Map<string, Binding>()
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) bindImport(statement, scope())
    }
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) return
      if (isFunctionWithBody(node)) {
        visitFunction(node)
        return
      }
      if (ts.isForOfStatement(node)) {
        visitForOf(node)
        return
      }
      if (ts.isVariableStatement(node)) {
        visitVariables(node)
        return
      }
      if (ts.isCallExpression(node)) noteCall(node)
      ts.forEachChild(node, visit)
    }
    const visitFunction = (fn: FunctionWithBody): void => {
      scopes.push(new Map())
      for (const parameter of fn.parameters) {
        if (!ts.isIdentifier(parameter.name) || parameter.type === undefined) continue
        const text = parameter.type.getText(source)
        if (text.includes('SessionProjectionRegistry') || text.includes('sessionProjections')) {
          scope().set(parameter.name.text, { kind: 'registry' })
        }
      }
      if (fn.body) {
        if (ts.isBlock(fn.body)) for (const statement of fn.body.statements) visit(statement)
        else visit(fn.body)
      }
      scopes.pop()
    }
    const visitForOf = (statement: ts.ForOfStatement): void => {
      visit(statement.expression)
      const canonicals = canonicalsFrom(statement.expression)
      scopes.push(new Map())
      if (ts.isVariableDeclarationList(statement.initializer)) {
        const declaration = statement.initializer.declarations[0]
        if (declaration && ts.isIdentifier(declaration.name) && canonicals.length > 0) {
          scope().set(declaration.name.text, { kind: 'canonicals', canonicals })
        }
      }
      visit(statement.statement)
      scopes.pop()
    }
    const visitVariables = (statement: ts.VariableStatement): void => {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer) visit(declaration.initializer)
        bindVariable(declaration)
      }
    }
    const bindVariable = (declaration: ts.VariableDeclaration): void => {
      if (ts.isObjectBindingPattern(declaration.name) && declaration.initializer && isRegistry(unwrap(declaration.initializer))) {
        for (const element of declaration.name.elements) {
          if (!ts.isIdentifier(element.name)) continue
          const property = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text
          if (METHODS.has(property)) scope().set(element.name.text, { kind: 'method', method: property })
        }
        return
      }
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return
      const initializer = unwrap(declaration.initializer)
      if (isRegistry(initializer)) scope().set(declaration.name.text, { kind: 'registry' })
      else scope().set(declaration.name.text, { kind: 'expr', name: declaration.name.text, file, expression: initializer })
    }
    const isRegistry = (expression: ts.Expression): boolean => {
      const expr = unwrap(expression)
      if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'sessionProjections') return true
      if (ts.isCallExpression(expr) && (isGet(expr) || expr.arguments.some(argument => stringOf(argument) === 'sessionProjections'))) return true
      if (ts.isIdentifier(expr)) return lookup(expr.text)?.kind === 'registry'
      return false
    }
    const canonicalsFrom = (expression: ts.Expression): Canonical[] => {
      const expr = unwrap(expression)
      if (ts.isObjectLiteralExpression(expr)) {
        const literal = readLiteral(file, expr, `${file}#inline:${lineOf(source, expr)}`)
        return literal ? [literal] : []
      }
      if (ts.isArrayLiteralExpression(expr)) return expr.elements.flatMap(element => canonicalsFrom(element))
      if (!ts.isIdentifier(expr)) return []
      const binding = lookup(expr.text)
      if (!binding) return []
      if (binding.kind === 'canonicals') return [...binding.canonicals]
      if (binding.kind === 'import') {
        const defined = findDefinition(program, resolveSpecifier(program, file, binding.specifier), binding.exportName, new Set())
        const found = defined ? readLiteral(defined.file, unwrap(defined.initializer), `${defined.file}#${defined.name}`) : undefined
        return found ? [found] : []
      }
      if (binding.kind === 'expr') {
        const literal = readLiteral(binding.file, unwrap(binding.expression), `${binding.file}#${binding.name}`)
        return literal ? [literal] : canonicalsFrom(binding.expression)
      }
      return []
    }
    const noteCall = (call: ts.CallExpression): void => {
      const method = calledMethod(call)
      if (method?.method === 'register') {
        const argument = call.arguments[0]
        registers.push({
          file,
          line: lineOf(source, call),
          awaited: isAwaited(call),
          ignored: ts.isExpressionStatement(call.parent) || ts.isVoidExpression(call.parent),
          via: method.via,
          canonicals: argument ? canonicalsFrom(argument) : [],
        })
      } else if (method && method.method !== 'register') {
        const argument = method.method === 'snapshot' ? call.arguments[1] : undefined
        const subset = argument === undefined ? undefined : unwrap(argument)
        const keys = subset !== undefined && ts.isArrayLiteralExpression(subset)
          ? subset.elements.map(element => stringOf(element))
          : [stringArgument(call)]
        for (const key of keys) readers.push({ file, line: lineOf(source, call), method: method.method, key })
      }
      const callback = requestCallback(call)
      if (callback) {
        const hit = mutations(callback, lineOf(source, call))
        const list = listeners.get(file) ?? []
        list.push(hit)
        listeners.set(file, list)
      }
    }
    const calledMethod = (call: ts.CallExpression): { method: string; via: string } | undefined => {
      const callee = unwrap(call.expression)
      if (ts.isPropertyAccessExpression(callee) && METHODS.has(callee.name.text) && isRegistry(callee.expression)) {
        return { method: callee.name.text, via: viaOf(callee.expression) }
      }
      if (ts.isIdentifier(callee)) {
        const binding = lookup(callee.text)
        if (binding?.kind === 'method') return { method: binding.method, via: 'destructure' }
      }
      return undefined
    }
    const viaOf = (expression: ts.Expression): string => {
      const expr = unwrap(expression)
      if (ts.isIdentifier(expr)) return 'alias'
      if (ts.isCallExpression(expr)) return 'get-service'
      return 'direct'
    }
    visit(source)
    calls.set(file, collectSymbolCalls(source))
  }
  return { registers, readers, listeners, calls }
}

function bindImport(statement: ts.ImportDeclaration, scope: Map<string, Binding>): void {
  if (!ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause?.namedBindings) return
  if (!ts.isNamedImports(statement.importClause.namedBindings)) return
  // oxlint-disable-next-line typescript/no-deprecated -- legacy projection key read kept
  if (statement.importClause.isTypeOnly) return
  for (const element of statement.importClause.namedBindings.elements) {
    if (element.isTypeOnly) continue
    scope.set(element.name.text, {
      kind: 'import',
      specifier: statement.moduleSpecifier.text,
      exportName: element.propertyName?.text ?? element.name.text,
    })
  }
}

interface Definition {
  readonly file: string
  readonly name: string
  readonly initializer: ts.Expression
}

function findDefinition(program: Program, file: string | undefined, name: string, seen: Set<string>): Definition | undefined {
  if (file === undefined) return undefined
  const key = `${file}#${name}`
  if (seen.has(key)) return undefined
  seen.add(key)
  const source = program.files.get(file)
  if (!source) return undefined
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) {
        return { file, name, initializer: declaration.initializer }
      }
    }
  }
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue
    for (const element of statement.exportClause.elements) {
      const publicName = element.name.text
      if (publicName !== name) continue
      const local = element.propertyName?.text ?? publicName
      if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        return findDefinition(program, resolveSpecifier(program, file, statement.moduleSpecifier.text), local, seen)
      }
      return findDefinition(program, file, local, seen)
    }
  }
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.exportClause
      || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const found = findDefinition(program, resolveSpecifier(program, file, statement.moduleSpecifier.text), name, seen)
    if (found) return found
  }
  return undefined
}

function resolveSpecifier(program: Program, from: string, specifier: string): string | undefined {
  if (specifier.startsWith('.')) {
    const raw = posix.normalize(posix.join(posix.dirname(from), specifier))
    return [raw, `${raw}.ts`, `${raw}.tsx`, `${raw}/index.ts`].find(candidate => program.files.has(candidate))
  }
  const entry = program.packages.get(specifier)
  if (entry && program.files.has(entry)) return entry
  const parts = specifier.split('/')
  if (parts[0]?.startsWith('@') && parts.length >= 3) {
    const name = parts.slice(0, 2).join('/')
    const directory = program.packageDirs.get(name)
    const rest = parts.slice(2).join('/')
    if (directory) {
      return [`${directory}/src/${rest}.ts`, `${directory}/src/${rest}/index.ts`].find(candidate => program.files.has(candidate))
    }
  }
  return undefined
}

function readLiteral(file: string, expression: ts.Expression, identity: string): Canonical | undefined {
  if (!ts.isObjectLiteralExpression(expression)) return undefined
  let key: string | undefined
  let stateVersion: number | undefined
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) continue
    const name = property.name.text
    const initializer = unwrap(property.initializer)
    if (name === 'key' && ts.isStringLiteral(initializer)) key = initializer.text
    if (name === 'stateVersion' && ts.isNumericLiteral(initializer)) stateVersion = Number(initializer.text)
  }
  if (key === undefined) return undefined
  return { identity, key, stateVersion, file }
}

function compare(input: RuntimeConsumerAuditInput, scanned: Scan): RuntimeConsumerReport {
  const findings: RuntimeConsumerFinding[] = []
  const text = new Map(input.sources.map(source => [source.path.replaceAll('\\', '/'), source.text]))
  const supplement = input.siteSupplement ?? { registrations: [], readers: [], listeners: [] }
  const rows = input.projectionDispositions.registrations.map(row =>
    compareRow(row, scanned.registers, text, input.corrections ?? [], findings))
  const known = new Set(input.projectionDispositions.registrations.map(row => row.key))
  const censusFiles = new Map<string, Set<string>>()
  for (const row of input.projectionDispositions.registrations) {
    const files = censusFiles.get(row.key) ?? new Set<string>()
    files.add(row.file)
    censusFiles.set(row.key, files)
  }
  for (const site of scanned.registers) {
    const unknown = site.canonicals.filter(canonical => !known.has(canonical.key))
    if (unknown.length > 0 && !site.awaited) {
      findings.push(finding('synchronous-registration', site.file, site.line, `${site.ignored ? 'ignored ' : ''}synchronous registration at ${site.file}:${site.line} via ${site.via}`))
    }
    for (const canonical of unknown) {
      const reviewed = supplement.registrations.some(entry => entry.file === site.file && entry.key === canonical.key)
      if (reviewed) continue
      findings.push(finding('uncovered-caller', site.file, site.line, `uncovered caller ${site.file}:${site.line} registers "${canonical.key}"; missing disposition`))
    }
    for (const canonical of site.canonicals) {
      if (!known.has(canonical.key)) continue
      const listed = censusFiles.get(canonical.key)?.has(site.file) === true
      const allowed = supplement.registrations.some(entry => entry.file === site.file && entry.key === canonical.key)
      if (!listed && !allowed) {
        findings.push(finding('uncovered-caller', site.file, site.line, `undispositioned registration site ${site.file}:${site.line} registers known key "${canonical.key}"`))
      }
    }
    if (site.canonicals.length === 0) {
      findings.push(finding('unresolved-owner', site.file, site.line, `unresolved source-owner mapping at ${site.file}:${site.line}`))
    }
  }
  for (const entry of supplement.registrations) {
    if (entry.key === undefined || known.has(entry.key)) continue
    const found = scanned.registers.some(site => site.file === entry.file && site.awaited
      && site.canonicals.some(canonical => canonical.key === entry.key))
    if (!found) {
      findings.push(finding('unresolved-owner', entry.file, 1, `reviewed registration ${entry.id} "${entry.key}" is not an awaited AST register in ${entry.file}`))
    }
  }
  const readerRows = input.readers ?? []
  const readers = readerRows.map(row =>
    compareReader(row, scanned.readers, supplement, input.readerReplacements ?? [], scanned.calls, findings))
  for (const site of scanned.readers) {
    if (site.key === undefined && KEYED_READERS.has(site.method)) {
      findings.push(finding('unresolved-owner', site.file, site.line, `unresolved source-owner mapping for ${site.method} at ${site.file}:${site.line}`))
    }
    if (readerPermitted(site, readerRows, supplement)) continue
    if (site.key === undefined) {
      findings.push(finding('uncovered-caller', site.file, site.line, `undispositioned reader site ${site.file}:${site.line} ${site.method}`))
      continue
    }
    const knownKey = known.has(site.key) || readerRows.some(row => row.key === site.key)
    findings.push(finding('uncovered-caller', site.file, site.line, knownKey
      ? `undispositioned reader site ${site.file}:${site.line} ${site.method}("${site.key}")`
      : `uncovered caller ${site.file}:${site.line} reads "${site.key}"; missing disposition`))
  }
  coreSlice(scanned, input.sources, findings)
  const listeners = input.requestDispositions.listeners.map(row => compareListener(row, scanned.listeners.get(row.file) ?? [], text.get(row.file) ?? '', findings))
  const listenerFiles = new Set([
    ...input.requestDispositions.listeners.map(row => row.file),
    ...supplement.listeners.map(entry => entry.file),
  ])
  for (const [file, hits] of scanned.listeners) {
    if (listenerFiles.has(file)) continue
    const route = hits.some(hit => ROUTE_FIELDS.some(field => hit.assigns.has(field)))
    const line = hits[0]?.line ?? 1
    findings.push(finding('listener', file, line, route
      ? `unlisted agent/request listener mutates the route at ${file}:${line}`
      : `unlisted agent/request listener at ${file}:${line}`))
  }
  findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.message.localeCompare(right.message))
  return {
    kind: 'm1-runtime-consumer-evidence',
    accepted: false,
    m2Closed: true,
    verification: VERIFICATION,
    rows,
    listeners,
    readers,
    findings,
  }
}

function readerPermitted(site: ReaderSite, rows: readonly ProjectionReaderRow[], supplement: RuntimeSiteSupplement): boolean {
  const census = rows.some(row => row.file === site.file && row.method === site.method && rowCoversKey(row.key, site.key))
  const allowed = supplement.readers.some(entry => entry.file === site.file && entry.method === site.method
    && (entry.key === undefined || entry.key === site.key))
  return census || allowed
}

function compareReader(
  row: ProjectionReaderRow,
  sites: readonly ReaderSite[],
  supplement: RuntimeSiteSupplement,
  replacements: readonly ReaderReplacement[],
  calls: ReadonlyMap<string, readonly SymbolCall[]>,
  findings: RuntimeConsumerFinding[],
): { id: string; file: string; key: string | readonly string[] | null; method: string; present: boolean } {
  const missing = readerKeys(row.key).filter(key => !readerKeyPresent(row, key, sites, supplement, replacements, calls))
  if (missing.length > 0) {
    const label = missing.some(key => key === null) ? '' : `("${missing.filter((key): key is string => key !== null).join(',')}")`
    findings.push(finding('unresolved-owner', row.file, 1, `reader ${row.id} ${row.method}${label} has no current site`))
  }
  for (const entry of replacements) {
    if (entry.id !== row.id || replacementCall(entry, calls)) continue
    findings.push(finding('unresolved-owner', entry.file, entry.line, `reader replacement ${entry.id} ${entry.symbol} is not an AST call in ${entry.file}`))
  }
  return { id: row.id, file: row.file, key: row.key, method: row.method, present: missing.length === 0 }
}

function readerKeyPresent(
  row: ProjectionReaderRow,
  key: string | null,
  sites: readonly ReaderSite[],
  supplement: RuntimeSiteSupplement,
  replacements: readonly ReaderReplacement[],
  calls: ReadonlyMap<string, readonly SymbolCall[]>,
): boolean {
  if (sites.some(site => site.file === row.file && site.method === row.method && (key === null || site.key === key))) return true
  if (supplement.readers.some(entry => entry.id === row.id && entry.method === row.method && (key === null || entry.key === key)
    && sites.some(site => site.file === entry.file && site.method === row.method && (key === null || site.key === key)))) return true
  return replacements.some(entry => entry.id === row.id && (key === null || entry.key === key) && replacementCall(entry, calls))
}

function replacementCall(entry: ReaderReplacement, calls: ReadonlyMap<string, readonly SymbolCall[]>): boolean {
  return (calls.get(entry.file) ?? []).some(call => call.symbol === entry.symbol
    && (entry.receiver === undefined || call.receivers.includes(entry.receiver)))
}

function readerKeys(key: ProjectionReaderRow['key']): readonly (string | null)[] {
  if (key === null) return [null]
  if (typeof key === 'string') return [key]
  return [...key]
}

function rowCoversKey(key: ProjectionReaderRow['key'], siteKey: string | undefined): boolean {
  if (key === null) return true
  if (siteKey === undefined) return false
  return Array.isArray(key) ? key.includes(siteKey) : key === siteKey
}

function compareRow(
  row: ProjectionDispositionRow,
  sites: readonly RegisterSite[],
  text: ReadonlyMap<string, string>,
  corrections: readonly CensusCorrection[],
  findings: RuntimeConsumerFinding[],
): RuntimeConsumerRow {
  const matched = sites.filter(site => site.canonicals.some(canonical => canonical.key === row.key))
  const identities = new Map<string, Canonical>()
  for (const site of matched) {
    if (!site.awaited) {
      const ignored = site.ignored ? 'ignored ' : ''
      findings.push(finding('synchronous-registration', site.file, site.line, `${ignored}synchronous registration at ${site.file}:${site.line} via ${site.via} for ${row.id} ${row.key}`))
    }
    for (const canonical of site.canonicals) {
      if (canonical.key === row.key) identities.set(canonical.identity, canonical)
    }
    if (site.canonicals.length === 0) {
      findings.push(finding('unresolved-owner', site.file, site.line, `unresolved source-owner mapping for ${row.id} ${row.key} at ${site.file}:${site.line}`))
    }
  }
  if (matched.length === 0) {
    findings.push(finding('unresolved-owner', row.file, 1, `unresolved source-owner mapping for ${row.id} ${row.key}: no current registration`))
  }
  const correction = corrections.find(item => item.id === row.id && item.key === row.key)
  if (correction?.baselineMatches === false) {
    const revision = correction.baselineRevision ?? QUALIFIED_BASELINE_REVISION
    findings.push(finding('conflicting-owner', correction.file, 1, `correction ${correction.id} baseline hash does not match ${revision} ${correction.file}`))
  }
  const requiredVersion = correction?.actualStateVersion ?? versionIn(row.newOwner) ?? row.stateVersion
  const requiredFile = pathIn(row.newOwner)
  const canonicals = [...identities.values()]
  if (canonicals.length > 1) {
    findings.push(finding(row.key === 'modelSelection' ? 'obsolete-model-selection' : 'conflicting-owner', canonicals[0]?.file ?? row.file, 1,
      `conflicting owner for ${row.id} ${row.key}: ${canonicals.map(canonical => canonical.identity).join(', ')}`))
  }
  for (const canonical of canonicals) {
    if (canonical.stateVersion !== requiredVersion) {
      const code = row.key === 'modelSelection' ? 'obsolete-model-selection' : 'conflicting-owner'
      const message = correction
        ? `behavior regression: ${row.id} ${correction.symbol} stateVersion ${String(canonical.stateVersion)}; reviewed baseline is ${correction.actualStateVersion} and census ${row.stateVersion} stays unchanged`
        : `${row.key === 'modelSelection' ? 'obsolete model-selection owner' : 'conflicting owner'} ${canonical.file} defines stateVersion ${String(canonical.stateVersion)} for ${row.key}; disposition requires ${requiredVersion}`
      findings.push(finding(code, canonical.file, 1, message))
    }
    if (requiredFile !== undefined && canonical.file !== requiredFile) {
      findings.push(finding('conflicting-owner', canonical.file, 1, `conflicting owner for ${row.id} ${row.key}: defined in ${canonical.file}; disposition requires ${requiredFile}`))
    }
  }
  const owner = canonicals[0]?.file ?? null
  const source = owner === null ? undefined : text.get(owner)
  return {
    id: row.id,
    key: row.key,
    m0File: row.file,
    m0StateVersion: row.stateVersion,
    owner,
    replacement: owner !== null && owner !== row.file ? owner : null,
    canonicalKey: row.key,
    stateVersion: canonicals[0]?.stateVersion ?? null,
    sourceHash: source === undefined ? null : createHash('sha256').update(source).digest('hex'),
    awaited: matched.length > 0 && matched.every(site => site.awaited),
    shared: matched.length > 1 && identities.size === 1,
    sites: matched.map(site => ({ file: site.file, line: site.line, awaited: site.awaited })),
  }
}

function compareListener(
  row: RequestDispositionRow,
  hits: readonly ListenerHit[],
  text: string,
  findings: RuntimeConsumerFinding[],
): RuntimeListenerRow {
  const assigns = new Set<string>()
  for (const hit of hits) for (const field of hit.assigns) assigns.add(field)
  const image = hits.some(hit => hit.image)
  if (row.decision === 'retain') {
    if (hits.length === 0) findings.push(finding('listener', row.file, 1, `${row.id} retained listener is missing`))
    for (const field of row.mutates) {
      if (!assigns.has(field)) findings.push(finding('listener', row.file, hits[0]?.line ?? 1, `${row.id} retained rounds listener does not set ${field}`))
    }
    for (const field of ROUTE_FIELDS) {
      if (!row.mutates.includes(field) && assigns.has(field)) findings.push(finding('listener', row.file, hits[0]?.line ?? 1, `${row.id} retained rounds listener mutates ${field}`))
    }
  }
  if (row.decision === 'adapt') {
    for (const field of row.mutates) {
      if (assigns.has(field)) findings.push(finding('listener', row.file, hits[0]?.line ?? 1, `${row.id} still mutates ${field} on agent/request`))
    }
    if (row.file.endsWith('route-override.ts') && (hits.length === 0 || !image)) {
      findings.push(finding('listener', row.file, hits[0]?.line ?? 1, `${row.id} assistant route guard is missing image capability`))
    }
    if (row.file.endsWith('webhook/src/session.ts') && !text.includes('.select(')) {
      findings.push(finding('listener', row.file, 1, `${row.id} webhook listener replacement model.select is missing`))
    }
  }
  return { id: row.id, file: row.file, decision: row.decision, present: hits.length > 0, assigns: [...assigns], image }
}

function coreSlice(scanned: Scan, sources: readonly RuntimeConsumerSource[], findings: RuntimeConsumerFinding[]): void {
  const turn = scanned.registers.filter(site => site.canonicals.some(canonical => canonical.key === 'turnBoundary'))
  if (turn.length > 0) {
    const agent = sources.some(source => source.path === 'packages/core/agent/src/index.ts' && source.text.includes('turnBoundaryOf('))
    if (!agent) findings.push(finding('unresolved-owner', 'packages/core/agent/src/index.ts', 1, 'unresolved source-owner mapping: AgentRegistry does not own turnBoundaryOf'))
    for (const site of turn) {
      if (site.file.startsWith('packages/core/agent-loop/')) {
        findings.push(finding('conflicting-owner', site.file, site.line, `conflicting owner: agent-loop still registers turnBoundary at ${site.file}:${site.line}`))
      }
    }
  }
  const inbox = scanned.registers.filter(site => site.canonicals.some(canonical => canonical.key === 'inbox') && site.file.startsWith('packages/core/agent-loop/') && site.awaited)
  const inboxAnywhere = scanned.registers.some(site => site.canonicals.some(canonical => canonical.key === 'inbox'))
  if (inboxAnywhere && inbox.length === 0) {
    findings.push(finding('unresolved-owner', 'packages/core/agent-loop/src/index.ts', 1, 'unresolved source-owner mapping: inbox is not an awaited agent-loop registration'))
  }
}

function finding(code: RuntimeConsumerFinding['code'], file: string, line: number, message: string): RuntimeConsumerFinding {
  return { code, file, line, message, owner: packageOwner(file) }
}

function packageOwner(file: string): string {
  const parts = file.split('/')
  if (parts[0] === 'packages' && parts[1] !== undefined && parts[2] !== undefined) return `${parts[1]}/${parts[2]}`
  if (parts[0] === 'apps' && parts[1] !== undefined) return `apps/${parts[1]}`
  return 'unscoped'
}

function versionIn(owner: string): number | undefined {
  const match = /stateVersion\s+(\d+)/.exec(owner)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

function pathIn(owner: string): string | undefined {
  return /packages\/[A-Za-z0-9_./-]+\.ts/.exec(owner)?.[0]
}

function findingsMarkdown(report: RuntimeConsumerReport): string {
  const lines = [
    '# M1 runtime consumer findings',
    '',
    'Acceptance is false and M2 stays closed. The frozen M0 census was not rewritten.',
    `Verification: \`${report.verification}\`.`,
    '',
    `Findings: ${report.findings.length}. Rows: ${report.rows.length}. Listeners: ${report.listeners.length}. Readers: ${report.readers.length}.`,
    '',
  ]
  for (const item of report.findings) lines.push(`- ${item.owner} ${item.file}:${item.line} ${item.code}: ${item.message}`)
  if (report.findings.length === 0) lines.push('No current-source findings. Acceptance is still false.')
  lines.push('')
  return lines.join('\n')
}

function mutations(callback: ts.Node, line: number): ListenerHit {
  const assigns = new Set<string>()
  let image = false
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return
    if (ts.isStringLiteral(node) && node.text === 'image') image = true
    if (ts.isIdentifier(node) && /image/i.test(node.text)) image = true
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && MUTATION_FIELDS.has(node.left.name.text)) {
      assigns.add(node.left.name.text)
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        const name = propertyName(property)
        if (name !== undefined && MUTATION_FIELDS.has(name)) assigns.add(name)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(callback)
  return { line, assigns, image }
}

function propertyName(property: ts.ObjectLiteralElement): string | undefined {
  if ((ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
    && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
    return property.name.text
  }
  return undefined
}

function requestCallback(call: ts.CallExpression): ts.Expression | undefined {
  const callee = unwrap(call.expression)
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'on') return undefined
  if (stringOf(call.arguments[0]) !== 'agent/request') return undefined
  return call.arguments[1]
}

function isAwaited(node: ts.Node): boolean {
  let current: ts.Node = node
  while (!ts.isSourceFile(current)) {
    const parent = current.parent
    if (ts.isAwaitExpression(parent) && parent.expression === current) return true
    if (isTransparent(parent)) {
      current = parent
      continue
    }
    if (ts.isArrayLiteralExpression(parent) && parent.elements.includes(current as ts.Expression)) {
      if (promiseAllAwait(parent)) return true
      const name = arrayBinding(parent)
      if (name && usesAwaitedPromise(name)) return true
      return false
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === current && ts.isIdentifier(parent.name)) {
      return usesAwaitedPromise(parent.name)
    }
    return false
  }
  return false
}

function promiseAllAwait(array: ts.ArrayLiteralExpression): boolean {
  const parent = array.parent
  if (!ts.isCallExpression(parent) || parent.arguments[0] !== array || !isPromiseAll(parent)) return false
  return awaitWraps(parent)
}

function awaitWraps(node: ts.Node): boolean {
  let current = node
  while (!ts.isSourceFile(current)) {
    if (ts.isAwaitExpression(current.parent) && current.parent.expression === current) return true
    if (isTransparent(current.parent)) {
      current = current.parent
      continue
    }
    return false
  }
  return false
}

function usesAwaitedPromise(name: ts.Identifier): boolean {
  const owner = enclosingFunction(name)
  const usage = { awaited: false, leaked: false }
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && node !== owner) return
    if (ts.isIdentifier(node) && node !== name && node.text === name.text) {
      if (ts.isAwaitExpression(node.parent) && node.parent.expression === node) usage.awaited = true
      else if (ts.isCallExpression(node.parent) && isPromiseAll(node.parent)
        && node.parent.arguments[0] === node && awaitWraps(node.parent)) usage.awaited = true
      else if (!ts.isVariableDeclaration(node.parent)) usage.leaked = true
    }
    ts.forEachChild(node, visit)
  }
  visit(owner)
  return usage.awaited && !usage.leaked
}

function enclosingFunction(node: ts.Node): ts.Node {
  let current: ts.Node = node
  while (!ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) return current
    current = current.parent
  }
  return current
}

function arrayBinding(array: ts.ArrayLiteralExpression): ts.Identifier | undefined {
  const parent = array.parent
  return ts.isVariableDeclaration(parent) && parent.initializer === array && ts.isIdentifier(parent.name) ? parent.name : undefined
}

function isPromiseAll(call: ts.CallExpression): boolean {
  const callee = unwrap(call.expression)
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'Promise'
    && (callee.name.text === 'all' || callee.name.text === 'allSettled')
}

function isGet(call: ts.CallExpression): boolean {
  const callee = unwrap(call.expression)
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'get' && stringOf(call.arguments[0]) === 'sessionProjections'
}

function stringArgument(call: ts.CallExpression): string | undefined {
  for (const argument of call.arguments) {
    const text = stringOf(argument)
    if (text !== undefined) return text
  }
  return undefined
}

function stringOf(node: ts.Expression | undefined): string | undefined {
  if (node === undefined) return undefined
  const expr = unwrap(node)
  return ts.isStringLiteral(expr) ? expr.text : undefined
}

type FunctionWithBody =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration

function isFunctionWithBody(node: ts.Node): node is FunctionWithBody {
  return ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isArrowFunction(node)
    || ts.isFunctionExpression(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
}

type TransparentExpression =
  | ts.ParenthesizedExpression
  | ts.AsExpression
  | ts.SatisfiesExpression
  | ts.NonNullExpression
  | ts.TypeAssertion

function isTransparent(node: ts.Node): node is TransparentExpression {
  return ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
    || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression(node)
}

function collectSymbolCalls(source: ts.SourceFile): SymbolCall[] {
  const calls: SymbolCall[] = []
  const walk = (node: ts.Node, bindings: Map<string, readonly string[]>): void => {
    if (ts.isTypeNode(node)) return
    if (ts.isFunctionLike(node)) {
      const local = new Map(bindings)
      ts.forEachChild(node, (child) =>{  walk(child, local) })
      return
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      bindings.set(node.name.text, receiverNames(node.initializer, bindings))
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      if (ts.isPropertyAccessExpression(callee)) {
        calls.push({ symbol: callee.name.text, receivers: receiverNames(callee.expression, bindings) })
      }
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'inbox') {
      calls.push({ symbol: 'inbox', receivers: receiverNames(node.expression, bindings) })
    }
    ts.forEachChild(node, (child) =>{  walk(child, bindings) })
  }
  walk(source, new Map())
  return calls
}

function receiverNames(expression: ts.Expression, bindings: ReadonlyMap<string, readonly string[]>): readonly string[] {
  const node = unwrap(expression)
  if (ts.isIdentifier(node)) return [node.text, ...(bindings.get(node.text) ?? [])]
  if (ts.isPropertyAccessExpression(node)) return [...receiverNames(node.expression, bindings), node.name.text]
  if (ts.isCallExpression(node)) {
    const callee = unwrap(node.expression)
    if (ts.isPropertyAccessExpression(callee)) return [...receiverNames(callee.expression, bindings), callee.name.text]
  }
  return []
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression
  while (isTransparent(current)) current = current.expression
  return current
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}

function isCliEntry(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entry))
  } catch (error: unknown) {
    // A missing argv path means this module was imported, not executed.
    return error === undefined
  }
}

if (isCliEntry()) {
  const root = resolve(import.meta.dirname, '..')
  try {
    const report = auditRepository(root)
    writeRuntimeConsumerEvidence(report, root)
    const lines = formatRuntimeConsumerViolations(report)
    if (lines.length > 0) {
      console.error(`verify-upstream-runtime-consumers: ${lines.length} finding(s); acceptance stays false`)
      for (const line of lines) console.error(`  ${line}`)
      process.exitCode = 1
    } else {
      console.log('verify-upstream-runtime-consumers: no findings; acceptance stays false')
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`verify-upstream-runtime-consumers: ${message}`)
    process.exitCode = 1
  }
}
