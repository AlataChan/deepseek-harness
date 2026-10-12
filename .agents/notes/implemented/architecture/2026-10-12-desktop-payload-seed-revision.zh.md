# Agent Note: 当随包修订未变时跳过桌面负载重播种

Status: implemented

[English](2026-10-12-desktop-payload-seed-revision.md) | 中文

## 问题

每次桌面启动都会删除并重新拷贝 `resources/profile-plugins/` 到 `$DSH_HOME/profiles/desktop/node_modules/`、`resources/bundled-skills/` 到 `$DSH_HOME/skills/`。随包负载有 12,981 个文件 / 172 MB，这次拷贝占满了 Windows 冷启动：WebView 在 `control/ready` 之前放弃，首页报 `desktop companion handshake timed out`。拷贝还会重写 companion 紧接着加载的模块文件，所以热文件缓存毫无收益。

拷贝是为升级而存在的——更新的安装包必须替换已安装的副本——但没有任何东西记录已安装树携带的是哪个负载，外壳分不清「负载相同」与「负载已变」，只能无条件拷贝。

## 决策

`scripts/write-seed-rev.mjs` 按排序后的相对路径顺序哈希 `profile-plugins/` 与 `bundled-skills/` 下每个文件的路径与字节，写出 `resources/seed-rev.txt`（64 个小写十六进制字符）。`scripts/build-exe.mjs` 在两个播种阶段之后运行它，`scripts/build-dmg.sh` 对 `.app` 也在同样的阶段之后运行，且两处负载检查都拒绝缺失、为空或非十六进制的修订，因此编译期占位文件无法通过。

启动时外壳读取 `resources/seed-rev.txt`；缺失、为空或格式错误的值等同于没有修订，每个阶段都会拷贝，构建未暂存播种树时也一样。只有当已安装树带着与修订相等的 `.dsh-seed-rev` 戳且仍然完整时，某个阶段才跳过拷贝：

- profile：`package.json` 可解析并在 `dependencies` 中列出每个随包包，且 `cordis.patch.yml` 与 `pnpm-workspace.yaml` 存在；
- 技能：每个随包技能仍有 `SKILL.md`。

每个戳只在该阶段的所有拷贝都成功之后、且打包修订存在时才写入；拷贝失败不留下戳，因此下次启动会修复它。符号链接形式的戳既不被信任，也不会被写入穿透。`heal_desktop_profile_file` 每次启动仍然运行，因为 `dsh-client-app` / `dsh-context` 的遗留重写不能等负载变化（[遗留 profile 修复](../bug-fix/2026-08-30-desktop-leftover-profile-heal.zh.md)）。每次启动向 `companion.log` 追加一行，写明修订以及每个阶段是重播种、跳过还是未找到暂存树。

用户删除的 bundle 列表项不会强制重播种：重播种本身也不会把已删除的 bundle 放回来，所以跳过与拷贝行为一致。

## 验证

| 覆盖面 | 位置 |
|---|---|
| 戳决策：修订缺失、匹配、过期；目标缺失、清单缺失、依赖缺失、模板文件缺失；`SKILL.md` 缺失；戳为符号链接 | `apps/desktop/src-tauri/src/app.rs` 的 `app::tests::…` |
| 修订文本校验（空、大写、过短、非十六进制） | 同一模块 |
| 修订稳定性与单字节敏感性；两个构建脚本都调用记录器 | `scripts/verify-desktop-exe.spec.ts` |
| 已安装树携带 64 位十六进制的 `resources/seed-rev.txt` | `scripts/verify-desktop-exe.mjs` |
| Windows runner 执行播种测试 | `.github/workflows/desktop-windows.yml` 在具名的 runtime 与 carrier 测试旁运行 `cargo test --lib app::tests::` |

macOS 的 `verify-desktop-bundle.sh` 路径未变。

## 备选方案

**比较已安装文件的 mtime 或大小。** 否决：同版本重建会恢复相同大小，`copy_dir_recursive` 不保留 mtime，而部分失败的拷贝会留下看起来仍然最新的条目。

**提高 WebView 截止时间并保留无条件拷贝。** 否决：这次拷贝是 Windows 冷启动的主要成本；更长的截止时间是在容忍成本，而不是消除它。

**先写戳再拷贝，让被打断的启动也能标记负载。** 否决：拷贝中途崩溃会留下有戳但损坏的 profile，下次启动就会跳过修复。

**把用户删除的 `dsh.profile.bundles` 条目视为 profile 不完整。** 否决：重播种同样不会恢复已删除的 bundle 列表项，更严格的检查只会让每次启动都强制拷贝，却恢复不了任何东西。

**把 harness 树也纳入戳。** 否决：harness 暂存在播种树之外，外壳从不把它拷进 `$DSH_HOME`；它的版本已经随运行时清单传递。

## 后果

- 安装包与已安装修订一致时，第二次启动跳过两次拷贝；首次启动与每次负载升级仍执行完整拷贝。
- 修订由内容派生，因此同版本重建、钉版本变化或一个技能字节变化都会强制拷贝；戳无法掩盖负载变化。
- 外壳对 `seed-rev.txt` 的信任由形状（64 个小写十六进制字符）加完整性检查界定；打包门负责让生产者保持诚实。
- 已安装树现在携带两个戳文件，profile 下的与 `$DSH_HOME/skills` 下的 `.dsh-seed-rev`；删除戳或删除某个随包技能，只会重新触发拷贝。
