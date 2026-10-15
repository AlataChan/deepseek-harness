import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { setupAssistantHarness } from './harness.ts'
import { AssistantCatalog } from '../src/catalog.ts'
import { ProvisioningOperationId } from '../src/types.ts'

describe('Round 2 residual acceptance controls', () => {
  it('rejects a conflicting payload while the same operation id is in flight', async () => {
    const h = await setupAssistantHarness()
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const entered = new Promise<void>((r) => { started = r })
    try {
      const id = ProvisioningOperationId('r2-conflict')
      const first = h.catalog!.executeProvisioning({ id, payload: { name: 'A' }, run: async () => { started(); await gate; return { id: 'A' } } })
      await entered
      const secondPromise = expect(
        h.catalog!.executeProvisioning({ id, payload: { name: 'B' }, run: async () => ({ id: 'B' }) }),
      ).rejects.toThrow(/conflict|payload|fingerprint/i)
      release()
      await first
      await secondPromise
    } finally { release(); await h.dispose() }
  })

  it('does not acknowledge a transient profile while catalog opening is pending', async () => {
    const h = await setupAssistantHarness([], {}, { withCatalog: false })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let opening: Promise<AssistantCatalog | undefined> | undefined
    const actualOpen = AssistantCatalog.open.bind(AssistantCatalog)
    const openSpy = vi.spyOn(AssistantCatalog, 'open').mockImplementation(async (...args) => { await gate; return actualOpen(...args) })
    try {
      await h.ctx.plugin(Storage)
      await h.ctx.plugin(StorageJson, { root: join(h.storageRoot, 'storages') })
      await h.ctx.plugin(StorageDomain, { backend: 'json' })
      opening = h.assistants.initCatalog({ lockPath: join(h.storageRoot, 'storages', 'assistants.lock') })
      const creation = h.assistants.createProfile({ name: 'During opening', responsibility: 'Must persist' })
      release()
      const catalog = await opening
      const created = await creation
      expect(catalog!.getProfile(created.id)).toBeDefined()
    } finally { release(); await opening; openSpy.mockRestore(); await h.dispose() }
  })

  it('does not silently replace a failed runtime spawn with an unrelated root session', async () => {
    const h = await setupAssistantHarness([], {}, { withAgentTeams: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Worker', responsibility: 'Work' })
      const t = await h.assistants.createTeam({ name: 'Team', coordinatorProfileId: p.id, leadSessionId: h.lead.id })
      const seat = await h.assistants.createSeat({ teamId: t.id, profileId: p.id, role: 'teammate', name: 'worker', duty: 'Work' })
      const spawn = vi.spyOn(h.ctx.agentTeams, 'spawnTeammate').mockRejectedValueOnce(new Error('AUDIT_SPAWN_DENIED'))
      await expect(h.assistants.replaceSeatInstance(seat.id, 'replacement-worker')).rejects.toThrow('AUDIT_SPAWN_DENIED')
      spawn.mockRestore()
    } finally { vi.restoreAllMocks(); await h.dispose() }
  })

  it('commits a provisioning operation before creating the team coordinator', async () => {
    const h = await setupAssistantHarness([], {}, { withAgentTeams: true })
    try {
      const p = await h.assistants.createProfile({ name: 'Coordinator', responsibility: 'Coordinate' })
      const t = await h.assistants.createTeam({ name: 'Team', coordinatorProfileId: p.id })
      let hadCommittedOperation = false
      const originalCreate = h.controller.create.bind(h.controller)
      const create = vi.spyOn(h.controller, 'create').mockImplementation(async (...args) => {
        hadCommittedOperation = h.catalog!.listOperations().length > 0
        return originalCreate(...args)
      })
      await h.assistants.provisionTeam(t.id)
      expect(hadCommittedOperation).toBe(true)
      create.mockRestore()
    } finally { vi.restoreAllMocks(); await h.dispose() }
  })
})
