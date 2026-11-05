/**
 * Status sentences for desktop operation.
 * Host publication and the client helper both read this object.
 * @module @deepseek-ai/dsh-experimental-desktop-operation/copy
 */

/** One locale's status sentences. */
export interface DesktopOperationCopy {
  /** Host is not macOS Apple Silicon. */
  readonly platformUnsupported: string
  /** macOS has not granted a permission this app will not change. */
  readonly permissionDenied: string
  /** Status did not return a permission payload. The preset stays registered. */
  readonly statusUnavailable: string
}

/** Locale ids this package publishes. */
export type DesktopOperationLocale = 'en' | 'zh'

/** English and Chinese status sentences. */
export const desktopOperationCopy = {
  en: {
    platformUnsupported: 'Desktop operation is available on macOS Apple Silicon only.',
    permissionDenied: 'Desktop operation cannot use a permission that macOS has not granted. This app will not change that permission.',
    statusUnavailable: 'Desktop operation could not read agent-desktop status. The preset stays registered and this app will not change macOS permissions.',
  },
  zh: {
    platformUnsupported: '桌面操作仅支持搭载 Apple 芯片的 macOS。',
    permissionDenied: '桌面操作无法使用系统尚未授予的权限。本应用不会更改该权限。',
    statusUnavailable: '桌面操作未能读到 agent-desktop 的状态。预设仍会登记，本应用不会更改系统权限。',
  },
} as const satisfies Record<DesktopOperationLocale, DesktopOperationCopy>
