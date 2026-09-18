import { describe, expect, it } from 'vitest'
import {
  KNOWN_UNDECLARED,
  classifyUndeclared,
  collectDeclaredTokens,
  collectReferencedTokens,
  scanClientCssTokens,
  stripCssComments,
  undeclaredTokensIn,
} from './verify-client-css-tokens.ts'

describe('Client CSS token check', () => {
  it('ignores documentation that looks like a token use', () => {
    const source = stripCssComments(`
      /* var(--dsw-elevation-*) and var(--dsw-alias-missing) stay comments */
      .ok { color: var(--dsw-alias-label-primary); }
    `)
    expect([...collectReferencedTokens(source)]).toEqual(['--dsw-alias-label-primary'])
  })

  it('treats a phantom alias as undeclared against a theme fixture', () => {
    const declared = collectDeclaredTokens(':root { --dsw-alias-label-primary: #111; }')
    expect(undeclaredTokensIn(
      'packages/experimental/example/src/client/Panel.module.css',
      '.panel { background: var(--dsw-alias-bg-elevated, #fff); color: var(--dsw-alias-label-primary); }',
      declared,
    )).toEqual([{
      file: 'packages/experimental/example/src/client/Panel.module.css',
      token: '--dsw-alias-bg-elevated',
    }])
  })

  it('rejects a new pair and a stale allowlist row', () => {
    const { fresh, stale } = classifyUndeclared(
      [{ file: 'packages/a/b/src/x.css', token: '--dsw-alias-new' }],
      ['packages/a/b/src/gone.css::--dsw-alias-old'],
    )
    expect(fresh).toEqual([{ file: 'packages/a/b/src/x.css', token: '--dsw-alias-new' }])
    expect(stale).toEqual(['packages/a/b/src/gone.css::--dsw-alias-old'])
  })

  it('keeps repaired workbench sheets off the allowlist and free of phantoms', () => {
    const workbench = [
      'packages/experimental/desktop-ask-knowledge/src/client/LibraryPicker.module.css',
      'packages/experimental/desktop-ask-data/src/client/DataSourcePage.module.css',
    ]
    expect(KNOWN_UNDECLARED.some(row => workbench.some(file => row.startsWith(`${file}::`)))).toBe(false)
    const { undeclared } = scanClientCssTokens()
    expect(undeclared.filter(item => workbench.includes(item.file))).toEqual([])
  })
})
