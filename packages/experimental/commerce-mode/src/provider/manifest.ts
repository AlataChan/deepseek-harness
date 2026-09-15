/**
 * Versioned commerce-source manifest and deterministic database paths.
 * @module @deepseek-ai/dsh-experimental-commerce-mode/provider/manifest
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  CommerceError,
  CommerceSourceId,
  type CommerceDataKind,
  type CommerceSource,
} from '@deepseek-ai/dsh-host-commerce'

/** Current commerce manifest format. */
export const COMMERCE_MANIFEST_VERSION = 1

const sourceSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u),
  displayName: z.string().min(1),
  kinds: z.array(z.enum(['orders', 'products', 'inventory'])),
  warnings: z.array(z.string()),
}).strict()

const manifestSchema = z.object({
  version: z.literal(COMMERCE_MANIFEST_VERSION),
  sources: z.array(sourceSchema),
}).strict()

/** One row stored in `manifest.json`. */
export interface StoredCommerceSource {
  readonly id: CommerceSourceId
  readonly displayName: string
  readonly kinds: readonly CommerceDataKind[]
  readonly warnings: readonly string[]
}

/** Parsed commerce source manifest. */
export interface CommerceManifest {
  readonly version: typeof COMMERCE_MANIFEST_VERSION
  readonly sources: readonly StoredCommerceSource[]
}

/**
 * Absolute manifest path for one source root.
 * @param root - configured source root.
 * @returns manifest path.
 */
export function commerceManifestPath(root: string): string {
  return join(resolve(root), 'manifest.json')
}

/**
 * Validate an opaque source id before using it as a filename.
 * @param sourceId - provider-managed source id.
 * @returns the unchanged accepted id.
 */
export function validateSourceId(sourceId: CommerceSourceId): CommerceSourceId {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(sourceId)) {
    throw new CommerceError('source-invalid', 'commerce source id is not a safe filename', {
      ruleId: 'source-id',
    })
  }
  return sourceId
}

/**
 * Deterministic database path for one source id.
 * @param root - configured source root.
 * @param sourceId - validated source identity.
 * @returns database path directly beneath the root.
 */
export function sourceDatabasePath(root: string, sourceId: CommerceSourceId): string {
  return join(resolve(root), `${validateSourceId(sourceId)}.sqlite`)
}

/**
 * Allocate a source id suitable for a database filename.
 * @returns fresh branded source id.
 */
export function newCommerceSourceId(): CommerceSourceId {
  return CommerceSourceId(`source-${randomUUID()}`)
}

/**
 * Read and validate a commerce manifest.
 * @param root - configured source root.
 * @returns parsed manifest, or an empty document when absent.
 */
export async function readCommerceManifest(root: string): Promise<CommerceManifest> {
  let text: string
  try {
    text = await readFile(commerceManifestPath(root), 'utf8')
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: COMMERCE_MANIFEST_VERSION, sources: [] }
    }
    throw error
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new CommerceError('source-invalid', 'commerce manifest is not JSON', { ruleId: 'manifest-json' })
  }
  const parsed = manifestSchema.safeParse(value)
  if (!parsed.success) {
    throw new CommerceError('source-invalid', 'commerce manifest failed validation', {
      ruleId: 'manifest-schema',
    })
  }
  return {
    version: COMMERCE_MANIFEST_VERSION,
    sources: parsed.data.sources.map(source => ({
      id: CommerceSourceId(source.id),
      displayName: source.displayName,
      kinds: source.kinds,
      warnings: source.warnings,
    })),
  }
}

/**
 * Atomically replace the commerce manifest.
 * @param root - configured source root.
 * @param manifest - complete next document.
 * @returns after the rename commit point.
 */
export async function writeCommerceManifest(root: string, manifest: CommerceManifest): Promise<void> {
  const target = commerceManifestPath(root)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
  } catch (error: unknown) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

/**
 * Convert a stored row to the public list value.
 * @param source - stored manifest row.
 * @returns public commerce source.
 */
export function publicSource(source: StoredCommerceSource): CommerceSource {
  return {
    id: source.id,
    displayName: source.displayName,
    kinds: source.kinds,
  }
}
