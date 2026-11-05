/** Locale sentences the preset card can show. */
import { describe, expect, it } from 'vitest'
import { desktopOperationLocales } from '../src/client/locales.ts'
import { desktopOperationStatusText } from '../src/client/status.ts'

describe('desktop-operation status copy', () => {
  it('matches the English and Chinese sentences', () => {
    expect(desktopOperationStatusText('ready', 'en')).toBe('')
    expect(desktopOperationStatusText('ready', 'zh')).toBe('')
    expect(desktopOperationStatusText('platform-unsupported', 'en')).toBe('Desktop operation is available on macOS Apple Silicon only.')
    expect(desktopOperationStatusText('platform-unsupported', 'zh')).toBe('桌面操作仅支持搭载 Apple 芯片的 macOS。')
    expect(desktopOperationStatusText('permission-denied', 'en')).toBe('Desktop operation cannot use a permission that macOS has not granted. This app will not change that permission.')
    expect(desktopOperationStatusText('permission-denied', 'zh')).toBe('桌面操作无法使用系统尚未授予的权限。本应用不会更改该权限。')
    expect(desktopOperationStatusText('status-unavailable', 'en')).toBe('Desktop operation could not read agent-desktop status. The preset stays registered and this app will not change macOS permissions.')
    expect(desktopOperationStatusText('status-unavailable', 'zh')).toBe('桌面操作未能读到 agent-desktop 的状态。预设仍会登记，本应用不会更改系统权限。')
    expect(desktopOperationLocales.zh.platformUnsupported).toBe(desktopOperationStatusText('platform-unsupported', 'zh'))
    expect(desktopOperationLocales.en.permissionDenied).toBe(desktopOperationStatusText('permission-denied', 'en'))
  })
})
