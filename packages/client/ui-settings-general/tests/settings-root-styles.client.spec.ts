import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SettingsRoot.module.css', import.meta.url)), 'utf8')

describe('SettingsRoot responsive styles', () => {
  it('uses one content column at VS Code Activity Bar widths', () => {
    const narrow = /@media \(max-width: 640px\) \{([\s\S]*)\n\}/u.exec(css)?.[1]

    expect(narrow).toBeDefined()
    expect(narrow).toMatch(/\.panel\s*\{[^}]*flex-direction:\s*column;/u)
    expect(narrow).toMatch(/\.nav\s*\{[^}]*width:\s*100%;/u)
    expect(narrow).toMatch(/\.navList\s*\{[^}]*flex-direction:\s*row;/u)
    expect(narrow).toMatch(/\.content\s*\{[^}]*min-height:\s*0;/u)
  })
})
