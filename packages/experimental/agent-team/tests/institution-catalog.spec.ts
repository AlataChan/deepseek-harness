import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TeamError } from '../src/error.ts'
import {
  applySeatUpdate,
  InstitutionCatalog,
  INSTITUTION_SQUADS,
  projectInstitutionSquad,
  requireInstitutionSquad,
  resolveInstitutionCatalogPath,
  standingSeatPrompt,
} from '../src/institution.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('institution catalog file', () => {
  it('reads an empty catalog when the file is missing', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-inst-file-')), 'institution-squads.json')
    roots.push(path.slice(0, path.lastIndexOf('/')))
    const catalog = new InstitutionCatalog(path)
    await expect(catalog.read()).resolves.toEqual({ version: 1, leads: {}, seats: {} })
  })

  it('round-trips a seat update and projects live model over the catalog route', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-inst-file-')), 'institution-squads.json')
    roots.push(path.slice(0, path.lastIndexOf('/')))
    const catalog = new InstitutionCatalog(path)
    await catalog.update(file => applySeatUpdate(file, {
      squadId: 'comms',
      name: 'copywriter',
      provider: 'deepseek',
      model: 'catalog-model',
    }))
    const file = await catalog.read()
    const projected = projectInstitutionSquad(INSTITUTION_SQUADS[2]!, file, { copywriter: 'live-model' })
    expect(projected.seats.find(seat => seat.name === 'copywriter')).toMatchObject({
      provider: 'deepseek',
      model: 'live-model',
    })
  })

  it('rejects invalid JSON and an unknown squad', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-inst-file-')), 'institution-squads.json')
    roots.push(path.slice(0, path.lastIndexOf('/')))
    writeFileSync(path, '{')
    const catalog = new InstitutionCatalog(path)
    await expect(catalog.read()).rejects.toSatisfy(
      (error: unknown) => error instanceof TeamError && error.code === 'TEAM_INSTITUTION_CATALOG',
    )
    expect(() => requireInstitutionSquad('sales')).toThrowError(TeamError)
    expect(standingSeatPrompt(INSTITUTION_SQUADS[0]!, INSTITUTION_SQUADS[0]!.seats[0]!)).toContain('archivist')
  })

  it('clears a seat route and rejects a wrong catalog version', async () => {
    const filled = applySeatUpdate({ version: 1, leads: {}, seats: {} }, {
      squadId: 'comms',
      name: 'copywriter',
      model: 'x',
    })
    expect(filled.seats.comms?.copywriter).toEqual({ model: 'x' })
    expect(applySeatUpdate(filled, { squadId: 'comms', name: 'copywriter' }).seats.comms?.copywriter).toBeUndefined()
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-inst-file-')), 'institution-squads.json')
    roots.push(path.slice(0, path.lastIndexOf('/')))
    writeFileSync(path, '{"version":2}\n')
    await expect(new InstitutionCatalog(path).read()).rejects.toSatisfy(
      (error: unknown) => error instanceof TeamError && error.code === 'TEAM_INSTITUTION_CATALOG',
    )
  })

  it('uses DSH_HOME when the configured path is blank', () => {
    expect(resolveInstitutionCatalogPath()).toContain('institution-squads.json')
    expect(resolveInstitutionCatalogPath('')).toContain('institution-squads.json')
    expect(resolveInstitutionCatalogPath('/tmp/custom.json')).toBe('/tmp/custom.json')
  })

  it('rethrows a non-missing catalog read and keeps writing after a failed update', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-inst-file-'))
    roots.push(dir)
    const asDir = join(dir, 'not-a-file')
    mkdirSync(asDir)
    await expect(new InstitutionCatalog(asDir).read()).rejects.toBeDefined()
    const path = join(dir, 'institution-squads.json')
    const catalog = new InstitutionCatalog(path)
    await expect(catalog.update(() => {
      throw new Error('edit failed')
    })).rejects.toThrow('edit failed')
    await catalog.update(file => applySeatUpdate(file, {
      squadId: 'document',
      name: 'reviewer',
      provider: 'only-provider',
    }))
    expect((await catalog.read()).seats.document?.reviewer).toEqual({ provider: 'only-provider' })
  })

  it('names a non-Error JSON parse failure', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-inst-file-')), 'institution-squads.json')
    roots.push(path.slice(0, path.lastIndexOf('/')))
    writeFileSync(path, '{"version":1}\n')
    const original = JSON.parse
    JSON.parse = (() => {
      throw 'boom'
    }) as typeof JSON.parse
    try {
      await expect(new InstitutionCatalog(path).read()).rejects.toSatisfy(
        (error: unknown) => error instanceof TeamError
          && error.code === 'TEAM_INSTITUTION_CATALOG'
          && error.message.includes('parse failed'),
      )
    } finally {
      JSON.parse = original
    }
  })
})
