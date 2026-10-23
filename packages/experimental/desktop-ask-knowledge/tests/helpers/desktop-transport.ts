/** Real desktop process carrier over private in-memory stdio pipes for Host acceptance. */
import { PassThrough } from 'node:stream'
import { onTestFinished } from 'vitest'
import { createWebConnectionRpc } from '@deepseek-ai/dsh-client-connection/src/client/rpc.ts'
import { ProcessTransport, type ProcessBridgePort } from '@deepseek-ai/dsh-client-connection-process/browser'
import {
  DEFAULT_MAX_LOGICAL_RPC_BYTES, VSCODE_CARRIER_PROTOCOL_VERSION,
  StdioLinePort, VsCodeIpcChannel, VsCodeHostGateway, VsCodeWireDecoder, sendVsCodeFrame,
} from '@deepseek-ai/dsh-client-connection-process'

/**
 * Connect the real Client RPC and process transport to the companion gateway and an HTTP adapter.
 * @param workspaceRoot - isolated fixture workspace used for the handshake.
 * @param apiFetch - Host-side HTTP request handler.
 * @returns Client caller, transport and idempotent asynchronous cleanup.
 */
export async function desktopTransport(workspaceRoot: string, apiFetch: (request: Request) => Promise<Response>) {
  const uplink = new PassThrough()
  const downlink = new PassThrough()
  const hostPort = new StdioLinePort({ input: uplink, output: downlink })
  const clientPort = new StdioLinePort({ input: downlink, output: uplink })
  const channel: VsCodeIpcChannel = new VsCodeIpcChannel({ port: hostPort, maxLogicalRpcBytes: DEFAULT_MAX_LOGICAL_RPC_BYTES,
    onFrame: frame => gateway.accept(frame) })
  const gateway: VsCodeHostGateway = new VsCodeHostGateway({
    apiFetchHandler: { fetch: apiFetch }, openStream: async () => (async function* () {})(),
    clientModules: { graph: () => ({ rev: '0', entries: [], batches: [] }), clientPath: () => undefined, onGraphChanged: () => () => {} },
    expectedWorkspaceRoot: workspaceRoot, runtimeVersion: 'acceptance-fixture',
    maxLogicalRpcBytes: DEFAULT_MAX_LOGICAL_RPC_BYTES, send: frame => channel.send(frame),
    close: () => { hostPort.disconnect() },
  })
  const port: ProcessBridgePort = {
    maxLogicalRpcBytes: DEFAULT_MAX_LOGICAL_RPC_BYTES,
    send: record => new Promise((resolve, reject) => {
      clientPort.send(record, (error) => { if (error) reject(error); else resolve() })
    }),
    subscribe: (listener) => { clientPort.on('message', listener); return () => { clientPort.off('message', listener) } },
  }
  const owned: { transport?: ProcessTransport } = {}
  let cleanup: Promise<void> | undefined
  const dispose = () => cleanup ??= (async () => {
    owned.transport?.dispose()
    await gateway.dispose()
    await channel.dispose()
    clientPort.disconnect()
    hostPort.disconnect()
    uplink.destroy()
    downlink.destroy()
  })()
  onTestFinished(dispose)
  await new Promise<void>((resolve, reject) => {
    const decoder = new VsCodeWireDecoder({ maxLogicalRpcBytes: DEFAULT_MAX_LOGICAL_RPC_BYTES, onViolation: reject })
    const receive = (value: unknown) => {
      void decoder.accept(value).then((frame) => {
        if (frame?.type === 'control/ready' || frame?.type === 'control/error') {
          clientPort.off('message', receive)
          decoder.dispose()
          if (frame.type === 'control/error') reject(new Error(JSON.stringify(frame)))
          else resolve()
        }
      }, reject)
    }
    clientPort.on('message', receive)
    void sendVsCodeFrame({ type: 'control/hello', protocolVersion: VSCODE_CARRIER_PROTOCOL_VERSION,
      extensionVersion: 'acceptance-fixture', workspaceRoot, locale: 'zh-CN' }, record => port.send(record)).catch(reject)
  })
  const activeTransport = new ProcessTransport(port)
  owned.transport = activeTransport
  return { rpc: createWebConnectionRpc((input, init) => activeTransport.fetch(input, init)), transport: activeTransport, dispose }
}
