/** Overlay invariant companion registers package ownership. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/invariant.ts'

describe('desktop-ask-knowledge invariant', () => {
  it('registers the package and names the companion', async () => {
    const ctx = new Context()
    const registered: string[] = []
    ctx.provide('invariants', {
      register: (pkg: string, install?: () => void) => {
        registered.push(pkg)
        install?.()
        return () => {}
      },
    })
    expect(name).toBe('experimental-desktop-ask-knowledge-invariant')
    expect(inject).toEqual(['invariants'])
    await apply(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-experimental-desktop-ask-knowledge'])
  })
})
