/** Node-half and invariant companion registration. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { apply as hostApply } from '../src/index.ts'
import * as VsCodeInvariant from '../src/invariant.ts'

describe('@deepseek-ai/dsh-client-ui-vscode package faces', () => {
  it('keeps the Host half empty', () => {
    expect(hostApply).toBeTypeOf('function')
    hostApply()
  })

  it('registers an explained empty invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(VsCodeInvariant).await()).resolves.toBeDefined()
  })
})
