#!/usr/bin/env node
/**
 * Installed VS Code companion entry. It accepts only the selected workspace,
 * acquires exclusive ownership of DSH_HOME, and boots the shipped vscode
 * profile over the inherited Node IPC channel.
 * @module @deepseek-ai/dsh/vscode-companion
 */

/* v8 ignore file -- the forked-process acceptance owns this self-executing entry. */

import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import {
  ProcessIpcPort,
  sendVsCodeFrame,
  type NodeIpcPort,
  type VsCodeCarrierFrame,
  type VsCodeWireRecord,
} from '@deepseek-ai/dsh-client-connection-vscode'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parseVsCodeStartupArgs } from '@deepseek-ai/dsh-vscode-app/startup'
import { runProfile } from './profile-boot.ts'
import {
  acquireVsCodeHomeLease,
  VsCodeHomeBusyError,
  type VsCodeHomeLease,
} from './vscode-home-lease.ts'

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
  const code = error instanceof VsCodeHomeBusyError ? error.code : 'startup-failure'
  const message = error instanceof Error ? error.message : String(error)
  if (port.connected) {
    try {
      await sendFrame(port, { type: 'control/error', code, message })
    } catch {
      // A disconnected parent cannot receive a startup diagnostic; stderr
      // remains the local process-supervisor record below.
    }
  }
  process.stderr.write(`dsh vscode companion: ${message}\n`)
  if (port.connected) port.disconnect()
  process.exitCode = 1
}

/** Boot and bind one companion to its parent IPC lifecycle. */
async function main(): Promise<void> {
  const port = new ProcessIpcPort()
  let lease: VsCodeHomeLease | undefined
  try {
    if (!port.connected) throw new Error('a connected Node IPC channel is required')
    const startup = parseVsCodeStartupArgs(process.argv.slice(2))
    process.chdir(startup.workspaceRoot)
    const environment = loadLayeredEnv('dsh', startup.workspaceRoot)
    lease = acquireVsCodeHomeLease(resolveDshHome())

    const running = await runProfile({
      environment,
      profile: 'vscode',
      patchFiles: [],
      args: ['--workspace-root', startup.workspaceRoot],
    })
    const onDisconnect = (): void => { void running.shutdown.shutdown(0) }
    process.on('disconnect', onDisconnect)
    running.ctx.effect(() => () => {
      process.off('disconnect', onDisconnect)
      lease?.release()
    }, 'vscode companion: release home lease and disconnect observer')
    if (isDisconnected(port)) await running.shutdown.shutdown(0)
  } catch (error) {
    lease?.release()
    await reportStartupFailure(port, error)
  }
}

await main()
