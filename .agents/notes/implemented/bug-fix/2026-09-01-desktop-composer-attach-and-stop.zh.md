# Agent Note: Desktop composer attach next-step and Stop

Status: implemented

[English](2026-09-01-desktop-composer-attach-and-stop.md) | 中文

## 问题

加号菜单从传送门 `Menu` 行对裁剪或 `display:none` 的 file input 调用 `HTMLInputElement.click()`。Tauri 2 WebView 会忽略这次编程点击；之后用 `<label htmlFor>` 对准 1px 裁剪 input，本机选择器仍然打不开，因此「添加图片」和「看这份文档」只剩提示条，输入框里也不出现文件。「引用工作区文件（@）」打开 mention 菜单，工作区没有文件时会自动关掉。「添加到知识库」先打开库名单；新建再用同样打不开的选择器，用户到不了选文件。把仅本会话文档框进可见草稿，看不到粘贴图片那种附件预览，模型还得去工作区找文件。停止先走 `sessions.scope(id).get('conversation').cancel()`，再走 `sessions.binding(sessionId)?.session.cancel()`。Host 回答 remote event 会 POST `$events/result`；companion gateway 把 `$` 编成 `%24`，Connection 回 HTTP 404，这次抛错拆掉 IPC，于是 `session/cancel` 带着同一条 404 失败。

## 决策

加号菜单的图片和仅本会话文档行保留可见的选文件控件，点击目标是盖满按钮的 `opacity: 0.01` file input（`inset: 0`，`font-size: 100px`）。不依赖 `click()`，也不依赖 `label[htmlFor]` 加裁剪 input。仅本会话和知识库的 input 不设 HTML `accept`：WebKit 在 UTI / MIME 对不上 `.md` 时会关掉对话框却不交出 File。监听绑在元素自己的 `change` / `input` 上，不走 React 根委托。选完后 FileList 仍空会 toast，避免再 silently 丢掉。Markdown / TXT 先 `File.text()`，失败再走 FileReader。选中的图片留在附件轨。选中的仅本会话文档以 composer 芯片保存（文件名、去掉），发送时才框进即将发出的 `{ type: 'text' }`，不写入可见草稿。flush 返回这段框文本，`submit` 直接用它，因为同一 tick 里编辑器投影仍可能是手打草稿。Word 由 Host 从 `word/document.xml` 解出。Client 工厂不得 `require("module")`。只有芯片也算可发送。@ 行仍打开工作区 mention 菜单，列表消失时给出说明。加号菜单的知识库占位把 `LibraryPicker` 直接开在上传面板。新建和添加文档切到该面板；选文件是同一套覆盖 input。首页芯片仍打开库名单。停止调用 `sessions.binding(sessionId)?.session.cancel()`。companion 的 `acceptRpc` 对已合法的 Connection 段保持字面量，因此 `$events/result` 仍是 `/api/$events/result`。非 2xx 的 Connection fetch 回一条失败的 `server-response`，不断开通道。远端失败仍写入 `promptError`。普通运行中会话在草稿可发送时，在 Send 旁边保留独立 Stop。官方 `desktop-app` 不变。

## 备选方案

**Tauri 原生文件对话框。** 否决：`apps/desktop` 不得扩张产品逻辑，桌面 README 保持浏览器选择器。

**扩展图片附件或为仅本会话文档新增 ContentBlock。** 否决：仅本会话正文已经走 `user/message` 的 `{ type: 'text' }`。

**只在空草稿主按钮上保留 Stop。** 否决：抽出文档会变成可发送芯片并藏掉取消。见[运行中草稿取得主 Send](2026-08-20-running-draft-primary-send.zh.md)。

**对每个 RPC 路径段做 `encodeURIComponent`。** 否决：`$` 在 Connection 的 `ENDPOINT_SEGMENT_PATTERN` 里合法。编码后 `$events/result` 会 404，并拆掉 gateway。

## 影响

用户在加号菜单选图片、仅本会话文档、知识库之后能点到真正打开本机选择器的控件。仅本会话文件像粘贴图片一样出现在输入框芯片里，发送时变成框文本。@ 仍引用工作区文件，并说明空列表。停止能打到 Host 中止，composer 不再因此抛错，`$events/result` 404 也不会拆掉 companion。覆盖面是 `packages/client/ui-conversation/tests/input-bar.client.spec.tsx`、`packages/client/ui-conversation/tests/apply-inject.client.spec.tsx`、`packages/experimental/desktop-ask-knowledge/tests/library-picker.client.spec.tsx`、`packages/experimental/desktop-ask-knowledge/tests/apply.client.spec.ts` 和 `packages/client/connection-process/tests/host-gateway.host.spec.ts`。
