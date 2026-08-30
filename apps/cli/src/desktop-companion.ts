#!/usr/bin/env node
/**
 * Installed desktop companion entry. It claims process stdio as the record
 * port, accepts only the selected workspace, acquires exclusive ownership of
 * DSH_HOME, and boots the shipped desktop profile.
 * @module @deepseek-ai/dsh/desktop-companion
 */

/* v8 ignore file -- the spawned-process acceptance owns this self-executing entry. */

import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import {
  claimProcessStdio,
  getClaimedStdioPort,
  sendVsCodeFrame,
  type NodeIpcPort,
  type VsCodeCarrierFrame,
  type VsCodeWireRecord,
} from '@deepseek-ai/dsh-client-connection-process'
import { parseDesktopStartupArgs } from '@deepseek-ai/dsh-desktop-app'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { runProfile } from './profile-boot.ts'
import {
  acquireHomeLease,
  HomeBusyError,
  type HomeLease,
} from './home-lease.ts'

/** Send one startup frame with Node's callback as the backpressure signal. */
function sendFrame(port: NodeIpcPort, frame: VsCodeCarrierFrame): Promise<void> {
  return sendVsCodeFrame(frame, (record: VsCodeWireRecord) => new Promise((resolve, reject) => {
    port.send(record, (error) => {
      if (error === null) resolve()
      else reject(error)
    })
  }))
}

/** Read connection liveness after an asynchronous profile boot. */
function isDisconnected(port: NodeIpcPort): boolean {
  return !port.connected
}

/** Report a pre-gateway startup failure through the same bounded carrier. */
async function reportStartupFailure(port: NodeIpcPort, error: unknown): Promise<void> {
  const code = error instanceof HomeBusyError ? error.code : 'startup-failure'
  const message = error instanceof Error ? error.message : String(error)
  if (port.connected) {
    try {
      await sendFrame(port, { type: 'control/error', code, message })
    } catch {
      // A disconnected parent cannot receive a startup diagnostic; stderr
      // remains the local process-supervisor record below.
    }
  }
  process.stderr.write(`dsh desktop companion: ${message}\n`)
  if (port.connected) port.disconnect()
  process.exitCode = 1
}

/** Boot and bind one companion to its parent stdio lifecycle. */
async function main(): Promise<void> {
  claimProcessStdio()
  const port = getClaimedStdioPort()
  if (port === undefined) throw new Error('desktop companion failed to claim process stdio')
  let lease: HomeLease | undefined
  try {
    if (!port.connected) throw new Error('a connected stdio carrier is required')
    const startup = parseDesktopStartupArgs(process.argv.slice(2))
    process.chdir(startup.workspaceRoot)
    const environment = loadLayeredEnv('dsh', startup.workspaceRoot)
    lease = acquireHomeLease(resolveDshHome(), { surface: 'desktop' })

    const running = await runProfile({
      environment,
      profile: 'desktop',
      patchFiles: [],
      args: ['--workspace-root', startup.workspaceRoot],
    })
    // Each shutdown trigger names itself before it runs. A clean exit through
    // any of them is indistinguishable downstream — the window only sees its
    // next write fail with a broken pipe — so without this line a companion
    // that goes away leaves no record of which end closed first.
    const stopFor = (trigger: string): void => {
      process.stderr.write(`dsh desktop companion: shutting down (${trigger})\n`)
      running.shutdown.interrupt(0)
    }
    const onDisconnect = (): void => { stopFor('carrier port disconnected') }
    const onStdinEnded = (): void => { stopFor('stdin ended') }
    const onStdinClosed = (): void => { stopFor('stdin closed') }
    port.on('disconnect', onDisconnect)
    process.stdin.on('end', onStdinEnded)
    process.stdin.on('close', onStdinClosed)
    running.ctx.effect(() => () => {
      port.off('disconnect', onDisconnect)
      process.stdin.off('end', onStdinEnded)
      process.stdin.off('close', onStdinClosed)
      lease?.release()
    }, 'desktop companion: release home lease and carrier observers')
    if (isDisconnected(port)) await running.shutdown.shutdown(0)
  } catch (error) {
    lease?.release()
    await reportStartupFailure(port, error)
  }
}

await main()
