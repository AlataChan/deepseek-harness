/** Settings panel. Workspace is the product field; Node and Harness stay in Advanced. */

import { describeDesktopFailure } from './failure.ts'
import { parseRuntimeConfigFields, type DesktopShellPort } from './harness-port.ts'

/** Persisted Node, Harness, and workspace fields. */
export interface RuntimeConfigFields {
  nodePath?: string
  runtimePath?: string
  workspaceRoot?: string
}

/** Arguments for the settings panel. */
export interface SettingsViewOptions {
  /** Shell port used to persist and reread settings. */
  port: DesktopShellPort
  /** Why the panel is showing. */
  reason: string
  /** Current persisted values. */
  config: RuntimeConfigFields
  /** Whether a companion is live in this page (workspace change confirms). */
  companionLive?: boolean
  /**
   * Called after a successful save when the page should retry without reload.
   * @param config - merged persisted values.
   */
  onRetry?: (config: RuntimeConfigFields) => void | Promise<void>
}

function fieldValue(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name)
  return typeof value === 'string' ? value.trim() : ''
}

function closeSettings(root: HTMLElement): void {
  root.querySelector('[data-testid="desktop-settings-layer"]')?.remove()
}

function appendField(
  parent: HTMLElement,
  name: 'nodePath' | 'runtimePath' | 'workspaceRoot',
  label: string,
  hint: string,
  value: string,
): void {
  const wrap = document.createElement('label')
  wrap.className = 'dsh-settings-field'
  const title = document.createElement('span')
  title.textContent = label
  const input = document.createElement('input')
  input.name = name
  input.value = value
  input.autocomplete = 'off'
  const note = document.createElement('span')
  note.className = 'dsh-settings-hint'
  note.textContent = hint
  wrap.append(title, input, note)
  parent.append(wrap)
}

/**
 * Open the settings panel over the current page. The page underneath stays mounted.
 * @param root - mount element that already hosts home or the Client tree.
 * @param options - current values and save behavior.
 * @returns nothing; the panel is appended to `root`.
 */
export function renderSettings(root: HTMLElement, options: SettingsViewOptions): void {
  closeSettings(root)
  const copy = describeDesktopFailure(options.reason)
  const layer = document.createElement('div')
  layer.className = 'dsh-settings-layer'
  layer.dataset.testid = 'desktop-settings-layer'
  layer.addEventListener('click', (event) => {
    if (event.target === layer) closeSettings(root)
  })

  const form = document.createElement('form')
  form.className = 'dsh-settings'
  form.dataset.testid = 'desktop-settings'
  form.addEventListener('click', (event) => { event.stopPropagation() })

  const head = document.createElement('div')
  head.className = 'dsh-settings-head'
  const title = document.createElement('h2')
  title.className = 'dsh-settings-title'
  title.textContent = '设置'
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'dsh-settings-close'
  close.textContent = '关闭'
  close.addEventListener('click', () => { closeSettings(root) })
  head.append(title, close)
  form.append(head)

  if (options.reason !== '' && options.reason !== 'Desktop settings') {
    const headline = document.createElement('p')
    headline.className = 'dsh-settings-headline'
    headline.dataset.testid = 'desktop-settings-reason'
    headline.textContent = copy.headline
    const detail = document.createElement('p')
    detail.className = 'dsh-settings-reason'
    detail.textContent = copy.detail
    form.append(headline, detail)
  }

  appendField(
    form,
    'workspaceRoot',
    '工作文件夹',
    '这个窗口读写哪个文件夹。默认是你的用户目录。',
    options.config.workspaceRoot ?? '',
  )

  const advanced = document.createElement('details')
  advanced.className = 'dsh-settings-advanced'
  advanced.dataset.testid = 'desktop-settings-advanced'
  const summary = document.createElement('summary')
  summary.textContent = '高级'
  advanced.append(summary)
  appendField(
    advanced,
    'nodePath',
    'Node 程序',
    '留空则使用系统里的 node。',
    options.config.nodePath ?? '',
  )
  appendField(
    advanced,
    'runtimePath',
    'Harness 程序包',
    '留空则使用本机已安装的运行时。',
    options.config.runtimePath ?? '',
  )
  form.append(advanced)

  const submit = document.createElement('button')
  submit.type = 'submit'
  submit.className = 'dsh-settings-save'
  submit.textContent = '保存'
  form.append(submit)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void (async () => {
      if (options.companionLive === true
        && !window.confirm('窗口正在运行。保存后会重新加载，确定吗？')) {
        return
      }
      const saved = parseRuntimeConfigFields(await options.port.invoke('runtime_configure', {
        nodePath: fieldValue(form, 'nodePath'),
        runtimePath: fieldValue(form, 'runtimePath'),
        workspaceRoot: fieldValue(form, 'workspaceRoot'),
      }))
      if (options.companionLive === true) {
        window.location.reload()
        return
      }
      closeSettings(root)
      if (options.onRetry !== undefined) {
        await options.onRetry(saved)
        return
      }
      window.location.reload()
    })()
  })
  layer.append(form)
  root.append(layer)
}

/**
 * Attach the always-visible settings control that reloads after a confirmed save.
 * @param root - application root that already hosts the Client tree.
 * @param options - port and the values shown when the form opens.
 * @returns nothing; the control is appended to `root`.
 */
export function attachSettingsButton(root: HTMLElement, options: {
  port: DesktopShellPort
  config: RuntimeConfigFields
}): void {
  if (root.querySelector('[data-testid="desktop-settings-open"]') !== null) return
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'dsh-settings-open'
  button.dataset.testid = 'desktop-settings-open'
  button.textContent = '设置'
  button.addEventListener('click', () => {
    void options.port.invoke('runtime_get_config').then((value) => {
      const config = parseRuntimeConfigFields(value)
      renderSettings(root, {
        port: options.port,
        reason: 'Desktop settings',
        config,
        companionLive: true,
      })
    })
  })
  root.append(button)
}
