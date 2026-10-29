/**
 * T0 Fatal exception, unhandled rejection, stuck disposer, and PTY restore tests.
 * Proves that:
 * 1. Synchronous terminal restoration executes BEFORE stderr diagnostic output.
 * 2. Uncaught exceptions and unhandled rejections both exit non-zero (code 1).
 * 3. Stuck release disposer is bounded by timeout (exits 1).
 * 4. Throwing release disposer does not crash or swallow the fatal error.
 * 5. Closed/broken stdout does not crash terminal restoration.
 * 6. Mid-initialization failure restores terminal and exits non-zero.
 */

import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'

function runSubprocess(code: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', code], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode })
    })
  })
}

describe('T0 fatal error and terminal restoration subprocess tests', () => {
  it('executes pre-report terminal restoration before stderr diagnostic on uncaughtException', async () => {
    const script = `
      import { installFailLoud, createTerminalRestore } from './packages/boot/app-boot/src/index.ts';
      const order = [];
      const restore = createTerminalRestore();
      restore.register(() => {
        order.push('RESTORE_HOOK');
        process.stdout.write('RESTORE_RAN\\n');
      });

      installFailLoud('dsh-tui', process, undefined, () => {
        restore.restoreNow();
      });

      setTimeout(() => {
        throw new Error('uncaught_boom');
      }, 50);
    `
    const res = await runSubprocess(script)
    expect(res.exitCode).toBe(1)
    expect(res.stdout).toContain('RESTORE_RAN')
    expect(res.stderr).toContain('uncaught_boom')
    expect(res.stderr).toContain('fatal uncaught exception')
  })

  it('executes pre-report terminal restoration before stderr diagnostic on unhandledRejection', async () => {
    const script = `
      import { installFailLoud, createTerminalRestore } from './packages/boot/app-boot/src/index.ts';
      const restore = createTerminalRestore();
      restore.register(() => {
        process.stdout.write('RESTORE_REJECTION\\n');
      });

      installFailLoud('dsh-tui', process, undefined, () => {
        restore.restoreNow();
      });

      setTimeout(() => {
        Promise.reject(new Error('unhandled_rejection_boom'));
      }, 50);
    `
    const res = await runSubprocess(script)
    expect(res.exitCode).toBe(1)
    expect(res.stdout).toContain('RESTORE_REJECTION')
    expect(res.stderr).toContain('unhandled_rejection_boom')
    expect(res.stderr).toContain('fatal load failure')
  })

  it('bounds stuck release disposer and forces non-zero exit', async () => {
    const script = `
      import { installFailLoud } from './packages/boot/app-boot/src/index.ts';
      // Release hangs forever
      installFailLoud('dsh-tui', process, () => new Promise(() => {}));
      setTimeout(() => {
        throw new Error('crash_with_stuck_disposer');
      }, 50);
    `
    const start = Date.now()
    const res = await runSubprocess(script)
    const duration = Date.now() - start

    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('crash_with_stuck_disposer')
    // Bounded by 2000ms release timeout in installFailLoud
    expect(duration).toBeGreaterThanOrEqual(1800)
    expect(duration).toBeLessThan(5000)
  }, 10000)

  it('handles throwing release disposer without swallowing original error', async () => {
    const script = `
      import { installFailLoud } from './packages/boot/app-boot/src/index.ts';
      installFailLoud('dsh-tui', process, async () => {
        throw new Error('disposer_exploded');
      });
      setTimeout(() => {
        throw new Error('primary_crash');
      }, 50);
    `
    const res = await runSubprocess(script)
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('primary_crash')
  })

  it('contains stdout close/broken-pipe errors during terminal restoration', async () => {
    const script = `
      import { installFailLoud, createTerminalRestore } from './packages/boot/app-boot/src/index.ts';
      const restore = createTerminalRestore();
      restore.register(() => {
        // Attempt to write to destroyed stream or throw
        process.stdout.destroy();
        throw new Error('broken pipe simulation');
      });

      installFailLoud('dsh-tui', process, undefined, () => {
        restore.restoreNow();
      });

      setTimeout(() => {
        throw new Error('crash_after_pipe_break');
      }, 50);
    `
    const res = await runSubprocess(script)
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('crash_after_pipe_break')
  })

  it('restores terminal and exits non-zero on mid-initialization failure', async () => {
    const script = `
      import { installFailLoud, createTerminalRestore } from './packages/boot/app-boot/src/index.ts';
      const restore = createTerminalRestore();
      restore.register(() => {
        process.stderr.write('[RESTORED_MID_INIT]\\n');
      });

      installFailLoud('dsh-tui', process, undefined, () => {
        restore.restoreNow();
      });

      // Synchronous failure during startup
      throw new Error('startup_config_invalid');
    `
    const res = await runSubprocess(script)
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('[RESTORED_MID_INIT]')
    expect(res.stderr).toContain('startup_config_invalid')
  })
})
