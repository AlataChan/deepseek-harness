/** Contract behavior the seam itself owns: registration identity and typed failures. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  AskData, AskDataConnectionRef, AskDataError, AskDataSourceId,
} from '../src/index.ts'
import type {
  AskDataBindLease, AskDataBindRequest, AskDataImportPreview, AskDataImportSpreadsheetRequest,
  AskDataSource,
} from '../src/index.ts'
import { askDataBindingProjectionDefinition } from '../src/session.ts'

class StubAskData extends AskData {
  override listSources(_signal?: AbortSignal): Promise<AskDataSource[]> {
    return Promise.resolve([])
  }

  override importSpreadsheet(
    _request: AskDataImportSpreadsheetRequest,
    _signal?: AbortSignal,
  ): Promise<AskDataImportPreview> {
    return Promise.resolve({
      source: {
        id: AskDataSourceId('src-1'),
        displayName: 'a.csv',
        kind: 'import',
        warnings: [],
        missing: false,
      },
      tables: [],
      warnings: [],
    })
  }

  override importSample(_signal?: AbortSignal): Promise<AskDataImportPreview> {
    return Promise.resolve({
      source: {
        id: AskDataSourceId('src-sample'),
        displayName: '示例：销售明细',
        kind: 'sample',
        warnings: [],
        missing: false,
      },
      tables: [],
      warnings: [],
    })
  }

  override bind(request: AskDataBindRequest, _signal?: AbortSignal): Promise<AskDataBindLease> {
    return Promise.resolve({
      binding: {
        sourceId: request.sourceId,
        connectionRef: AskDataConnectionRef('ask-data:src-1'),
        displayName: 'a.csv',
        readonly: true,
      },
      rollback: () => Promise.resolve(),
    })
  }
}

describe('AskData seam', () => {
  it('registers a subclass as ctx.askData and leaves with its fiber', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(StubAskData)
    await fiber.await()
    expect(ctx.get('askData')).toBeInstanceOf(StubAskData)
    await expect(ctx.get('askData')!.listSources()).resolves.toEqual([])
    await fiber.dispose()
    expect(ctx.get('askData')).toBeUndefined()
  })

  it('carries the business code and optional rule id on AskDataError', () => {
    const failure = new AskDataError('file-too-large', 'too big', { ruleId: 'file-size', limit: 3 })
    expect(failure.name).toBe('AskDataError')
    expect(failure.code).toBe('file-too-large')
    expect(failure.details.ruleId).toBe('file-size')
    expect(failure.details.limit).toBe(3)
    expect(failure).toBeInstanceOf(Error)
    const bare = new AskDataError('bind-failed', 'no details')
    expect(bare.details).toEqual({})
  })

  it('brands source and connection ids', () => {
    expect(AskDataSourceId('src-1')).toBe('src-1')
    expect(AskDataConnectionRef('ask-data:src-1')).toBe('ask-data:src-1')
  })

  it('folds ask-data/bound into the projection and ignores other events', () => {
    const bound = {
      sourceId: 'src-1',
      connectionRef: 'ask-data:src-1',
      displayName: 'a.csv',
      readonly: true,
    }
    expect(askDataBindingProjectionDefinition.init()).toBeNull()
    const fold = askDataBindingProjectionDefinition.apply
    expect(fold(null, {
      type: 'ask-data/bound',
      data: bound,
    } as never)).toEqual(bound)
    expect(fold(bound, {
      type: 'session/title',
      data: { title: 'x' },
    } as never)).toEqual(bound)
    expect(askDataBindingProjectionDefinition.wire.view(bound)).toEqual(bound)
    expect(askDataBindingProjectionDefinition.key).toBe('askDataBinding')
    expect(askDataBindingProjectionDefinition.stateVersion).toBe(1)
  })
})
