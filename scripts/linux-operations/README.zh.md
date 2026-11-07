# Linux 运维工具

[English](README.md) | 中文

## 概述

这些可选服务端工具将受沙箱约束的 DSH Agent 接入操作范围固定的 Unix socket 运维服务，以及现有 Gamma 微信桌面 worker。它们不进入桌面默认启动组合或 DMG，由管理员在 Linux 主机上单独安装；模型不会获得 sudo 或通用 Podman 权限。

## 指令与权限

使用 host_status、service_status、service_logs、wechat_status 和 wechat_screenshot 进行检查。服务别名、可重启容器与唯一微信收件人由管理员配置。worker 的 ready 心跳只是界面观察，不证明网络投递成功。

修改操作由 prepare 冻结重启、文字消息或受限配置。本人在飞书回复“确认执行 <编号>”后，execute 核对真实入口 SQLite 消息及未撤销绑定。预览后不能替换参数。完整结构化指令“重启服务 <别名>”“重启容器 <名称>”，以及“微信发送 <别名>”后换行写完整正文，只授权当前这条消息，不再重复确认。

set_limits 只修改 logLines 和 previewSeconds，并持久保存备份。restore_limits 在重新确认后恢复已完成修改，配置在预览后发生变化则拒绝执行。不提供任意命令、路径、微信号、凭据编辑或目标白名单修改。

微信任务在获得 worker 回执前只是排队状态。sent_verified 表示已核对发送端界面及完整正文，不代表对方收到或已读。执行结果不确定时转为 needs_review，绝不自动重发。适配入口保留原每日 tick、daemon 锁和账号锁，临时消息使用独立的 outbox 与回执空间。

## 安装与测试

使用 npm ci --prefix scripts/linux-operations --ignore-scripts --no-audit --no-fund 安装独立且锁定版本的 MCP 适配器依赖，使用 pnpm run test:linux-operations 执行 Node 测试。Python 测试要求 PYTHONPATH 指向真实 Gamma 源码，运行 python3 -m unittest discover -s scripts/linux-operations/tests -p 'test_*.py' -v；只替换桌面，不替换原队列事务。

install.py 仅供管理员在现有 Octopus/Gamma 主机布局安装，--source、--runtime 和 --node 必须显式提供绝对路径。安装器创建版本化的 root 工具目录、配置、日志和 systemd 服务，并在服务端 profile 增加 MCP。它保留原 Gamma 源码并保存部署备份，将 worker 入口替换为适配入口，不重启微信登录容器；刷新飞书入口前等待当前人工任务完成。

凭据保留在原有仅 root 可读的环境文件中，不复制到这些工具。broker socket 目录归 root 所有，组为专用 Agent 组，操作日志仅 root 可读。有限日志会脱敏常见凭据赋值和 Bearer 字符串；管理员仍应避免在日志中输出秘密。

好友名片的 OCR 兼容处理要求在现有微信交换目录的 config/octopus-friend-label.png 保存管理员核验且归 root 所有的锚点。它只通过唯一像素匹配补足“朋友资料”这个非身份标签，OCR 将微信号标签与值分开时，只选唯一且对齐的精确微信号值作为复制目标；原有本人及收件人微信号的剪贴板精确比对、头像锚点和群聊拒绝仍保留；缺少锚点或锚点可被其他用户修改时拒绝安装。

## 恢复与验收

从 profile 移除工具前先停止入口。恢复已备份的 profile 并移除 worker 的 systemd drop-in，即可回到原 worker。检查活动投递后再重启 worker、broker 和入口，保留不确定回执用于核实；不得清空回执强制重试。

本地假桌面测试不证明真实微信发送。生产验收另行检查 root/组权限、安装后的 MCP 协商、真实模型只读调用、账号与联系人身份预检，以及本人授权的真实消息。安装成功本身不会向生产联系人发送测试消息。
