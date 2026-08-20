/** VS Code-owned Host RPC interception and workspace-restricted path opening. */

import { posix } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { RpcId, type ClientRequest, type ServerResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import {
  HostRpcInterceptor,
  type HostRpcInterceptorPorts,
  type HostRpcUri,
} from '../src/host-rpc-interceptor.ts'

class TestUri implements HostRpcUri {
  constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
    readonly fsPath: string,
    readonly fragment = '',
  ) {}

  with(change: { path?: string; fragment?: string }): HostRpcUri {
    const path = change.path ?? this.path
    return new TestUri(this.scheme, this.authority, path, path, change.fragment ?? this.fragment)
  }

  toString(): string {
    const authority = this.authority === '' ? '' : `//${this.authority}`
    const fragment = this.fragment === '' ? '' : `#${this.fragment}`
    return `${this.scheme}:${authority}${this.path}${fragment}`
  }
}

function remoteUri(value: string): TestUri {
  const parsed = new URL(value)
  return new TestUri(parsed.protocol.slice(0, -1), parsed.host, parsed.pathname, parsed.pathname, parsed.hash.slice(1))
}

function fileUri(path: string): TestUri {
  return new TestUri('file', '', path, path)
}

function openRequest(path: unknown, id = 'open-1'): ClientRequest {
  return { type: 'client-request', rpcId: RpcId(id), method: 'host.openPath', payload: { path } }
}

function describeRequest(id = 'describe-1'): ClientRequest {
  return { type: 'client-request', rpcId: RpcId(id), method: 'host.describe', payload: {} }
}

function description(id = 'describe-1', canOpenPath = false): ServerResponse {
  return {
    type: 'server-response',
    rpcId: RpcId(id),
    result: {
      ok: true,
      value: { version: '1', cwd: '/workspace', attachedSessions: 0, home: '/home/test', canOpenPath },
    },
  }
}

function bench(root: HostRpcUri = fileUri('/workspace')) {
  const stat = vi.fn<HostRpcInterceptorPorts['stat']>(async uri => uri.path.endsWith('.ts') ? 'file' : 'directory')
  const document = { uri: 'document' }
  const openTextDocument = vi.fn(async () => document)
  const showTextDocument = vi.fn(async () => {})
  const revealInExplorer = vi.fn(async () => {})
  const ports: HostRpcInterceptorPorts = {
    workspaceRoot: () => root,
    parseUri: value => remoteUri(value),
    fileUri,
    joinUri: (base, path) => new TestUri(
      base.scheme,
      base.authority,
      posix.join(base.path, path),
      posix.join(base.fsPath, path),
    ),
    stat,
    openTextDocument,
    showTextDocument,
    pointRange: (line, column) => ({ line, column }),
    revealInExplorer,
  }
  return {
    interceptor: new HostRpcInterceptor(ports),
    ports,
    stat,
    document,
    openTextDocument,
    showTextDocument,
    revealInExplorer,
  }
}

describe('HostRpcInterceptor', () => {
  it('opens a file inside the selected workspace through VS Code', async () => {
    const b = bench()
    const response = await b.interceptor.interceptRequest(
      openRequest('/workspace/src/main.ts'),
      new AbortController().signal,
    )
    expect(response).toEqual({
      type: 'server-response', rpcId: 'open-1', result: { ok: true, value: { opened: true } },
    })
    expect(b.stat).toHaveBeenCalledWith(expect.objectContaining({ path: '/workspace/src/main.ts' }))
    expect(b.openTextDocument).toHaveBeenCalledWith(expect.objectContaining({ path: '/workspace/src/main.ts' }))
    expect(b.showTextDocument).toHaveBeenCalledWith(b.document, { preview: true })
    expect(b.revealInExplorer).not.toHaveBeenCalled()
  })

  it('opens a one-based line and column as a zero-based editor selection', async () => {
    const b = bench()
    await b.interceptor.interceptRequest(
      openRequest('/workspace/src/main.ts:12:4'),
      new AbortController().signal,
    )
    expect(b.showTextDocument).toHaveBeenCalledWith(b.document, {
      preview: true,
      selection: { line: 11, column: 3 },
    })
    b.showTextDocument.mockClear()
    await b.interceptor.interceptRequest(
      openRequest('/workspace/src/main.ts#L5', 'fragment-location'),
      new AbortController().signal,
    )
    expect(b.showTextDocument).toHaveBeenCalledWith(b.document, {
      preview: true,
      selection: { line: 4, column: 0 },
    })
  })

  it('reveals an existing directory instead of opening it as text', async () => {
    const b = bench()
    b.stat.mockResolvedValueOnce('directory')
    const response = await b.interceptor.interceptRequest(
      openRequest('/workspace/src'),
      new AbortController().signal,
    )
    expect(response?.result).toEqual({ ok: true, value: { opened: true } })
    expect(b.revealInExplorer).toHaveBeenCalledWith(expect.objectContaining({ path: '/workspace/src' }))
    expect(b.openTextDocument).not.toHaveBeenCalled()
  })

  it('returns a Host business failure for missing and malformed paths', async () => {
    const b = bench()
    b.stat.mockRejectedValueOnce(new Error('FileNotFound'))
    const missing = await b.interceptor.interceptRequest(
      openRequest('/workspace/missing.ts'),
      new AbortController().signal,
    )
    expect(missing?.result.ok).toBe(false)
    if (missing?.result.ok !== false) throw new Error('expected a missing-path failure')
    expect(missing.result.error).toMatchObject({ code: 'internal' })
    expect(missing.result.error.message).toMatch(/FileNotFound/)
    await expect(b.interceptor.interceptRequest(
      openRequest('', 'bad-open'),
      new AbortController().signal,
    )).resolves.toMatchObject({
      rpcId: 'bad-open', result: { ok: false, error: { code: 'bad-request' } },
    })
  })

  it('refuses paths outside the selected workspace before filesystem access', async () => {
    const b = bench()
    const response = await b.interceptor.interceptRequest(
      openRequest('/other/private.ts'),
      new AbortController().signal,
    )
    expect(response).toMatchObject({
      result: {
        ok: false,
        error: { code: 'workspace-invalid-path', details: { path: '/other/private.ts' } },
      },
    })
    expect(b.stat).not.toHaveBeenCalled()
  })

  it('opens a same-authority remote URI and refuses a different remote authority', async () => {
    const b = bench(remoteUri('vscode-remote://ssh-remote+box/workspace'))
    const accepted = await b.interceptor.interceptRequest(
      openRequest('vscode-remote://ssh-remote+box/workspace/src/main.ts'),
      new AbortController().signal,
    )
    expect(accepted?.result).toEqual({ ok: true, value: { opened: true } })
    expect(b.openTextDocument).toHaveBeenCalledWith(expect.objectContaining({
      scheme: 'vscode-remote', authority: 'ssh-remote+box', path: '/workspace/src/main.ts',
    }))
    await b.interceptor.interceptRequest(
      openRequest('/workspace/src/absolute.ts', 'remote-absolute'),
      new AbortController().signal,
    )
    expect(b.openTextDocument).toHaveBeenLastCalledWith(expect.objectContaining({
      scheme: 'vscode-remote', authority: 'ssh-remote+box', path: '/workspace/src/absolute.ts',
    }))

    const refused = await b.interceptor.interceptRequest(
      openRequest('vscode-remote://ssh-remote+other/workspace/src/main.ts', 'remote-outside'),
      new AbortController().signal,
    )
    expect(refused).toMatchObject({ result: { ok: false, error: { code: 'workspace-invalid-path' } } })
  })

  it('refuses symbolic links without opening or revealing them', async () => {
    const b = bench()
    b.stat.mockResolvedValueOnce('symbolic-link')
    const response = await b.interceptor.interceptRequest(
      openRequest('/workspace/link'),
      new AbortController().signal,
    )
    expect(response?.result.ok).toBe(false)
    if (response?.result.ok !== false) throw new Error('expected a symbolic-link failure')
    expect(response.result.error).toMatchObject({ code: 'internal' })
    expect(response.result.error.message).toMatch(/symbolic-link/)
    expect(b.openTextDocument).not.toHaveBeenCalled()
    expect(b.revealInExplorer).not.toHaveBeenCalled()
  })

  it('refuses an intermediate symbolic link before opening its descendant', async () => {
    const b = bench()
    b.stat.mockImplementation(async uri => uri.path === '/workspace/link' ? 'symbolic-link' : 'file')
    const response = await b.interceptor.interceptRequest(
      openRequest('/workspace/link/private.ts'),
      new AbortController().signal,
    )
    expect(response?.result.ok).toBe(false)
    if (response?.result.ok !== false) throw new Error('expected an intermediate symbolic-link failure')
    expect(response.result.error).toMatchObject({ code: 'internal' })
    expect(response.result.error.message).toMatch(/symbolic-link/)
    expect(b.openTextDocument).not.toHaveBeenCalled()
  })

  it('reports cancellation without showing a document after the pending operation settles', async () => {
    const b = bench()
    let resolveDocument!: (value: unknown) => void
    const pendingOpen = vi.fn(() => new Promise((resolve) => { resolveDocument = resolve }))
    b.ports.openTextDocument = pendingOpen
    const abort = new AbortController()
    const response = b.interceptor.interceptRequest(openRequest('/workspace/src/main.ts'), abort.signal)
    await vi.waitFor(() => { expect(pendingOpen).toHaveBeenCalledOnce() })
    abort.abort()
    resolveDocument(b.document)
    await expect(response).resolves.toMatchObject({ result: { ok: false, error: { code: 'cancelled' } } })
    expect(b.showTextDocument).not.toHaveBeenCalled()
  })

  it('forwards describe, advertises VS Code opening on its correlated response, and leaves other RPC unchanged', async () => {
    const b = bench()
    const request = describeRequest()
    await expect(b.interceptor.interceptRequest(request, new AbortController().signal)).resolves.toBeUndefined()
    expect(b.interceptor.interceptResponse(description())).toEqual(description('describe-1', true))

    const otherRequest: ClientRequest = {
      type: 'client-request', rpcId: RpcId('other'), method: 'session.list', payload: { marker: true },
    }
    await expect(b.interceptor.interceptRequest(otherRequest, new AbortController().signal)).resolves.toBeUndefined()
    const otherResponse: ServerResponse = {
      type: 'server-response', rpcId: RpcId('other'), result: { ok: true, value: { marker: true } },
    }
    expect(b.interceptor.interceptResponse(otherResponse)).toBe(otherResponse)
  })
})
