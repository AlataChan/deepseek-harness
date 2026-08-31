/** Locale surfaces each name every limits.ts rule id. */

import { describe, expect, it } from 'vitest'
import { ASK_DATA_RULE_IDS } from '../src/limits.ts'
import { LIMIT_LOCALES, LIMIT_SURFACE_KEYS, limitSurface, requiredLimitIds } from '../src/client/limits-copy.ts'

describe('ask-data locale limit surfaces', () => {
  it('exports the same closed id set the Host paragraph uses', () => {
    expect(requiredLimitIds()).toEqual(ASK_DATA_RULE_IDS)
  })

  it('puts every rule id in the four locale surfaces', () => {
    for (const locale of [LIMIT_LOCALES.zh, LIMIT_LOCALES.en]) {
      for (const key of LIMIT_SURFACE_KEYS) {
        const text = limitSurface(locale, key)
        for (const id of ASK_DATA_RULE_IDS) {
          expect(text, `${key} missing ${id}`).toContain(id)
        }
      }
    }
  })
})
