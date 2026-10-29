/** Build qualification-only native binaries inside the same Linux image used by the tenant gate. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

const execute = promisify(execFile)
const context = z.string().min(1).parse(process.argv[2])
const image = z.string().min(1).parse(process.argv[3])
const artifact = z.string().min(1).parse(process.argv[4])
const repo = fileURLToPath(new URL('../../../../../', import.meta.url))
const source = join(repo, 'native/system/packages/entry/src')
const name = `dsh-expansion-native-${randomUUID().slice(0, 8)}`
let container: string | undefined
let failure: unknown

async function docker(args: readonly string[]): Promise<string> {
  return (await execute('docker', ['--context', context, ...args], {
    env: scrubbedParentEnv(), timeout: 60000, maxBuffer: 1024 * 1024,
  })).stdout.trim()
}
try {
  const endpoints: unknown = JSON.parse(await docker(['context', 'inspect', context, '--format', '{{json .Endpoints}}']))
  const host = z.object({ docker: z.object({ Host: z.string() }) }).parse(endpoints).docker.Host
  if (!host.startsWith('unix://')) throw new Error('Native qualification requires a local Docker endpoint')
  await readFile(join(artifact, 'node_modules/@deepseek-ai/dsh/package.json'))
  const id = await docker(['run', '-d', '--name', name, '--label', 'dsh.expansion.run=run_defe54996fc5',
    '--network', 'none', image, 'sleep', '300'])
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Docker did not return an owned container ID')
  container = id
  const arch = z.enum(['arm64', 'x64']).parse(await docker(['exec', id, 'node', '-p', 'process.arch']))
  const packageDir = join(artifact, `node_modules/@deepseek-ai/node-addon-system-linux-${arch}`)
  await readFile(join(packageDir, 'package.json'))
  await mkdir(join(packageDir, 'bin/glibc'), { recursive: true })
  await docker(['exec', id, 'mkdir', '-p', '/opt/native-source'])
  await docker(['cp', join(source, 'flock.c'), `${id}:/opt/native-source/flock.c`])
  await docker(['cp', join(source, 'main.c'), `${id}:/opt/native-source/main.c`])
  await docker(['exec', id, 'cc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-fPIC', '-fvisibility=hidden',
    '-DNAPI_VERSION=8', '-I', '/usr/local/include/node', '-shared', '-o', '/opt/native-source/system.node', '/opt/native-source/flock.c'])
  await docker(['exec', id, 'musl-gcc', '-std=c11', '-Os', '-Wall', '-Wextra', '-Werror', '-static', '-s',
    '-o', '/opt/native-source/landlock-run', '/opt/native-source/main.c'])
  await docker(['exec', id, 'node', '-e', "require('/opt/native-source/system.node')"])
  const probe = await docker(['exec', id, '/opt/native-source/landlock-run', '--probe'])
  if (!probe.includes('fully enforced')) throw new Error(`Target Landlock probe failed: ${probe}`)
  await docker(['cp', `${id}:/opt/native-source/system.node`, join(packageDir, 'bin/glibc/system.node')])
  await docker(['cp', `${id}:/opt/native-source/landlock-run`, join(packageDir, 'bin/landlock-run')])
  const hashes = await Promise.all(['bin/glibc/system.node', 'bin/landlock-run'].map(async file => ({
    file, sha256: createHash('sha256').update(await readFile(join(packageDir, file))).digest('hex'),
  })))
  await writeFile(join(artifact, 'qualification-native.json'), JSON.stringify({ image, arch, probe, hashes }) + '\n')
  console.log(JSON.stringify({ result: 'passed', scope: 'Native prerequisites only; actual profile gate is separate', arch, probe, hashes }))
} catch (error) { failure = error }
finally {
  const failures: unknown[] = []
  if (failure) failures.push(failure)
  if (container) {
    try { await docker(['rm', '-f', container]) } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Qualification native preparation failed')
}
