import { z } from 'zod'
import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImConnectionController, type ImControllerOwner } from '../src/controller.ts'
import type { ConnectionConfig } from '../src/schema.ts'

const config: ConnectionConfig = { appId: 'app', tenantId: 'org', chatId: 'private-chat', senderId: 'operator', cwd: '/workspace', provider: 'fixture', model: 'fixture-model' }

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-im-controller-'))
  let secret = ''
  const close = vi.fn(async () => {})
  const start = vi.fn(async () => {})
  const owner: ImControllerOwner = {
    hasSecret: async () => Boolean(secret), setSecret: async (_channel, value) => { secret = value },
    validate: async value => value, create: vi.fn(async () => ({ start, close, isConnected: () => true, hasDeliveryFailure: () => false })),
  }
  const controller = new ImConnectionController('feishu', directory, owner)
  return { directory, owner, start, close, controller, async dispose() {
    await controller.close(); await rm(directory, { recursive: true, force: true })
  } }
}

describe('desktop IM connection settings', () => {
  it('starts OFF and saves a credential without serializing or returning it', async () => {
    const f = await fixture()
    try {
      await f.controller.load()
      expect((await f.controller.snapshot()).enabled).toBe(false)
      const saved = await f.controller.save(config, 'private-secret')
      expect(saved.secretConfigured).toBe(true)
      expect(JSON.stringify(saved)).not.toContain('private-secret')
      expect(await readFile(join(f.directory, 'feishu.json'), 'utf8')).not.toContain('private-secret')
      expect(f.owner.create).not.toHaveBeenCalled()
    } finally { await f.dispose() }
  })
  it('connection testing closes its probe and never enables the saved channel', async () => {
    const f = await fixture()
    try {
      await f.controller.save(config, 'secret')
      expect((await f.controller.test()).phase).toBe('off')
      expect(f.owner.create).toHaveBeenCalledWith('feishu', config, expect.any(Function), true)
      expect(f.close).toHaveBeenCalledTimes(1)
      expect((await f.controller.snapshot()).enabled).toBe(false)
    } finally { await f.dispose() }
  })
  it('persists ON only after successful start and restores it on load', async () => {
    const f = await fixture()
    let second: ImConnectionController | undefined
    try {
      await f.controller.save(config, 'secret')
      expect((await f.controller.setEnabled(true)).phase).toBe('connected')
      await f.controller.close()
      second = new ImConnectionController('feishu', f.directory, f.owner)
      await second.load()
      expect((await second.snapshot()).enabled).toBe(true)
      expect(f.start).toHaveBeenCalledTimes(2)
    } finally { await second?.close(); await f.dispose() }
  })
  it('closes failed startup and redacts SDK diagnostics containing secrets', async () => {
    const f = await fixture()
    try {
      await f.controller.save(config, 'secret')
      f.start.mockRejectedValueOnce(new Error('Authorization: secret'))
      await expect(f.controller.setEnabled(true)).rejects.toThrow('IM connection failed')
      expect(f.close).toHaveBeenCalledTimes(1)
      expect((await f.controller.snapshot()).phase).toBe('error')
      expect(JSON.stringify(await f.controller.snapshot())).not.toContain('Authorization')
      expect(z.object({ enabled: z.boolean() }).parse(JSON.parse(await readFile(join(f.directory, 'feishu.json'), 'utf8'))).enabled).toBe(false)
    } finally { await f.dispose() }
  })
  it('turns OFF durably before a failed shutdown, preventing auto-start after restart', async () => {
    const f = await fixture()
    try {
      await f.controller.save(config, 'secret'); await f.controller.setEnabled(true)
      f.close.mockRejectedValueOnce(new Error('cannot drain'))
      await expect(f.controller.setEnabled(false)).rejects.toThrow('IM shutdown failed')
      expect(z.object({ enabled: z.boolean() }).parse(JSON.parse(await readFile(join(f.directory, 'feishu.json'), 'utf8'))).enabled).toBe(false)
    } finally { await f.dispose() }
  })
  it('saving a new operator stops the old runtime and requires an explicit new enable', async () => {
    const f = await fixture()
    try {
      await f.controller.save(config, 'secret'); await f.controller.setEnabled(true)
      const saved = await f.controller.save({ ...config, senderId: 'new-user' }, '')
      expect(f.close).toHaveBeenCalledTimes(1)
      expect(saved.enabled).toBe(false)
      expect(saved.config?.senderId).toBe('new-user')
      expect(saved.secretConfigured).toBe(true)
    } finally { await f.dispose() }
  })
  it('serializes an enable followed by disable and rejects work after disposal', async () => {
    const f = await fixture()
    try {
      await f.controller.save(config, 'secret')
      await Promise.all([f.controller.setEnabled(true), f.controller.setEnabled(false)])
      expect((await f.controller.snapshot()).phase).toBe('off')
      await f.controller.close()
      await expect(f.controller.setEnabled(true)).rejects.toThrow('closed')
    } finally { await f.dispose() }
  })
  it('rejects corrupted persisted settings instead of replacing them with defaults', async () => {
    const f = await fixture()
    try {
      await writeFile(join(f.directory, 'feishu.json'), '{"schemaVersion":99}')
      await expect(f.controller.load()).rejects.toThrow()
    } finally { await f.dispose() }
  })
  it('disposal during runtime creation closes the candidate without opening its transport', async () => {
    const f = await fixture()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    f.owner.create = async () => {
      entered.resolve(undefined)
      await release.promise
      return { start: f.start, close: f.close, isConnected: () => true, hasDeliveryFailure: () => false }
    }
    try {
      await f.controller.save(config, 'secret')
      const activation = f.controller.setEnabled(true).catch((error: unknown) => error)
      await entered.promise
      const closing = f.controller.close()
      release.resolve(undefined)
      expect(await activation).toBeInstanceOf(Error)
      await closing
      expect(f.start).not.toHaveBeenCalled()
      expect(f.close).toHaveBeenCalledTimes(1)
    } finally { await f.dispose() }
  })
  it('reports SDK disconnection and retained delivery failures instead of stale connected status', async () => {
    const f = await fixture()
    let connected = true
    let failed = false
    f.owner.create = async () => ({ start: f.start, close: f.close,
      isConnected: () => connected, hasDeliveryFailure: () => failed })
    try {
      await f.controller.save(config, 'secret'); await f.controller.setEnabled(true)
      connected = false
      expect((await f.controller.snapshot()).phase).toBe('connecting')
      failed = true
      expect(await f.controller.snapshot()).toMatchObject({ phase: 'error', error: 'delivery', enabled: true })
    } finally { await f.dispose() }
  })

  it('stops live admission even when the OFF choice cannot be written', async () => {
    const f = await fixture()
    try {
      await f.controller.save(config, 'secret'); await f.controller.setEnabled(true)
      await rm(join(f.directory, 'feishu.json')); await mkdir(join(f.directory, 'feishu.json'))
      await expect(f.controller.setEnabled(false)).rejects.toThrow('disabled choice')
      expect(f.close).toHaveBeenCalledTimes(1)
      expect(await f.controller.snapshot()).toMatchObject({ enabled: false, phase: 'error', error: 'storage' })
    } finally { await f.dispose() }
  })
  it('does not publish settings whose replacement could not be persisted', async () => {
    const f = await fixture()
    try {
      await f.controller.save(config, 'secret')
      const validate = f.owner.validate
      f.owner.setSecret = async () => {
        await rm(join(f.directory, 'feishu.json')); await mkdir(join(f.directory, 'feishu.json'))
      }
      await expect(f.controller.save(await validate({ ...config, senderId: 'replacement' }), 'new-secret')).rejects.toThrow('could not be saved')
      expect((await f.controller.snapshot()).config?.senderId).toBe(config.senderId)
    } finally { await f.dispose() }
  })
  it('closes a newly connected channel when saving its enabled choice fails', async () => {
    const f = await fixture()
    try {
      await f.controller.save(config, 'secret')
      f.start.mockImplementationOnce(async () => {
        await rm(join(f.directory, 'feishu.json')); await mkdir(join(f.directory, 'feishu.json'))
      })
      await expect(f.controller.setEnabled(true)).rejects.toThrow('enabled choice')
      expect(f.close).toHaveBeenCalledTimes(1)
      expect(await f.controller.snapshot()).toMatchObject({ enabled: false, phase: 'error', error: 'storage' })
    } finally { await f.dispose() }
  })

})
