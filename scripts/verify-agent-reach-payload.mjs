/** Verify the lightweight Agent-Reach payload in either desktop artifact layout. */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Reject missing manifests, source-only entries and eagerly bundled runtimes.
 * @param {string} directory - Installed plugin directory.
 * @returns {{bytes: number, files: number}} Inspected payload size.
 */
export function verifyReachPayload(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-experimental-agent-reach'
    || manifest.dsh?.client?.platform !== 'web' || !manifest.dsh?.bundle?.patch) throw new Error('Invalid Agent-Reach bundle')
  for (const file of ['lib/index.js', 'lib/client.js', 'dependency-lock.json', 'runtime-contract.json']) {
    if (!existsSync(join(directory, file))) throw new Error(`Agent-Reach payload missing ${file}`)
  }
  if (['preinstall', 'install', 'postinstall'].some(key => manifest.scripts?.[key])) throw new Error('Eager installation lifecycle is forbidden')
  const lock = JSON.parse(readFileSync(join(directory, 'dependency-lock.json'), 'utf8'))
  if (lock.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(lock.source?.sha256)
    || !/^[a-f0-9]{64}$/.test(lock.source?.wheelSha256)) throw new Error('Invalid frozen source digests')
  let bytes = 0
  let files = 0
  const inspect = (dir) => {
    for (const entry of readdirSync(dir)) {
      const target = join(dir, entry)
      const stat = lstatSync(target)
      if (stat.isSymbolicLink()) throw new Error('Agent-Reach payload must not contain links')
      if (stat.isDirectory()) { inspect(target); continue }
      if (/\.(?:whl|exe|dll|so|dylib|py|mp4|mp3|zip|bin|gz|tgz|tar|xz|node)$/i.test(entry)) throw new Error(`Eager runtime payload: ${entry}`)
      bytes += stat.size
      files++
    }
  }
  inspect(directory)
  if (bytes > 1024 * 1024) throw new Error('Agent-Reach payload exceeds its lightweight budget')
  return { bytes, files }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2]
  if (!directory) throw new Error('usage: verify-agent-reach-payload.mjs <plugin-dir>')
  console.log(JSON.stringify(verifyReachPayload(directory)))
}
