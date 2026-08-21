# TUI agent

[English](README.md) | 中文

此示例通过真实的 `dsh` 启动器与 Cordis Loader 验证随发行版交付的交互式终端 profile。它是一个 overlay，因此应用仍是生产 `tui` profile，而不是仅供测试手动挂载的树。

## 运行

在仓库根目录安装依赖并启动终端客户端：

```sh
pnpm install
pnpm dsh
```

默认命令会启动新的 Session。使用 `pnpm dsh --resume` 选择最近的 Session，或使用 `pnpm dsh --resume <session-id>` 直接恢复指定 Session。stdin 与 stdout 必须都是交互式终端；非交互式自动化请使用 `pnpm dsh exec "task"`。

[cordis.yml](cordis.yml) 中的生产 overlay 选择纯 JSONL 持久化，以便直接检查示例 transcript。[cordis.snapshot.yml](cordis.snapshot.yml) 在无密钥终端快照中用确定性 replay 替换真实模型。

## 终端控制

- Enter 提交；Ctrl+J 插入换行。
- Ctrl+R 或 `/resume` 打开有数量上限的 Session 选择器。
- Ctrl+C 会取消进行中的工作。空闲时，它先清除非空草稿，再由空草稿状态下的一次按键退出。
- Escape 关闭 overlay 或拒绝当前交互。
- `/help` 列出命令，`/exit` 保存并退出。

e2e 测试会通过 Loader 启动真实生产 overlay。无密钥 smoke 验证帮助信息与终端状态的干净恢复；真实模型 smoke 在缺少 `DEEPSEEK_API_KEY` 时自动跳过。三个 replay 场景固定验证 transcript、审批与问题交互、取消、持久化和终端关闭行为。
