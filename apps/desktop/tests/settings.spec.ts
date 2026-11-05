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
    expect(copy.headline).toBe('当前运行时打不开桌面会话。')
    expect(copy.detail).not.toMatch(/runtimePath|nodePath/)
  })

  it('names a missing Node install without a raw PATH lecture', () => {
    const copy = describeDesktopFailure('Node executable was not found')
    expect(copy.headline).toBe('没有找到 Node.js。')
    expect(copy.detail).toBe('请安装 Node.js 24.9.0 或更新版本，并保证系统能运行 node。')
  })

  it('names an unsupported Node runtime with the 24.9.0 floor', () => {
    const copy = describeDesktopFailure(
      'Node v22.23.2 is not a supported Harness runtime (>=24.9.0). Install Node.js 24.9.0 or newer (current 24 or 26).',
    )
    expect(copy.headline).toBe('当前 Node.js 版本不受支持。')
    expect(copy.detail).toBe('请安装 Node.js 24.9.0 或更新版本。Node.js 22、23，以及 24.0.0 到 24.8.x 不能用于这个窗口。安装包会自带 Node.js 24.14.0。')
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
    expect(root.textContent).toContain('工作文件夹')
    expect(root.querySelector('.dsh-settings-title')?.textContent).toBe('设置')
    expect(advanced?.querySelector('input[name="nodePath"]')).not.toBeNull()
    expect(advanced?.querySelector('input[name="runtimePath"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="desktop-settings-reason"]')).toBeNull()
  })
})
