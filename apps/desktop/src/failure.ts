/** User-facing copy for desktop resolve and handshake failures. */

/** Headline and supporting line shown on home and in Settings. */
export interface DesktopFailureCopy {
  /** One sentence the user can act on. */
  headline: string
  /** Extra context; omit internals when the headline is enough. */
  detail: string
}

/**
 * Translate a resolve or handshake failure into product copy.
 * @param reason - raw shell or CLI message.
 * @returns headline and optional detail for home and Settings.
 */
export function describeDesktopFailure(reason: string): DesktopFailureCopy {
  if (/dsh\.companions\.desktop/u.test(reason)) {
    return {
      headline: '当前运行时打不开桌面会话。',
      detail: '源码启动会自动用本仓库。若仍出现这条，请先在本仓库构建 CLI。',
    }
  }
  if (/companion entry is missing/u.test(reason)) {
    return {
      headline: '这个仓库还没有构建完成。',
      detail: '先构建桌面 companion，再点「开始」。',
    }
  }
  if (/Node executable was not found/u.test(reason)) {
    return {
      headline: '没有找到 Node.js。',
      detail: '请安装 Node.js 22.19 或更新版本，并保证系统能运行 node。',
    }
  }
  if (/workspaceRoot is not configured/u.test(reason)) {
    return {
      headline: '还没选工作文件夹。',
      detail: '请选择这个窗口要读写的文件夹。',
    }
  }
  const stripped = reason
    .replace(/^installed-runtime CLI failed:\s*/u, '')
    .replace(/\s*\(exit \d+\)\s*$/u, '')
  return {
    headline: '这个窗口没能开始会话。',
    detail: stripped,
  }
}
