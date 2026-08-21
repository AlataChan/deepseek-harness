/**
 * Composition regression for extracting the transport-neutral interactive
 * client layer from the browser surface.
 */

import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const BASE_PATCH = fileURLToPath(new URL('../../base/cordis.patch.yml', import.meta.url))
const CLIENT_PATCH = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
const WEB_PATCH = fileURLToPath(new URL('../../web-app/cordis.patch.yml', import.meta.url))

function insertedIds(patches: readonly PatchOptions[]): string[] {
  return patches.flatMap(patch => patch.insert?.map(row => row.id ?? '') ?? [])
}

function canonicalFingerprint(patches: readonly PatchOptions[][]): string {
  const rows = composeEntries(patches)
    // Task 3 replaces the modules row's former internal Web registrations
    // with one explicit adapter row. Excluding that ownership-only split keeps
    // this Task 2 fingerprint anchored to the pre-extraction row/config set.
    .filter(row => row.disabled !== true && row.id !== 'client-modules-web')
    .toSorted((left, right) => (left.id ?? '').localeCompare(right.id ?? ''))
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

describe('client-app composition', () => {
  it('preserves the enabled Web rows and resolved configs while separating surface order', () => {
    const base = loadOverlayPatches('client-app-test', BASE_PATCH)
    const client = loadOverlayPatches('client-app-test', CLIENT_PATCH)
    const web = loadOverlayPatches('client-app-test', WEB_PATCH)
    const rows = composeEntries([base, client, web]).filter(row => row.disabled !== true)
    const clientIds = insertedIds(client)
    const webIds = insertedIds(web)

    // Canonicalized only across the two new ownership partitions: this hash is
    // the pre-extraction base + web row/config set. Within each partition the
    // assertions below keep the source order exact.
    expect(canonicalFingerprint([base, client, web]))
      .toBe('5ead7b1d3d1f94cf6ec06c1d65a7066da5d4a5a406ee9be21d58da21983f14e3')
    expect(rows.filter(row => clientIds.includes(row.id ?? '')).map(row => row.id))
      .toEqual(clientIds)
    expect(rows.filter(row => webIds.includes(row.id ?? '')).map(row => row.id))
      .toEqual(webIds)
    expect(webIds).toEqual([
      'session-log-download',
      'directory-picker',
      'web-startup',
      'webserver',
      'client-modules-web',
      'web-runtime',
      'client-hmr',
      'connection',
    ])
    expect(clientIds.filter(id => webIds.includes(id))).toEqual([])
  })
})
