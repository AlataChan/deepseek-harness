#!/usr/bin/env node
/**
 * Freeze octopus-kb into a relocatable PyInstaller onedir.
 *
 * Windows port of `scripts/build-kb-sidecar.sh`, which stays the macOS entry:
 * PyInstaller cannot cross-compile the sidecar, so each packaged platform
 * freezes its own. The output layout is identical on both platforms except the
 * executable suffix:
 *   dist/.cache/kb-runtime/octopus-kb-sidecar/octopus-kb-sidecar[.exe]
 *   dist/.cache/kb-runtime/prompts/
 *   dist/.cache/kb-runtime/schemas/
 *   dist/.cache/kb-runtime/LICENSE
 *   dist/.cache/kb-runtime/SOURCE.txt
 *
 * Do not copy a build-machine venv into the installer; only the frozen onedir
 * ships. This Windows freeze pins pip and PyInstaller; `scripts/build-kb-sidecar.sh`
 * resolves both at build time on macOS.
 *
 * Usage: node scripts/build-kb-sidecar.mjs
 *   ASK_KNOWLEDGE_PYTHON overrides the interpreter (`python` on Windows,
 *   `python3` elsewhere).
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(REPO_ROOT, 'packages', 'experimental', 'desktop-ask-knowledge')
const PYTHON_DIR = join(PKG, 'python')
const KB_DIR = join(PYTHON_DIR, 'kb')
const CACHE = join(REPO_ROOT, 'dist', '.cache', 'kb-sidecar-build')
const OUT = join(REPO_ROOT, 'dist', '.cache', 'kb-runtime')

/** Frozen review app and installer versions; see the header. */
const PIP_VERSION = '26.2.1'
const PYINSTALLER_VERSION = '6.22.3'

/**
 * Sidecar self-test flags the frozen runtime must answer, excluding `ok`.
 *
 * `scripts/verify-desktop-exe.spec.ts` keeps this list in step with the checks
 * `scripts/build-kb-sidecar.sh` and `scripts/verify-desktop-bundle.sh` run.
 */
const SELF_TEST_KEYS = ['pypdf', 'documentPdf', 'sqliteRuntime', 'pdf', 'xlsx', 'proposalSchema', 'applyRules', 'rulesSchema', 'pageMetaFill', 'retrieveFold', 'convertFile']

/** PyInstaller `--add-data` separates source and destination by `;` on Windows. */
const ADD_DATA_SEP = process.platform === 'win32' ? ';' : ':'

/** @param {string} message - one line describing the completed phase. */
function info(message) {
  console.log(`\u001b[1;34m▶ ${message}\u001b[0m`)
}

/** @param {string} message - one line describing the completed phase. */
function ok(message) {
  console.log(`\u001b[1;32m✓ ${message}\u001b[0m`)
}

/**
 * Report a failure and end the build.
 * @param {string} message - what failed and which input to fix.
 * @returns {never}
 */
function fail(message) {
  console.error(`\u001b[1;31m✗ ${message}\u001b[0m`)
  process.exit(1)
}

/**
 * Run one build step with inherited stdio.
 * @param {string} command - executable or shell command.
 * @param {string[]} args - argument list.
 * @param {{ cwd?: string }} [options] - working directory override.
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    stdio: 'inherit',
  })
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

/**
 * Every symlink below `root`, so the copy is proven self-contained.
 * @param {string} root - directory to scan.
 * @param {string[]} [found] - accumulator for symlink paths.
 * @returns symlink paths.
 */
function symlinks(root, found = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) found.push(path)
    else if (entry.isDirectory()) symlinks(path, found)
  }
  return found
}

/**
 * Whether a symlink resolves to nothing.
 * @param {string} link - symlink path.
 * @returns whether the target is missing.
 */
function isBrokenLink(link) {
  try {
    lstatSync(link)
    return !existsSync(link)
  } catch {
    return true
  }
}

/**
 * Run the sidecar's self-test over stdin and report which keys answered true.
 * @param {string} executable - frozen sidecar binary.
 * @param {string} root - `OCTOPUS_KB_ROOT` for the run.
 * @returns the raw stdout, or '' when the process failed.
 */
function selfTest(executable, root) {
  const result = spawnSync(executable, [], {
    input: '{"command":"self-test"}\n',
    // A frozen onedir resolves its libraries through the environment it
    // inherits; only the KB root is overridden.
    env: { ...process.env, OCTOPUS_KB_ROOT: root },
    encoding: 'utf8',
    shell: false,
  })
  return result.stdout ?? ''
}

if (!existsSync(join(PYTHON_DIR, 'sidecar.py'))) fail(`missing ${join(PYTHON_DIR, 'sidecar.py')}`)
if (!existsSync(join(KB_DIR, 'src'))) fail(`missing vendored kb at ${KB_DIR}`)

const PYTHON = process.env.ASK_KNOWLEDGE_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
if (spawnSync(PYTHON, ['--version'], { encoding: 'utf8' }).status !== 0) {
  fail(`${PYTHON} is required to freeze the sidecar (set ASK_KNOWLEDGE_PYTHON to override)`)
}

mkdirSync(CACHE, { recursive: true })
mkdirSync(OUT, { recursive: true })
const VENV = join(CACHE, 'venv')
const VENV_PYTHON = process.platform === 'win32'
  ? join(VENV, 'Scripts', 'python.exe')
  : join(VENV, 'bin', 'python')
if (!existsSync(VENV_PYTHON)) {
  info('Creating sidecar build venv...')
  run(PYTHON, ['-m', 'venv', VENV])
}

// The kb package installs with --no-deps below, so the runtime dependencies it
// declares are installed here explicitly. The freeze collects jsonschema,
// pydantic, yaml and httpx as hidden imports only if this venv carries them.
info('Installing freeze dependencies...')
run(VENV_PYTHON, ['-m', 'pip', 'install', '--upgrade', `pip==${PIP_VERSION}`])
run(VENV_PYTHON, [
  '-m', 'pip', 'install', '-q',
  `pyinstaller==${PYINSTALLER_VERSION}`,
  'markitdown[pdf]>=0.1',
  'openpyxl',
  'pypdf==6.11.0',
  'jsonschema>=4.18',
  'pydantic>=2.5',
  'pyyaml>=6.0',
  'httpx>=0.27',
])
run(VENV_PYTHON, ['-m', 'pip', 'install', '-q', '--force-reinstall', '--no-deps', KB_DIR])

info('Freezing octopus-kb-sidecar (onedir)...')
rmSync(join(CACHE, 'dist'), { recursive: true, force: true })
rmSync(join(CACHE, 'build'), { recursive: true, force: true })
run(VENV_PYTHON, [
  '-m', 'PyInstaller',
  '--noconfirm',
  '--clean',
  '--onedir',
  '--name', 'octopus-kb-sidecar',
  '--distpath', join(CACHE, 'dist'),
  '--workpath', join(CACHE, 'build'),
  '--specpath', CACHE,
  '--collect-all', 'octopus_kb_compound',
  '--collect-all', 'documents',
  '--collect-all', 'markitdown',
  '--collect-all', 'magika',
  '--collect-all', 'pdfminer',
  '--collect-all', 'pdfplumber',
  '--collect-all', 'pypdf',
  '--hidden-import', 'jsonschema',
  '--hidden-import', 'pydantic',
  '--hidden-import', 'yaml',
  '--hidden-import', 'httpx',
  '--hidden-import', 'openpyxl',
  '--hidden-import', 'pdfminer',
  '--hidden-import', 'pdfplumber',
  '--hidden-import', 'pypdf',
  '--hidden-import', 'sqlite3',
  '--hidden-import', '_sqlite3',
  '--add-data', `${join(KB_DIR, 'src', 'octopus_kb_compound', 'validators', 'builtins.yaml')}${ADD_DATA_SEP}${join('octopus_kb_compound', 'validators')}`,
  'sidecar.py',
], { cwd: PYTHON_DIR })

const FROZEN = join(CACHE, 'dist', 'octopus-kb-sidecar', process.platform === 'win32' ? 'octopus-kb-sidecar.exe' : 'octopus-kb-sidecar')
if (!existsSync(FROZEN)) fail(`PyInstaller did not emit ${FROZEN}`)

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
cpSync(join(CACHE, 'dist', 'octopus-kb-sidecar'), join(OUT, 'octopus-kb-sidecar'), { recursive: true })
cpSync(join(KB_DIR, 'prompts'), join(OUT, 'prompts'), { recursive: true })
cpSync(join(KB_DIR, 'schemas'), join(OUT, 'schemas'), { recursive: true })
cpSync(join(PYTHON_DIR, 'LICENSE'), join(OUT, 'LICENSE'))
cpSync(join(PYTHON_DIR, 'SOURCE.txt'), join(OUT, 'SOURCE.txt'))

const links = symlinks(OUT)
const broken = links.filter(isBrokenLink)
if (broken.length > 0) {
  console.error(broken.join('\n'))
  fail('kb-runtime contains broken symlinks')
}
/**
 * Whether a link target is absolute, i.e. leaves the install tree.
 * @param {string} link - symlink path.
 * @returns whether the target is rooted.
 */
function isAbsoluteLink(link) {
  const target = readlinkSync(link)
  return target.startsWith('/') || /^[A-Za-z]:[\\/]/.test(target)
}
const escaping = links.filter(isAbsoluteLink)
if (escaping.length > 0) {
  console.error(escaping.join('\n'))
  fail('kb-runtime contains absolute-path symlinks')
}

const OUT_BINARY = process.platform === 'win32' ? 'octopus-kb-sidecar.exe' : 'octopus-kb-sidecar'
const SELFTEST = selfTest(join(OUT, 'octopus-kb-sidecar', OUT_BINARY), OUT)
if (SELF_TEST_KEYS.every(key => SELFTEST.includes(`"${key}": true`))) {
  ok('Frozen sidecar reports pdf, xlsx, proposal schema, apply rules, rules schema, page-meta fill, retrieve fold, and convert-file')
} else {
  console.error(SELFTEST)
  fail('frozen sidecar missing pdf/xlsx extras, page-meta fill, retrieve fold, convert-file, or cannot open proposal.json / builtins.yaml / rules/v1.json')
}

ok(`Sidecar runtime at ${OUT}`)
