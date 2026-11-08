import { runtimePlatformQualified } from './runtime-lock.ts'
/** Frozen artifact acquisition and reproducible, plugin-owned runtime installation. */
import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { Context } from '@deepseek-ai/cordis'
import lock from '../dependency-lock.json' with { type: 'json' }
import { OwnedCommands, reachEnvironment } from './execution.ts'
import { RUNTIME_CONTRACT } from './catalog.ts'
import { writeInstallationRecordAtomic, type InstallationRecord } from './installation-record.ts'
import type { SetupPlan } from './setup-plan.ts'

interface Wheel { name:string;version:string;filename:string;url:string;sha256:string;license:string }
interface PlatformLock {
  uv:{ url:string;sha256:string;filename:string;executable:string }
  python:{ key:string;metadata:Record<string,JsonValue> }
  wheels:{ core:Wheel[];build:Wheel[];bili:Wheel[] }
}

/**
 * Select a frozen target; missing target support never downloads a floating recipe.
 * @returns Qualified artifact recipe, if present.
 */
export function installationTarget(): PlatformLock | undefined {
  if (!runtimePlatformQualified()) return undefined
  return lock.platforms['darwin-arm64']
}

/**
 * Download one immutable artifact and verify its exact bytes before any execution.
 * @param url - Manifest-owned URL.
 * @param digest - Frozen SHA-256.
 * @param destination - Exclusive private destination.
 * @param signal - Installation cancellation lifetime.
 * @returns After verified bytes have closed on disk.
 */
export async function acquireArtifact(url: string, digest: string, destination: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/octet-stream' } })
  if (!response.ok || !response.body) throw new Error(`Artifact download failed: HTTP ${response.status}`)
  const file = await fs.open(destination, 'wx', 0o600)
  const hash = createHash('sha256')
  let count = 0
  try {
    for await (const chunk of response.body) {
      signal.throwIfAborted()
      count += chunk.length
      if (count > 512 * 1024 * 1024) throw new Error('Artifact exceeds acquisition limit')
      hash.update(chunk)
      await file.writeFile(chunk)
    }
    if (hash.digest('hex') !== digest) throw new Error('Artifact SHA-256 mismatch')
    await file.sync()
  } finally {
    await file.close()
  }
}

/** Installer lifetime shared with the plugin fiber. */
export class ReachInstaller {
  private readonly commands: OwnedCommands
  private readonly abort = new AbortController()
  private readonly active = new Set<Promise<InstallationRecord>>()

  constructor(ctx: Context) {
    this.commands = new OwnedCommands(ctx)
    ctx.effect(() => async () => {
      this.abort.abort(new Error('Agent-Reach unloaded'))
      await Promise.allSettled([...this.active])
    }, 'agent-reach: downloads')
  }

  /**
   * Install a frozen plan and atomically promote its owner record; old generations remain usable.
   * @param plan - Already approved plan.
   * @param timeoutMs - Full installation deadline.
   * @param callerSignal - Calling tool cancellation.
   * @returns The verified promoted record.
   */
  async install(plan: SetupPlan, timeoutMs: number, callerSignal?: AbortSignal): Promise<InstallationRecord> {
    const work = this.installGeneration(plan, timeoutMs, callerSignal)
    this.active.add(work)
    try { return await work } finally { this.active.delete(work) }
  }

  private async installGeneration(plan: SetupPlan, timeoutMs: number, callerSignal?: AbortSignal): Promise<InstallationRecord> {
    const target = installationTarget()
    if (!target) throw new Error('This platform has no qualified artifact recipe')
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(timeoutMs), ...(callerSignal ? [callerSignal] : [])])
    signal.throwIfAborted()
    await fs.mkdir(plan.releaseRoot, { recursive: true, mode: 0o700 })
    const mutex = path.join(plan.releaseRoot, '.setup.lock')
    await fs.mkdir(mutex, { mode: 0o700 })
    const generation = path.join(plan.releaseRoot, 'generations', randomUUID())
    let promoted = false
    try {
      await fs.mkdir(generation, { recursive: true, mode: 0o700 })
      const downloads = path.join(generation, 'downloads')
      await fs.mkdir(downloads, { mode: 0o700 })
      const env = reachEnvironment()
      env.UV_NO_CONFIG = '1'
      env.UV_CACHE_DIR = path.join(generation, 'cache')
      env.UV_PYTHON_INSTALL_DIR = path.join(generation, 'python')
      env.UV_PYTHON_BIN_DIR = path.join(generation, 'python-bin')
      env.UV_PYTHON_DOWNLOADS = 'manual'
      env.SOURCE_DATE_EPOCH = lock.source.sourceDateEpoch
      env.PATH = [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter)
      const command = async (argv: string[]): Promise<string> => {
        signal.throwIfAborted()
        const result = await this.commands.run({ argv, cwd: generation, env,
          stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, graceMs: 1000,
        }, { timeoutMs, maxStdoutBytes: 1048576, maxStderrBytes: 32768, signal })
        if (!result.ok) throw new Error(result.error?.message ?? (result.stderr || 'Installation command failed'))
        return result.stdout
      }
      const tar = '/usr/bin/tar'
      const uvArchive = path.join(downloads, target.uv.filename)
      await acquireArtifact(target.uv.url, target.uv.sha256, uvArchive, signal)
      await command([tar, '-xf', uvArchive, '-C', generation])
      const uv = path.join(generation, target.uv.executable)
      if (!(await command([uv, '--version'])).startsWith(`uv ${lock.uvVersion} `)) throw new Error('uv version mismatch')
      const pythonMetadata = path.join(generation, 'python-distribution.json')
      await fs.writeFile(pythonMetadata, JSON.stringify({ [target.python.key]: target.python.metadata }), { mode: 0o600 })
      await command([uv, 'python', 'install', '--no-config', '--no-bin', '--no-registry',
        '--python-downloads-json-url', pathToFileURL(pythonMetadata).href, target.python.key])
      env.UV_PYTHON_DOWNLOADS = 'never'
      const python = (await command([uv, 'python', 'find', '--managed-python', '--no-python-downloads', lock.pythonVersion])).trim()
      const pythonRelative = path.relative(generation, python)
      if (!pythonRelative || pythonRelative.startsWith('..') || path.isAbsolute(pythonRelative)) throw new Error('Python escaped private generation')
      const bin = 'bin'
      const pythonName = 'python'
      const buildVenv = path.join(generation, 'builder')
      const coreVenv = path.join(generation, 'core')
      const toolsVenv = path.join(generation, 'tools')
      const installWheels = async (venv: string, group: Wheel[]): Promise<void> => {
        await command([uv, 'venv', '--no-config', '--no-python-downloads', '--python', python, venv])
        const lines: string[] = []
        for (const wheel of group) {
          const destination = path.join(downloads, wheel.filename)
          try { await fs.access(destination) } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
            await acquireArtifact(wheel.url, wheel.sha256, destination, signal)
          }
          lines.push(`${pathToFileURL(destination).href} --hash=sha256:${wheel.sha256}`)
        }
        const requirements = path.join(venv, 'frozen-requirements.txt')
        await fs.writeFile(requirements, lines.join('\n') + '\n', { mode: 0o600 })
        await command([uv, 'pip', 'install', '--no-config', '--offline', '--no-deps', '--no-build', '--require-hashes',
          '--python', path.join(venv, bin, pythonName), '-r', requirements])
      }
      await installWheels(buildVenv, target.wheels.build)
      const sourceArchive = path.join(downloads, 'source.tar.gz')
      await acquireArtifact(lock.source.url, lock.source.sha256, sourceArchive, signal)
      await command([tar, '-xf', sourceArchive, '-C', generation])
      await command([uv, 'build', '--offline', '--no-config', '--wheel', '--no-build-isolation',
        '--python', path.join(buildVenv, bin, pythonName), '--out-dir', downloads,
        path.join(generation, lock.source.directory)])
      const builtWheel = path.join(downloads, lock.source.wheelFilename)
      if (createHash('sha256').update(await fs.readFile(builtWheel)).digest('hex') !== lock.source.wheelSha256) {
        throw new Error('Reproduced Agent-Reach wheel differs from the qualified wheel')
      }
      await installWheels(coreVenv, [...target.wheels.core, {
        name: 'agent-reach', version: '1.6.1', filename: lock.source.wheelFilename,
        url: '', sha256: lock.source.wheelSha256, license: 'MIT',
      }])
      const needsBili = plan.packages.some(pkg => pkg.toolKey === 'bili-cli')
      if (needsBili) {
        const extraWheels: Wheel[] = []
        for (const source of lock.supplementalSources) {
          const archive = path.join(downloads, `${source.directory}.tar.gz`)
          await acquireArtifact(source.url, source.sha256, archive, signal)
          await command([tar, '-xf', archive, '-C', generation])
          await command([uv, 'build', '--offline', '--no-config', '--wheel', '--no-build-isolation',
            '--python', path.join(buildVenv, bin, pythonName), '--out-dir', downloads, path.join(generation, source.directory)])
          const wheel = path.join(downloads, source.wheelFilename)
          if (createHash('sha256').update(await fs.readFile(wheel)).digest('hex') !== source.wheelSha256) {
            throw new Error('Reproduced supplemental wheel differs from the qualified wheel')
          }
          extraWheels.push({ name:source.name,version:source.version,license:source.license,
            filename:source.wheelFilename,sha256:source.wheelSha256,url:'' })
        }
        await installWheels(toolsVenv, [...target.wheels.bili,...extraWheels])
      }
      const executable = path.join(coreVenv, bin, 'agent-reach')
      const corePython = path.join(coreVenv,bin,pythonName)
      env.PATH = [path.join(toolsVenv,bin),path.join(coreVenv,bin),env.PATH].join(path.delimiter)
      await command([uv,'pip','check','--offline','--python',corePython])
      if (needsBili) await command([uv,'pip','check','--offline','--python',path.join(toolsVenv,bin,pythonName)])
      const names = ['yt-dlp',...(needsBili ? ['bili'] : [])]
      const resolved: unknown = JSON.parse(await command([corePython,'-c',
        'import json,sys; from agent_reach.runtime.tools import resolve; print(json.dumps({name:resolve(name) for name in sys.argv[1:]}))',...names]))
      if (typeof resolved !== 'object' || resolved === null) throw new Error('Invalid resolver response')
      for (const name of names) {
        const actual: unknown = Reflect.get(resolved,name)
        const expected = path.join(name === 'bili' ? toolsVenv : coreVenv,bin,
          name)
        if (typeof actual !== 'string' || path.resolve(actual) !== path.resolve(expected)) {
          throw new Error('Unqualified upstream tool shadows the installed runtime')
        }
      }
      if (needsBili) {
        await command([path.join(toolsVenv,bin,pythonName),'-c',
          'import brotli; from aiohttp.compression_utils import BrotliDecompressor; assert BrotliDecompressor().decompress_sync(brotli.compress(b"probe"),1024)==b"probe"'])
        await command([path.join(toolsVenv,bin,'bili'),'--help'])
      }
      const version: unknown = JSON.parse(await command([executable, 'version']))
      if (typeof version !== 'object' || version === null || !('result' in version)
        || typeof version.result !== 'object' || version.result === null || !('version' in version.result)
        || version.result.version !== RUNTIME_CONTRACT.upstream.version) throw new Error('Installed Agent-Reach version mismatch')
      const record: InstallationRecord = {
        schemaVersion: 1, manifestDigest:plan.manifestDigest, lockId: plan.lockId,
        upstreamRevision: RUNTIME_CONTRACT.upstream.reviewedRevision,
        installedAt: new Date().toISOString(), releaseRoot: plan.releaseRoot, coreVenvPath: coreVenv,
        ...(needsBili ? { toolVenvPath: toolsVenv } : {}),
        tools: {
          'agent-reach': { version:RUNTIME_CONTRACT.upstream.version,executablePath:executable,installedAt:new Date().toISOString(),
            digest:createHash('sha256').update(await fs.readFile(executable)).digest('hex') },
          ...(needsBili ? { 'bili-cli': {
            version:'0.6.2',executablePath:path.join(toolsVenv,bin,'bili'),
            installedAt:new Date().toISOString(),digest:createHash('sha256').update(await fs.readFile(path.join(toolsVenv,bin,'bili'))).digest('hex'),
          } } : {}),
        },
      }
      signal.throwIfAborted()
      writeInstallationRecordAtomic(path.join(plan.releaseRoot, 'installation-record.json'), record)
      promoted = true
      return record
    } finally {
      try {
        if (!promoted) {
          const info = await fs.lstat(generation).catch((error: unknown) => {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
            throw error
          })
          if (info?.isSymbolicLink()) await fs.unlink(generation)
          else if (info) await fs.rm(generation,{ recursive:true,force:true })
        }
      } finally {
        await fs.rmdir(mutex)
      }
    }
  }
}
