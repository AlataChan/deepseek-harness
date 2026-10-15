import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import {
  AssistantCatalog,
  AssistantProfileId,
  CatalogAlreadyOwnedError,
  CatalogWriteLease,
  ProvisioningConflictError,
  ProvisioningOperationId,
  RevisionConflictError,
  AmbiguousAllocationError,
  computeInputFingerprint,
  canonicalJsonStringify,
} from '../src/index.ts'

describe('AssistantCatalog and Provisioning Ledger (S6)', () => {
  let tmpDir: string
  let storageDir: string
  let lockPath: string
  let ctx: Context

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'dsh-catalog-test-'))
    storageDir = join(tmpDir, 'storages')
    lockPath = join(storageDir, 'assistants.lock')

    ctx = new Context()
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: storageDir })
    await ctx.plugin(StorageDomain, { backend: 'json' })
  })

  afterEach(async () => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('Fingerprinting', () => {
    it('canonicalJsonStringify sorts keys recursively and handles primitives', () => {
      const a = { z: 1, a: 2, nested: { b: 3, a: 4 } }
      const b = { a: 2, nested: { a: 4, b: 3 }, z: 1 }
      expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b))
      expect(canonicalJsonStringify(a)).toBe('{"a":2,"nested":{"a":4,"b":3},"z":1}')
      expect(canonicalJsonStringify(null)).toBe('null')
      expect(canonicalJsonStringify([3, 2, 1])).toBe('[3,2,1]')
    })

    it('computeInputFingerprint returns identical sha256 for reordered properties', () => {
      const payload1 = { model: 'deepseek-chat', options: { temperature: 0.7, maxTokens: 100 } }
      const payload2 = { options: { maxTokens: 100, temperature: 0.7 }, model: 'deepseek-chat' }
      expect(computeInputFingerprint(payload1)).toBe(computeInputFingerprint(payload2))
      expect(computeInputFingerprint(payload1)).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('Flock Kernel Write Lease and Second-Writer Refusal', () => {
    it('grants lease to first writer and refuses second writer with CatalogAlreadyOwnedError', async () => {
      const lease1 = await CatalogWriteLease.acquire(lockPath)
      expect(lease1.isHeld).toBe(true)

      // Second acquire on the same lock path must reject immediately
      await expect(CatalogWriteLease.acquire(lockPath)).rejects.toThrow(CatalogAlreadyOwnedError)

      // Release first lease
      await lease1.release()
      expect(lease1.isHeld).toBe(false)

      // Second acquire must now succeed
      const lease2 = await CatalogWriteLease.acquire(lockPath)
      expect(lease2.isHeld).toBe(true)
      await lease2.release()
    })

    it('refuses second catalog open while first catalog is active', async () => {
      const catalog1 = await AssistantCatalog.open(ctx, { lockPath })
      expect(catalog1.isHeld).toBe(true)

      const ctx2 = new Context()
      await ctx2.plugin(Storage)
      await ctx2.plugin(StorageJson, { root: storageDir })
      await ctx2.plugin(StorageDomain, { backend: 'json' })

      await expect(AssistantCatalog.open(ctx2, { lockPath })).rejects.toThrow(CatalogAlreadyOwnedError)

      await catalog1.close()
      expect(catalog1.isHeld).toBe(false)

      const catalog2 = await AssistantCatalog.open(ctx2, { lockPath })
      expect(catalog2.isHeld).toBe(true)
      await catalog2.close()
    })
  })

  describe('AssistantProfile CRUD and Revision Checks', () => {
    it('creates profile with revision 1 and persists to assistants.json', async () => {
      const catalog = await AssistantCatalog.open(ctx, { lockPath })

      const profile = await catalog.createProfile({
        name: 'Research Assistant',
        responsibility: 'Conducts thorough research and synthesis',
        instructions: 'Focus on primary sources',
        defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
      })

      expect(profile.id).toBeDefined()
      expect(profile.revision).toBe(1)
      expect(profile.name).toBe('Research Assistant')
      expect(profile.createdAt).toBeGreaterThan(0)
      expect(profile.updatedAt).toBe(profile.createdAt)

      // Check synchronous retrieval
      const fetched = catalog.getProfile(profile.id)
      expect(fetched).toEqual(profile)

      const required = catalog.requireProfile(profile.id)
      expect(required).toEqual(profile)

      await catalog.close()

      // Verify file exists on disk
      const rawContent = await readFile(join(storageDir, 'assistants.json'), 'utf8')
      const parsed = JSON.parse(rawContent)
      expect(parsed.tables.profiles[profile.id].name).toBe('Research Assistant')
    })

    it('rejects empty name or responsibility', async () => {
      const catalog = await AssistantCatalog.open(ctx, { lockPath })

      await expect(catalog.createProfile({
        name: '   ',
        responsibility: 'Some duty',
      })).rejects.toThrow(/name cannot be empty/)

      await expect(catalog.createProfile({
        name: 'Valid Name',
        responsibility: '',
      })).rejects.toThrow(/responsibility cannot be empty/)

      await catalog.close()
    })

    it('updates profile and increments revision on matching expectedRevision', async () => {
      const catalog = await AssistantCatalog.open(ctx, { lockPath })

      const created = await catalog.createProfile({
        name: 'Initial Name',
        responsibility: 'Initial Responsibility',
      })
      expect(created.revision).toBe(1)

      const updated = await catalog.updateProfile(
        created.id,
        { name: 'Updated Name', responsibility: 'Updated Responsibility' },
        1, // expected revision matches
      )

      expect(updated.revision).toBe(2)
      expect(updated.name).toBe('Updated Name')
      expect(updated.responsibility).toBe('Updated Responsibility')
      expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)

      await catalog.close()
    })

    it('refuses update when expectedRevision does not match current revision', async () => {
      const catalog = await AssistantCatalog.open(ctx, { lockPath })

      const created = await catalog.createProfile({
        name: 'Initial Name',
        responsibility: 'Initial Duty',
      })
      expect(created.revision).toBe(1)

      await expect(catalog.updateProfile(
        created.id,
        { name: 'Conflicting Name' },
        2, // expected 2, but actual is 1
      )).rejects.toThrow(RevisionConflictError)

      await catalog.close()
    })

    it('archives and unarchives profile with revision guards', async () => {
      const catalog = await AssistantCatalog.open(ctx, { lockPath })

      const created = await catalog.createProfile({
        name: 'Archivable',
        responsibility: 'To be archived',
      })
      expect(created.revision).toBe(1)
      expect(created.archivedAt).toBeUndefined()

      // listProfiles without includeArchived
      expect(catalog.listProfiles().length).toBe(1)

      // archive with mismatching revision throws
      await expect(catalog.archiveProfile(created.id, 99)).rejects.toThrow(RevisionConflictError)

      // archive with matching revision succeeds
      const archived = await catalog.archiveProfile(created.id, 1)
      expect(archived.revision).toBe(2)
      expect(archived.archivedAt).toBeDefined()

      // Now hidden from normal list, visible with includeArchived: true
      expect(catalog.listProfiles().length).toBe(0)
      expect(catalog.listProfiles(true).length).toBe(1)

      // unarchive with matching revision succeeds
      const unarchived = await catalog.unarchiveProfile(created.id, 2)
      expect(unarchived.revision).toBe(3)
      expect(unarchived.archivedAt).toBeUndefined()
      expect(catalog.listProfiles().length).toBe(1)

      await catalog.close()
    })
  })

  describe('Provisioning Ledger and Operations', () => {
    it('commits operation before allocation and records checkpoints', async () => {
      const catalog = await AssistantCatalog.open(ctx, { lockPath })
      const opId = ProvisioningOperationId('op-test-1')
      const payload = { assistantName: 'Lead Architect', team: 'Core' }

      const stagesReached: string[] = []

      const result = await catalog.executeProvisioning({
        id: opId,
        payload,
        run: async (context) => {
          stagesReached.push('started')
          expect(context.checkpoint).toBe('committed')
          expect(context.resumed).toBe(false)

          // Allocation 1: profile
          await context.setCheckpoint('profile_allocated', { profileId: 'prof-123' })
          stagesReached.push('profile_checkpointed')

          // Allocation 2: conversation
          await context.setCheckpoint('conversation_allocated', { conversationId: 'conv-456' })
          stagesReached.push('conversation_checkpointed')

          return {
            profileId: 'prof-123',
            conversationId: 'conv-456',
            ready: 'true',
          }
        },
      })

      expect(result.status).toBe('completed')
      expect(result.allocations).toEqual({
        profileId: 'prof-123',
        conversationId: 'conv-456',
        ready: 'true',
      })
      expect(result.resumed).toBe(false)
      expect(stagesReached).toEqual(['started', 'profile_checkpointed', 'conversation_checkpointed'])

      // Operation record in catalog is completed
      const op = catalog.getOperation(opId)
      expect(op?.status).toBe('completed')
      expect(op?.checkpoint).toBe('completed')
      expect(op?.allocations.profileId).toBe('prof-123')

      await catalog.close()
    })

    it('idempotently replays completed operation without calling runner again', async () => {
      const catalog = await AssistantCatalog.open(ctx, { lockPath })
      const opId = ProvisioningOperationId('op-idempotent-1')
      const payload = { name: 'Worker' }

      let runs = 0
      const runner = async () => {
        runs += 1
        return { workerId: 'w-1' }
      }

      const res1 = await catalog.executeProvisioning({ id: opId, payload, run: runner })
      expect(res1.status).toBe('completed')
      expect(runs).toBe(1)
      expect(res1.resumed).toBe(false)

      // Second invocation: runner must not be called
      const res2 = await catalog.executeProvisioning({ id: opId, payload, run: runner })
      expect(res2.status).toBe('completed')
      expect(res2.allocations).toEqual({ workerId: 'w-1' })
      expect(res2.resumed).toBe(true)
      expect(runs).toBe(1)

      await catalog.close()
    })

    it('rejects reusing an operation ID with a conflicting payload fingerprint', async () => {
      const catalog = await AssistantCatalog.open(ctx, { lockPath })
      const opId = ProvisioningOperationId('op-conflict-1')

      await catalog.executeProvisioning({
        id: opId,
        payload: { param: 'first-payload' },
        run: async () => ({ status: 'done' }),
      })

      // Try with different payload
      await expect(catalog.executeProvisioning({
        id: opId,
        payload: { param: 'different-payload' },
        run: async () => ({ status: 'done' }),
      })).rejects.toThrow(ProvisioningConflictError)

      await catalog.close()
    })

    it('surfaces ambiguous allocations and halts retry until repaired', async () => {
      const catalog = await AssistantCatalog.open(ctx, { lockPath })
      const opId = ProvisioningOperationId('op-ambiguous-1')
      const payload = { target: 'external-cluster' }

      await expect(catalog.executeProvisioning({
        id: opId,
        payload,
        run: async (context) => {
          await context.setCheckpoint('remote_dispatched', { remoteRef: 'ref-99' })
          await context.markAmbiguous('Connection timeout during cluster ACK; remote state unknown')
          return {}
        },
      })).rejects.toThrow(AmbiguousAllocationError)

      // Visible in listAmbiguousOperations
      const ambiguousList = catalog.listAmbiguousOperations()
      expect(ambiguousList.length).toBe(1)
      expect(ambiguousList[0]?.id).toBe(opId)
      expect(ambiguousList[0]?.status).toBe('ambiguous')

      // Subsequent attempt rejects with AmbiguousAllocationError immediately
      await expect(catalog.executeProvisioning({
        id: opId,
        payload,
        run: async () => ({}),
      })).rejects.toThrow(AmbiguousAllocationError)

      // Repair by marking retryable
      await catalog.repairAmbiguousOperation(opId, 'retry', { verifiedRef: 'ref-99' })
      expect(catalog.listAmbiguousOperations().length).toBe(0)

      // Now resume succeeds
      const resumedResult = await catalog.executeProvisioning({
        id: opId,
        payload,
        run: async (context) => {
          expect(context.resumed).toBe(true)
          expect(context.allocations.verifiedRef).toBe('ref-99')
          return { completedRef: 'ref-99' }
        },
      })
      expect(resumedResult.status).toBe('completed')

      await catalog.close()
    })

    it('covers crash injection between every write stage and successfully resumes', async () => {
      const opId = ProvisioningOperationId('op-crash-1')
      const payload = { task: 'multi-stage-setup' }

      // 1. Crash after initial commit (before any allocation steps)
      {
        const catalog = await AssistantCatalog.open(ctx, { lockPath })
        let crashInjected = false
        try {
          await catalog.executeProvisioning({
            id: opId,
            payload,
            crashHook: (stage) => {
              if (stage === 'after-initial-commit') {
                crashInjected = true
                throw new Error('SIMULATED_CRASH_AFTER_INITIAL_COMMIT')
              }
            },
            run: async () => ({ stage: 'should-not-reach' }),
          })
        } catch (err: unknown) {
          expect((err as Error).message).toBe('SIMULATED_CRASH_AFTER_INITIAL_COMMIT')
        }
        expect(crashInjected).toBe(true)

        // Durable operation exists in 'pending' status
        const op = catalog.getOperation(opId)
        expect(op?.status).toBe('pending')
        expect(op?.checkpoint).toBe('committed')
        await catalog.close()
      }

      // 2. Resume and crash after first checkpoint
      {
        const catalog = await AssistantCatalog.open(ctx, { lockPath })
        let crashInjected = false
        try {
          await catalog.executeProvisioning({
            id: opId,
            payload,
            crashHook: (stage) => {
              if (stage === 'after-checkpoint:step1') {
                crashInjected = true
                throw new Error('SIMULATED_CRASH_AFTER_STEP1')
              }
            },
            run: async (context) => {
              expect(context.resumed).toBe(true)
              await context.setCheckpoint('step1', { step1Output: 'val1' })
              return { stage: 'should-not-reach' }
            },
          })
        } catch (err: unknown) {
          expect((err as Error).message).toBe('SIMULATED_CRASH_AFTER_STEP1')
        }
        expect(crashInjected).toBe(true)

        const op = catalog.getOperation(opId)
        expect(op?.status).toBe('checkpointed')
        expect(op?.checkpoint).toBe('step1')
        expect(op?.allocations.step1Output).toBe('val1')
        await catalog.close()
      }

      // 3. Resume from step1 and crash after step2
      {
        const catalog = await AssistantCatalog.open(ctx, { lockPath })
        let crashInjected = false
        try {
          await catalog.executeProvisioning({
            id: opId,
            payload,
            crashHook: (stage) => {
              if (stage === 'after-checkpoint:step2') {
                crashInjected = true
                throw new Error('SIMULATED_CRASH_AFTER_STEP2')
              }
            },
            run: async (context) => {
              expect(context.resumed).toBe(true)
              expect(context.checkpoint).toBe('step1')
              expect(context.allocations.step1Output).toBe('val1')

              // Step 1 is skipped because step1Output is already allocated!
              await context.setCheckpoint('step2', { step2Output: 'val2' })
              return { stage: 'should-not-reach' }
            },
          })
        } catch (err: unknown) {
          expect((err as Error).message).toBe('SIMULATED_CRASH_AFTER_STEP2')
        }
        expect(crashInjected).toBe(true)

        const op = catalog.getOperation(opId)
        expect(op?.checkpoint).toBe('step2')
        expect(op?.allocations.step1Output).toBe('val1')
        expect(op?.allocations.step2Output).toBe('val2')
        await catalog.close()
      }

      // 4. Final resume to completion
      {
        const catalog = await AssistantCatalog.open(ctx, { lockPath })
        const result = await catalog.executeProvisioning({
          id: opId,
          payload,
          run: async (context) => {
            expect(context.resumed).toBe(true)
            expect(context.checkpoint).toBe('step2')
            expect(context.allocations.step1Output).toBe('val1')
            expect(context.allocations.step2Output).toBe('val2')

            return {
              step1Output: context.allocations.step1Output ?? '',
              step2Output: context.allocations.step2Output ?? '',
              finalStatus: 'all-done',
            }
          },
        })

        expect(result.status).toBe('completed')
        expect(result.allocations).toEqual({
          step1Output: 'val1',
          step2Output: 'val2',
          finalStatus: 'all-done',
        })

        const op = catalog.getOperation(opId)
        expect(op?.status).toBe('completed')
        expect(op?.checkpoint).toBe('completed')
        await catalog.close()
      }
    })

    it('recovers all state across cold restart of catalog over existing file', async () => {
      const profileId = AssistantProfileId('prof-cold-1')
      const opId = ProvisioningOperationId('op-cold-1')

      // First run: write profile and completed op
      {
        const catalog = await AssistantCatalog.open(ctx, { lockPath })
        await catalog.createProfile({
          id: profileId,
          name: 'Cold Profile',
          responsibility: 'Survives restart',
        })
        await catalog.executeProvisioning({
          id: opId,
          payload: { seed: 42 },
          run: async () => ({ res: 'ok' }),
        })
        await catalog.close()
      }

      // Cold restart: create new context, reopen catalog from same storageDir
      const freshCtx = new Context()
      await freshCtx.plugin(Storage)
      await freshCtx.plugin(StorageJson, { root: storageDir })
      await freshCtx.plugin(StorageDomain, { backend: 'json' })

      const freshCatalog = await AssistantCatalog.open(freshCtx, { lockPath })
      const loadedProfile = freshCatalog.requireProfile(profileId)
      expect(loadedProfile.name).toBe('Cold Profile')
      expect(loadedProfile.revision).toBe(1)

      const loadedOp = freshCatalog.getOperation(opId)
      expect(loadedOp?.status).toBe('completed')
      expect(loadedOp?.allocations.res).toBe('ok')

      await freshCatalog.close()
    })
  })
})
