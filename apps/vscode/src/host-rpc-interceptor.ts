/** Workspace-restricted VS Code implementation of the two approved Host RPC interceptions. */

import { isAbsolute, posix, relative, resolve, sep } from 'node:path'
import type {
  ClientRequest,
  RpcError,
  RpcResult,
  ServerResponse,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import {
  hostDescribeValueSchema,
  hostOpenPathRequestSchema,
} from '@deepseek-ai/dsh-host-apiproxy/api/host.schema'

/** URI facts and fragment replacement used without loading the VS Code runtime in tests. */
export interface HostRpcUri {
  /** URI scheme. */
  readonly scheme: string
  /** URI authority, empty for ordinary file URIs. */
  readonly authority: string
  /** Slash-separated URI path. */
  readonly path: string
  /** Host filesystem spelling when the URI has a filesystem representation. */
  readonly fsPath: string
  /** URI fragment without the leading hash. */
  readonly fragment: string
  /** Return a URI with the requested fields replaced. */
  with(change: { path?: string; fragment?: string }): HostRpcUri
  /** Serialize the URI. */
  toString(): string
}

/** VS Code operations used only by allowlisted Host request handlers. */
export interface HostRpcInterceptorPorts {
  /** Read the URI of the selected companion root. */
  workspaceRoot(): HostRpcUri
  /** Parse an absolute URI locator. */
  parseUri(value: string): HostRpcUri
  /** Convert an absolute filesystem path into a URI. */
  fileUri(path: string): HostRpcUri
  /** Resolve a relative locator below a root URI. */
  joinUri(base: HostRpcUri, path: string): HostRpcUri
  /** Stat a target through `workspace.fs`. */
  stat(uri: HostRpcUri): Promise<'file' | 'directory' | 'symbolic-link'>
  /** Open one text document through `workspace.openTextDocument`. */
  openTextDocument(uri: HostRpcUri): Promise<unknown>
  /** Show one document, optionally focused at a location. */
  showTextDocument(document: unknown, options: { preview: true; selection?: unknown }): Promise<unknown>
  /** Construct a zero-width editor range at a zero-based position. */
  pointRange(line: number, column: number): unknown
  /** Execute VS Code's `revealInExplorer` command. */
  revealInExplorer(uri: HostRpcUri): Promise<unknown>
}

/** Logical request/response hook consumed by one extension bridge generation. */
export interface HostRpcRouting {
  /**
   * Intercept a Client request or choose companion forwarding.
   * @param request - parsed upstream request.
   * @param signal - owning bridge lifecycle cancellation.
   * @returns local response, or undefined for unchanged forwarding.
   */
  interceptRequest(request: ClientRequest, signal: AbortSignal): Promise<ServerResponse | undefined>
  /**
   * Patch a correlated companion response when owned by the interceptor.
   * @param response - parsed downstream response.
   * @returns patched or original response.
   */
  interceptResponse(response: ServerResponse): ServerResponse
  /** Release correlations owned by this bridge generation. */
  dispose(): void
}

interface ParsedLocator {
  readonly target: string
  readonly line?: number
  readonly column?: number
}

type BadRequestError = Extract<RpcError, { code: 'bad-request' }>

const URI_PREFIX = /^[A-Za-z][A-Za-z\d+.-]*:\/\//
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[/\\]|^\\\\/
const LOCATION_FRAGMENT_COLUMN = /^(.*)#L([1-9]\d*):([1-9]\d*)$/
const LOCATION_FRAGMENT_LINE = /^(.*)#L([1-9]\d*)$/
const LOCATION_SUFFIX_COLUMN = /^(.*):([1-9]\d*):([1-9]\d*)$/
const LOCATION_SUFFIX_LINE = /^(.*):([1-9]\d*)$/

function parsedLocator(value: string): ParsedLocator {
  const match = LOCATION_FRAGMENT_COLUMN.exec(value)
    ?? LOCATION_FRAGMENT_LINE.exec(value)
    ?? LOCATION_SUFFIX_COLUMN.exec(value)
    ?? LOCATION_SUFFIX_LINE.exec(value)
  const target = match?.[1]
  const line = match?.[2]
  const column = match?.[3]
  if (target === undefined || target === '' || line === undefined) return { target: value }
  return {
    target,
    line: Number(line),
    ...(column === undefined ? {} : { column: Number(column) }),
  }
}

function isAbsoluteFilePath(value: string): boolean {
  return isAbsolute(value) || WINDOWS_ABSOLUTE.test(value)
}

function targetUri(locator: string, root: HostRpcUri, ports: HostRpcInterceptorPorts): HostRpcUri {
  if (URI_PREFIX.test(locator)) return ports.parseUri(locator).with({ fragment: '' })
  if (isAbsoluteFilePath(locator)) {
    const file = ports.fileUri(locator)
    return root.scheme.toLowerCase() === 'file' ? file : root.with({ path: file.path, fragment: '' })
  }
  return ports.joinUri(root, locator)
}

function isContained(root: HostRpcUri, target: HostRpcUri): boolean {
  if (root.scheme.toLowerCase() !== target.scheme.toLowerCase() || root.authority !== target.authority) return false
  if (root.scheme.toLowerCase() === 'file') {
    const selected = resolve(root.fsPath)
    const candidate = resolve(target.fsPath)
    const path = relative(selected, candidate)
    return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  }
  const selected = posix.resolve('/', root.path)
  const candidate = posix.resolve('/', target.path)
  return candidate === selected || candidate.startsWith(selected.endsWith('/') ? selected : `${selected}/`)
}

function badRequest(request: ClientRequest, issues: BadRequestError['details']['issues']): ServerResponse {
  return {
    type: 'server-response',
    rpcId: request.rpcId,
    result: {
      ok: false,
      error: { code: 'bad-request', message: 'invalid payload for host.openPath', details: { issues } },
    },
  }
}

function failure(request: ClientRequest, error: RpcError): ServerResponse {
  return { type: 'server-response', rpcId: request.rpcId, result: { ok: false, error } }
}

function success(request: ClientRequest): ServerResponse {
  return { type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { opened: true } } }
}

function cancelled(request: ClientRequest): ServerResponse {
  return failure(request, { code: 'cancelled', message: 'path open was aborted', details: {} })
}

function isCancelled(signal: AbortSignal): boolean {
  return signal.aborted
}

async function statWithoutSymlinks(
  root: HostRpcUri,
  target: HostRpcUri,
  ports: HostRpcInterceptorPorts,
  signal: AbortSignal,
): Promise<'file' | 'directory'> {
  const path = posix.relative(posix.resolve('/', root.path), posix.resolve('/', target.path))
  const segments = path === '' ? [] : path.split('/')
  const candidates = segments.length === 0
    ? [target]
    : segments.map((_, index) => index === segments.length - 1
      ? target
      : root.with({ path: posix.join(root.path, ...segments.slice(0, index + 1)), fragment: '' }))
  let targetKind: 'file' | 'directory' = 'directory'
  for (const [index, candidate] of candidates.entries()) {
    if (isCancelled(signal)) throw new Error('path open was aborted')
    const kind = await ports.stat(candidate)
    if (kind === 'symbolic-link') throw new Error('symbolic-link targets are not opened')
    if (index < candidates.length - 1 && kind !== 'directory') {
      throw new Error('path component is not a directory')
    }
    targetKind = kind
  }
  return targetKind
}

/** Intercepts `host.openPath` locally and patches correlated `host.describe` responses. */
export class HostRpcInterceptor implements HostRpcRouting {
  private readonly pendingDescribe = new Set<string>()

  /** @param ports - selected-root URI and allowlisted VS Code operations. */
  constructor(private readonly ports: HostRpcInterceptorPorts) {}

  /**
   * Intercept one parsed Client request when locally owned.
   * @param request - parsed ApiProxy request envelope.
   * @param signal - owning bridge lifecycle cancellation.
   * @returns a local response for `host.openPath`; undefined to forward every other request unchanged.
   */
  async interceptRequest(request: ClientRequest, signal: AbortSignal): Promise<ServerResponse | undefined> {
    if (request.method === 'host.describe') {
      this.pendingDescribe.add(request.rpcId)
      return undefined
    }
    if (request.method !== 'host.openPath') return undefined
    const parsed = hostOpenPathRequestSchema.safeParse(request.payload)
    if (!parsed.success) return badRequest(request, parsed.error.issues)
    if (isCancelled(signal)) return cancelled(request)
    try {
      const locator = parsedLocator(parsed.data.path)
      const root = this.ports.workspaceRoot()
      const uri = targetUri(locator.target, root, this.ports)
      if (!isContained(root, uri)) {
        return failure(request, {
          code: 'workspace-invalid-path',
          message: 'path is outside the selected VS Code workspace',
          details: { path: parsed.data.path },
        })
      }
      const kind = await statWithoutSymlinks(root, uri, this.ports, signal)
      if (isCancelled(signal)) return cancelled(request)
      if (kind === 'directory') {
        await this.ports.revealInExplorer(uri)
      } else {
        const document = await this.ports.openTextDocument(uri)
        if (isCancelled(signal)) return cancelled(request)
        const selection = locator.line === undefined
          ? undefined
          : this.ports.pointRange(locator.line - 1, (locator.column ?? 1) - 1)
        await this.ports.showTextDocument(document, {
          preview: true,
          ...(selection === undefined ? {} : { selection }),
        })
      }
      return isCancelled(signal) ? cancelled(request) : success(request)
    } catch (error) {
      if (isCancelled(signal)) return cancelled(request)
      return failure(request, {
        code: 'internal',
        message: `path open failed: ${error instanceof Error ? error.message : String(error)}`,
        details: {},
      })
    }
  }

  /**
   * Advertise the extension-owned opener on a correlated companion description.
   * @param response - parsed companion Server response.
   * @returns patched description or the original response object.
   */
  interceptResponse(response: ServerResponse): ServerResponse {
    if (!this.pendingDescribe.delete(response.rpcId) || !response.result.ok) return response
    const parsed = hostDescribeValueSchema.safeParse(response.result.value)
    if (!parsed.success) return response
    const result: RpcResult<unknown> = {
      ok: true,
      value: { ...parsed.data, canOpenPath: true },
    }
    return { ...response, result }
  }

  /** Forget forwarded description requests when the owning bridge closes. */
  dispose(): void {
    this.pendingDescribe.clear()
  }
}
