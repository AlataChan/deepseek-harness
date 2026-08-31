/**
 * octopus_DSH desktop ask-data Provider: `ctx.askData` over a profile-home
 * manifest plus data-agent 0.1.3 connections.
 * @module @deepseek-ai/dsh-experimental-desktop-ask-data
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { AskData } from '@deepseek-ai/dsh-host-ask-data'
import { askDataBindingProjectionDefinition } from '@deepseek-ai/dsh-host-ask-data'
import type {
  AskDataBindLease, AskDataBindRequest, AskDataImportPreview, AskDataImportSpreadsheetRequest,
  AskDataSource,
} from '@deepseek-ai/dsh-host-ask-data'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { bindSource } from './bind.ts'
import { renderAskDataLimitsPrompt } from './prompt-limits.ts'
import { importSampleSource, importSpreadsheetSource, listAllSources } from './sources.ts'

/** Validated plugin configuration. */
export interface Config {
  /**
   * Absolute data-sources directory. When omitted, uses the companion-resolved
   * profile home: `{dshHome}/profiles/desktop/data-sources`.
   */
  dataHome?: string
}

/** The `ctx.askData` desktop implementation. */
export default class DesktopAskData extends AskData {
  static inject = ['sessionProjections', 'systemPrompt']

  /**
   * Optional override of the profile-home data-sources directory. Default
   * follows the same resolver companion already uses (`dshHomePath`).
   */
  static Config: z<Config> = z.object({
    dataHome: z.string().default(''),
  })

  private readonly dataHome: string

  /**
   * @param ctx - Host context that registers this service.
   * @param config - validated data-home override.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.dataHome = config.dataHome === undefined || config.dataHome === ''
      ? dshHomePath('profiles', 'desktop', 'data-sources')
      : config.dataHome
    ctx.sessionProjections.register(askDataBindingProjectionDefinition)
    ctx.systemPrompt.section({
      name: 'ask-data:limits',
      order: 90,
      text: (context) => {
        const session = context.agent?.session
        if (session === undefined) return ''
        const binding = ctx.sessionProjections.stateOf(session, 'askDataBinding')
        if (binding == null) return ''
        return renderAskDataLimitsPrompt()
      },
    })
  }

  /**
   * List overlay-managed sources plus unmatched data-agent connections.
   * @param signal - caller lifetime; abort stops the listing.
   * @returns listed sources.
   */
  override listSources(signal?: AbortSignal): Promise<AskDataSource[]> {
    signal?.throwIfAborted()
    return listAllSources(this.ctx, this.dataHome)
  }

  /**
   * Import one spreadsheet into a managed sqlite and manifest row.
   * @param request - filename, decoded bytes, optional replace target.
   * @param signal - caller lifetime; abort stops the import.
   * @returns preview read from the written sqlite.
   */
  override importSpreadsheet(
    request: AskDataImportSpreadsheetRequest,
    signal?: AbortSignal,
  ): Promise<AskDataImportPreview> {
    return importSpreadsheetSource(
      this.dataHome,
      request.filename,
      request.bytes,
      request.replaceSourceId,
      signal,
    )
  }

  /**
   * Copy the packaged sample sqlite into the manifest.
   * @param signal - caller lifetime; abort stops the copy.
   * @returns preview of the copied sqlite.
   */
  override importSample(signal?: AbortSignal): Promise<AskDataImportPreview> {
    return importSampleSource(this.dataHome, signal)
  }

  /**
   * Bind one listed source to an already-created Session.
   * @param request - source and session identities.
   * @param signal - caller lifetime; abort stops the bind.
   * @returns a lease whose rollback undoes this bind.
   */
  override bind(request: AskDataBindRequest, signal?: AbortSignal): Promise<AskDataBindLease> {
    return bindSource(this.ctx, this.dataHome, request, signal)
  }
}
