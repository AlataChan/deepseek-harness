/** Ask-data seam invariant companion registers package ownership. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/invariant.ts'

describe('host-ask-data invariant', () => {
  it('registers the package and names the companion', async () => {
    const ctx = new Context()
    const registered: string[] = []
    ctx.provide('invariants', {
      register: (pkg: string) => {
        registered.push(pkg)
        return () => {}
      },
    })
    expect(name).toBe('host-ask-data-invariant')
    expect(inject).toEqual(['invariants'])
    await apply(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-host-ask-data'])
  })
})
