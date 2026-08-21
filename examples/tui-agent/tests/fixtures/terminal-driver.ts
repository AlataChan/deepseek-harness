/** POSIX pseudo-terminal driver for the assembled TUI example. */

import { execa } from 'execa'
import { resolveExampleLaunch, type ExampleMode } from '@deepseek-ai/dsh-loader-smoke'

const META_PREFIX = '__DSH_TUI_META__'

const POSIX_PTY_DRIVER = String.raw`
import errno, fcntl, json, os, pty, select, signal, struct, sys, termios, time
node, args_json, cwd, actions_json, columns, rows, timeout_seconds = sys.argv[1:]
env = os.environ.copy()
env.update(json.loads(env.pop("DSH_TUI_CHILD_ENV", "{}")))
actions = json.loads(actions_json)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe(node, [node, *json.loads(args_json)], env)

def resize(action_rows, action_columns):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", action_rows, action_columns, 0, 0))

resize(int(rows), int(columns))
output = bytearray()
action_index = 0
next_action_at = 0.0
deadline = time.monotonic() + float(timeout_seconds)
status = None
while time.monotonic() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.02)
    if ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            chunk = b""
        if chunk:
            output.extend(chunk)
    while action_index < len(actions) and time.monotonic() >= next_action_at:
        action = actions[action_index]
        marker = action.get("waitFor")
        marker_file = action.get("waitForFile")
        if marker is not None and marker.encode() not in output:
            break
        if marker_file is not None and not os.path.exists(os.path.join(cwd, marker_file)):
            break
        if "resize" in action:
            action_rows, action_columns = action["resize"]
            resize(action_rows, action_columns)
        if "bytes" in action:
            os.write(fd, action["bytes"].encode())
        action_index += 1
        next_action_at = time.monotonic() + 0.05
        break
    waited, candidate = os.waitpid(pid, os.WNOHANG)
    if waited == pid:
        status = candidate
        break

timed_out = status is None
if timed_out:
    os.kill(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
try:
    attributes = termios.tcgetattr(fd)
    raw_restored = bool(attributes[3] & termios.ICANON) and bool(attributes[3] & termios.ECHO)
except OSError:
    raw_restored = False
os.close(fd)
sys.stdout.buffer.write(output)
exit_code = os.waitstatus_to_exitcode(status)
sys.stderr.write("${META_PREFIX}" + json.dumps({"exitCode": exit_code, "rawModeRestored": raw_restored}) + "\n")
if timed_out or action_index != len(actions):
    sys.stderr.write(f"completed {action_index}/{len(actions)} terminal actions before timeout\n")
    sys.exit(124)
if exit_code != 0:
    sys.stderr.write(f"terminal child exited {exit_code}\n")
    sys.exit(125)
`

/** One semantic operation applied after an optional output marker appears. */
export interface TerminalAction {
  readonly waitFor?: string
  readonly waitForFile?: string
  readonly text?: string
  readonly key?: 'return' | 'ctrl-c' | 'ctrl-r' | 'escape'
  readonly resize?: { readonly columns: number; readonly rows: number }
}

interface EncodedTerminalAction {
  readonly waitFor?: string
  readonly waitForFile?: string
  readonly bytes?: string
  readonly resize?: readonly [rows: number, columns: number]
}

/** Launch description consumed by the PTY helper without extra file descriptors. */
export interface TuiTerminalLaunch {
  readonly command: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly stdio: readonly ['stdin', 'stdout', 'stderr']
}

/** Inputs needed to resolve the real source or built `dsh` TUI invocation. */
export interface ResolveTuiTerminalLaunchOptions {
  readonly mode: ExampleMode
  readonly dshSource: string
  readonly dshBuilt: string
  readonly tsconfigPath: string
  readonly patchPath: string
  readonly additionalPatchPaths?: readonly string[]
  readonly cwd: string
  readonly dshHome: string
  readonly args?: readonly string[]
  readonly env?: NodeJS.ProcessEnv
}

/** PTY execution options for a resolved launch or real TUI invocation. */
export interface RunTuiTerminalOptions {
  readonly cwd: string
  readonly launch: TuiTerminalLaunch
  readonly actions: readonly TerminalAction[]
  readonly columns?: number
  readonly rows?: number
  readonly timeoutMs?: number
}

/** Captured terminal frames and lifecycle facts. */
export interface TuiTerminalResult {
  readonly output: string
  readonly exitCode: number
  readonly rawModeRestored: boolean
}

/** Remove ANSI/VT control sequences and normalize line endings while retaining every visible frame row. */
export function normalizeTerminalOutput(output: string): string {
  const plain = output.replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu, '')
  return `${plain.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n').trimEnd()}\n`
}

/** Convert terminal-level intent into the exact bytes and window-size operations sent to the PTY. */
export function encodeTerminalActions(actions: readonly TerminalAction[]): EncodedTerminalAction[] {
  const keys = { return: '\r', 'ctrl-c': '\u0003', 'ctrl-r': '\u0012', escape: '\u001b' } as const
  return actions.map(action => ({
    ...(action.waitFor === undefined ? {} : { waitFor: action.waitFor }),
    ...(action.waitForFile === undefined ? {} : { waitForFile: action.waitForFile }),
    ...(action.text === undefined && action.key === undefined
      ? {}
      : { bytes: action.text ?? keys[action.key!] }),
    ...(action.resize === undefined ? {} : { resize: [action.resize.rows, action.resize.columns] as const }),
  }))
}

/** Resolve a real `dsh --profile tui --patch ...` launch through the shared example helper. */
export function resolveTuiTerminalLaunch(options: ResolveTuiTerminalLaunchOptions): TuiTerminalLaunch {
  const launch = resolveExampleLaunch({
    srcBin: options.dshSource,
    libBin: options.dshBuilt,
    mode: options.mode,
    tsconfigPath: options.tsconfigPath,
    configArgs: [
      '--profile', 'tui', '--patch', options.patchPath,
      ...(options.additionalPatchPaths ?? []).flatMap(path => ['--patch', path]),
      ...(options.args ?? []),
    ],
    env: {
      DSH_HOME: options.dshHome,
      DSH_AGENTS_HOME: `${options.dshHome}/agents`,
      DSH_TELEMETRY_DISABLED: '1',
      ...options.env,
    },
  })
  return { ...launch, stdio: ['stdin', 'stdout', 'stderr'] }
}

/** Run one deterministic POSIX PTY session, killing and reaping the child on timeout. */
export async function runTuiTerminal(options: RunTuiTerminalOptions): Promise<TuiTerminalResult> {
  if (process.platform === 'win32') throw new Error('runTuiTerminal uses the POSIX PTY lane')
  const timeoutMs = options.timeoutMs ?? 30_000
  const result = await execa('python3', [
    '-c',
    POSIX_PTY_DRIVER,
    options.launch.command,
    JSON.stringify(options.launch.args),
    options.cwd,
    JSON.stringify(encodeTerminalActions(options.actions)),
    String(options.columns ?? 80),
    String(options.rows ?? 24),
    String(timeoutMs / 1_000),
  ], {
    env: { DSH_TUI_CHILD_ENV: JSON.stringify(options.launch.env) },
    stdin: 'ignore',
    timeout: timeoutMs + 2_000,
    killSignal: 'SIGKILL',
    reject: false,
    stripFinalNewline: false,
  })
  const metadataLine = result.stderr.split('\n').find(line => line.startsWith(META_PREFIX))
  const diagnostics = result.stderr.split('\n').filter(line => line !== metadataLine && line !== '').join('\n')
  if (result.timedOut || result.exitCode !== 0 || metadataLine === undefined) {
    throw new Error(`TUI terminal driver failed${result.timedOut ? ' after its process deadline' : ''}: ${diagnostics}\n${result.stdout}`)
  }
  const metadata = JSON.parse(metadataLine.slice(META_PREFIX.length)) as {
    exitCode: number
    rawModeRestored: boolean
  }
  return { output: result.stdout, ...metadata }
}
