/** Local VS Code Electron integration-test launcher. */

import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron'
import { stageExtension } from '../../scripts/stage-extension.ts'

const appRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const repoRoot = join(appRoot, '..', '..')
const TEST_PUBLISHER = 'harness-client-tests'
const TEST_EXTENSION_ID = `${TEST_PUBLISHER}.harness-client`

function resolvedExecutable(reported: string): string {
  if (existsSync(reported)) return reported
  if (process.platform === 'darwin' && basename(reported) === 'Electron') {
    const renamed = join(dirname(reported), 'Code')
    if (existsSync(renamed)) return renamed
  }
  return reported
}

/** Stage the extension and run its suite in an isolated VS Code installation profile. */
async function main(): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-vsc-'))
  const extensionRoot = join(temporaryRoot, 'extension')
  const workspaceRoot = join(temporaryRoot, 'workspace')
  const dshHome = join(temporaryRoot, 'dsh-home')
  const agentsHome = join(temporaryRoot, 'agents')
  try {
    await stageExtension(extensionRoot, { publisher: TEST_PUBLISHER })
    await cp(join(appRoot, 'src', 'test', 'fixtures', 'workspace'), workspaceRoot, { recursive: true })
    await mkdir(dshHome, { recursive: true })
    await cp(
      join(appRoot, 'src', 'test', 'fixtures', 'cordis.patch.yml'),
      join(dshHome, 'cordis.patch.yml'),
    )
    const requestedVersion = process.env.DSH_VSCODE_TEST_VERSION ?? 'stable'
    const configuredExecutable = process.env.DSH_VSCODE_TEST_EXECUTABLE
    const downloadedExecutable = configuredExecutable === undefined || configuredExecutable === ''
      ? await downloadAndUnzipVSCode({ version: requestedVersion, extensionDevelopmentPath: extensionRoot })
      : configuredExecutable
    const executable = resolvedExecutable(downloadedExecutable)
    const configuredRuntime = process.env.DSH_VSCODE_TEST_RUNTIME
    const runtimeClue = configuredRuntime === undefined || configuredRuntime === ''
      ? process.platform === 'win32'
        ? join(appRoot, 'node_modules', '.bin', 'dsh.cmd')
        : join(repoRoot, 'apps', 'cli')
      : configuredRuntime
    const exitCode = await runTests({
      extensionDevelopmentPath: extensionRoot,
      extensionTestsPath: join(appRoot, 'lib', 'types', 'src', 'test', 'suite', 'index.js'),
      vscodeExecutablePath: executable,
      launchArgs: [
        workspaceRoot,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        `--user-data-dir=${join(temporaryRoot, 'u')}`,
        `--extensions-dir=${join(temporaryRoot, 'e')}`,
      ],
      extensionTestsEnv: {
        DSH_VSCODE_TEST_EXTENSION_ID: TEST_EXTENSION_ID,
        DSH_VSCODE_TEST_RUNTIME: runtimeClue,
        DSH_VSCODE_TEST_NODE: process.execPath,
        DSH_VSCODE_TEST_HOME: dshHome,
        DSH_HOME: dshHome,
        DSH_AGENTS_HOME: agentsHome,
        DSH_PERMISSION_MODE: 'danger-full-access',
        DSH_TELEMETRY_DISABLED: '1',
      },
    })
    if (exitCode !== 0) throw new Error(`VS Code integration runner exited with code ${String(exitCode)}`)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

await main()
