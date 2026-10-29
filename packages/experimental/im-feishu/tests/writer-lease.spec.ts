import { spawn } from 'node:child_process'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { once } from 'node:events'
import { chmod, lstat, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ImWriterLease } from '../src/writer-lease.ts'

const fixture = fileURLToPath(new URL('./fixtures/writer-holder.ts', import.meta.url))
const tsconfig = fileURLToPath(new URL('../../../../tsconfig.base.json', import.meta.url))

describe.skipIf(process.platform === 'win32')('IM state writer kernel lease', () => {
  it('excludes another process and recovers immediately after holder death without unlinking', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'im-writer-')))
    const holder = spawn(process.execPath, ['--import', 'tsx/esm', fixture, directory], {
      env: { ...scrubbedParentEnv(), TSX_TSCONFIG_PATH: tsconfig }, stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    holder.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
    const exited = once(holder, 'exit')
    try {
      await Promise.race([
        once(holder.stdout, 'data', { signal: AbortSignal.timeout(5000) }),
        exited.then(() => { throw new Error(`Holder exited before acquiring lease: ${stderr}`) }),
      ])
      await expect(ImWriterLease.acquire(directory)).rejects.toThrow()
      const before = await lstat(join(directory, 'writer.lock'))
      holder.kill('SIGKILL')
      await exited
      const lease = await ImWriterLease.acquire(directory)
      try { expect((await lstat(join(directory, 'writer.lock'))).ino).toBe(before.ino) } finally { await lease.release() }
      expect((await lstat(join(directory, 'writer.lock'))).isFile()).toBe(true)
    } finally {
      if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGKILL')
      await exited
      await rm(directory, { recursive: true, force: true })
    }
  }, 15_000)

  it('refuses symlinked or shared state directories', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'im-writer-mode-')))
    const link = directory + '-link'
    try {
      await chmod(directory, 0o750)
      await expect(ImWriterLease.acquire(directory)).rejects.toThrow('private')
      await chmod(directory, 0o700)
      await symlink(directory, link)
      await expect(ImWriterLease.acquire(link)).rejects.toThrow('private')
      const lease = await ImWriterLease.acquire(directory)
      await lease.release()
      await lease.release()
    } finally {
      await rm(link, { force: true })
      await rm(directory, { recursive: true, force: true })
    }
  })
})
