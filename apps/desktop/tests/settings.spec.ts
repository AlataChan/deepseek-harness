/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { describeDesktopFailure } from '../src/failure.ts'
import { renderSettings } from '../src/settings.ts'
import type { DesktopShellPort } from '../src/harness-port.ts'

function unusedPort(): DesktopShellPort {
  return {
    invoke: async () => ({}),
    createChannel: () => ({}),
  }
}

describe('describeDesktopFailure', () => {
  it('does not ask the user to type a Harness path for a PATH package without desktop', () => {
    const copy = describeDesktopFailure(
      'installed-runtime CLI failed: Harness package does not declare dsh.companions.desktop (exit 1)',
    )
    expect(copy.headline).toBe('The Harness on PATH cannot open a desktop session.')
    expect(copy.detail).not.toMatch(/runtimePath|nodePath/)
  })

  it('names a missing Node install without a raw PATH lecture', () => {
    expect(describeDesktopFailure('Node executable was not found').headline).toBe('Node.js was not found.')
  })
})

describe('renderSettings', () => {
  it('shows workspace first and keeps Node and Harness under Advanced', () => {
    const root = document.createElement('div')
    renderSettings(root, {
      port: unusedPort(),
      reason: 'Desktop settings',
      config: { workspaceRoot: '/Users/apple' },
    })
    const workspace = root.querySelector('input[name="workspaceRoot"]')
    const advanced = root.querySelector('[data-testid="desktop-settings-advanced"]')
    expect(workspace).not.toBeNull()
    expect(advanced?.querySelector('input[name="nodePath"]')).not.toBeNull()
    expect(advanced?.querySelector('input[name="runtimePath"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="desktop-settings-reason"]')).toBeNull()
  })
})
