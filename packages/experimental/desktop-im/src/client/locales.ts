/** Locale-owned desktop IM setup copy. */
export const NS = 'desktop-im'
/** English setup labels. */
export const en = {
  browse: 'Choose workspace folder',
  nav: 'IM integrations', title: 'IM integrations', intro: 'Receive private messages in Feishu or DingTalk and reply from this desktop. Keep the app open while connected.',
  feishu: 'Feishu', dingtalk: 'DingTalk', appId: 'App ID / Client ID', secret: 'App Secret / Client Secret',
  secretSaved: 'Secret saved. Leave blank to keep it.', tenantId: 'Organization ID', chatId: 'Authorized private chat ID', senderId: 'Authorized user ID',
  cwd: 'Workspace folder', provider: 'Model provider', model: 'Model', save: 'Save settings', test: 'Test connection', enable: 'Enable', disable: 'Disable',
  off: 'Off', connecting: 'Connecting', connected: 'Connected', error: 'Needs attention', loading: 'Loading settings', retry: 'Retry',
  failed: 'The operation failed. Check the saved settings, app permissions and network, then retry.',
  permissions: 'Only the exact organization, private chat and user below can run tasks. The assistant uses this desktop user’s file and tool permissions.',
  setupFeishu: 'In the Feishu developer console, create an internal app, enable the bot, subscribe to im.message.receive_v1 using a long connection, grant message receive/send permissions and publish the app.',
  setupDingtalk: 'In the DingTalk developer console, create an internal bot, select Stream mode, enable private-chat messages, grant reply permissions and publish it.',
  identityHelp: 'Use tenant_key, chat_id and sender_id.open_id for Feishu; senderCorpId, conversationId and senderId for DingTalk. Copy these from a private-message event in your app’s developer console.',
  approval: 'Existing tool approval rules still apply. This integration does not accept approval commands or card buttons from IM.',
  configured: 'Saved settings', saved: 'Settings saved; connection is off', tested: 'Connection test passed; no tasks were run', enabled: 'IM enabled', disabled: 'IM disabled',
  failureStartup: 'Connection failed. Check the app credentials, permissions and network.',
  failureDelivery: 'A task or reply failed or has an uncertain result. Check its conversation before retrying.',
  failureStorage: 'IM settings could not be read or saved. Check local file permissions before restarting.',
  failureShutdown: 'The connection could not stop cleanly. Restart the desktop before enabling it again.',
  choose: 'Select a provider', customModel: 'Enter a model ID if the provider has no catalog',
}
/** Typed keys shared by both locale dictionaries. */
export type ImLocaleKey = keyof typeof en
/** Simplified Chinese setup labels. */
export const zh: Record<ImLocaleKey, string> = {
  browse: '选择工作目录',
  nav: 'IM 接入', title: 'IM 接入', intro: '通过飞书或钉钉私聊使用桌面助手并接收回复，连接期间请保持应用打开',
  feishu: '飞书', dingtalk: '钉钉', appId: 'App ID / Client ID', secret: 'App Secret / Client Secret',
  secretSaved: '密钥已保存，留空即可保留', tenantId: '组织 ID', chatId: '授权私聊 ID', senderId: '授权用户 ID',
  cwd: '工作目录', provider: '模型服务商', model: '模型', save: '保存设置', test: '测试连接', enable: '启用', disable: '停用',
  off: '未启用', connecting: '连接中', connected: '已连接', error: '需要处理', loading: '加载设置', retry: '重试',
  failed: '操作未完成，请检查已保存的设置、应用权限和网络后重试',
  permissions: '仅下方指定组织、私聊和用户可以发起任务，助手使用当前桌面用户的文件及工具权限',
  setupFeishu: '在飞书开放平台创建企业自建应用，开启机器人，通过长连接订阅 im.message.receive_v1，开通消息接收与发送权限，并发布应用',
  setupDingtalk: '在钉钉开放平台创建企业内部机器人，选择 Stream 模式，开启私聊消息和回复权限，并发布应用',
  identityHelp: '从开发者后台的私聊事件中复制：飞书使用 tenant_key、chat_id、sender_id.open_id；钉钉使用 senderCorpId、conversationId、senderId',
  approval: '现有工具审批规则继续生效，此接入不接受 IM 中的审批指令或卡片按钮',
  configured: '已保存的设置', saved: '设置已保存，连接已停用', tested: '连接测试通过，未执行任何任务', enabled: 'IM 已启用', disabled: 'IM 已停用',
  failureStartup: '连接失败，请检查应用密钥、权限和网络',
  failureDelivery: '有任务或回复失败或结果不确定，请先核对会话，避免重复执行',
  failureStorage: 'IM 设置无法读取或保存，请检查本地文件权限后再重启应用',
  failureShutdown: '连接未能正常停止，请重启桌面应用后再启用',
  choose: '选择服务商', customModel: '服务商无模型列表时可输入模型 ID',
}
