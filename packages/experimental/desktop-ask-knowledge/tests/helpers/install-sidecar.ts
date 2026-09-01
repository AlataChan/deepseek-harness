/**
 * Install a sidecar executable under a temp runtime home.
 * @module
 */

import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sidecarScriptPath } from '../../src/sidecar.ts'

const FAKE = fileURLToPath(new URL('./fake-sidecar.mjs', import.meta.url))

/**
 * Overlay fake-sidecar environment for one runtime home without touching
 * `process.env`. Parallel tests must not share ASK_KNOWLEDGE_FAKE_* keys.
 * @param home - sidecar runtime directory.
 * @param env - fake-sidecar keys for this home only.
 */
export async function writeFakeSidecarEnv(
  home: string,
  env: Readonly<Record<string, string>>,
): Promise<void> {
  await mkdir(home, { recursive: true })
  await writeFile(join(home, 'fake.env.json'), `${JSON.stringify(env)}\n`, 'utf8')
}

/**
 * Install the Node fake sidecar as `$home/octopus-kb-sidecar`.
 * @param home - sidecar runtime directory.
 */
export async function installFakeSidecar(home: string): Promise<void> {
  await mkdir(home, { recursive: true })
  const envFile = join(home, 'fake.env.json')
  await writeFile(envFile, '{}\n', 'utf8')
  const dest = join(home, 'octopus-kb-sidecar')
  const wrapper = `#!/bin/sh
export ASK_KNOWLEDGE_FAKE_ENV_FILE="${envFile}"
exec node "${FAKE}" "$@"
`
  await writeFile(dest, wrapper, { mode: 0o755 })
  await chmod(dest, 0o755)
}

/**
 * Install a wrapper that execs the vendored Python sidecar.py.
 * @param home - sidecar runtime directory.
 */
export async function installPythonSidecar(home: string): Promise<void> {
  await mkdir(home, { recursive: true })
  const python = process.env.ASK_KNOWLEDGE_PYTHON ?? 'python3'
  const dest = join(home, 'octopus-kb-sidecar')
  await writeFile(dest, `#!/bin/sh
exec "${python}" "${sidecarScriptPath}" "$@"
`, { mode: 0o755 })
  await chmod(dest, 0o755)
}

/** @internal keep copyFile imported for tests that want a raw node script */
export async function copyFakeSidecarNode(home: string): Promise<string> {
  await mkdir(home, { recursive: true })
  const dest = join(home, 'octopus-kb-sidecar')
  await copyFile(FAKE, dest)
  await chmod(dest, 0o755)
  return dest
}
