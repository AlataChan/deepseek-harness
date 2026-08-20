/** Local VS Code Electron integration-test launcher. */

import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron'

const appRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const repoRoot = join(appRoot, '..', '..')
const TEST_PUBLISHER = 'harness-client-tests'
const TEST_EXTENSION_ID = `${TEST_PUBLISHER}.harness-client`

async function stageExtension(target: string): Promise<void> {
  const manifest = JSON.parse(
    await readFile(join(appRoot, 'manifest.vscode.json'), 'utf8'),
  ) as Record<string, unknown>
  if (manifest.publisher !== '__PUBLISHER_ID__') {
    throw new Error('integration staging expects the unpublished publisher placeholder')
  }
  await mkdir(target, { recursive: true })
  await writeFile(
    join(target, 'package.json'),
    `${JSON.stringify({ ...manifest, publisher: TEST_PUBLISHER }, null, 2)}\n`,
  )
  await Promise.all([
    cp(join(appRoot, 'dist'), join(target, 'dist'), { recursive: true }),
    cp(join(appRoot, 'media'), join(target, 'media'), { recursive: true }),
    cp(join(appRoot, 'l10n'), join(target, 'l10n'), { recursive: true }),
    cp(join(appRoot, 'package.nls.json'), join(target, 'package.nls.json')),
    cp(join(appRoot, 'package.nls.zh-cn.json'), join(target, 'package.nls.zh-cn.json')),
  ])
}

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
    await stageExtension(extensionRoot)
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
        DSH_VSCODE_TEST_RUNTIME: join(repoRoot, 'apps', 'cli'),
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
