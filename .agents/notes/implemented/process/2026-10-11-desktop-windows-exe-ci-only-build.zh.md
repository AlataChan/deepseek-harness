# Agent Note: 在 CI 专属 Windows runner 上构建桌面安装包

Status: implemented

[English](2026-10-11-desktop-windows-exe-ci-only-build.md) | 中文

## 问题

产品此前只发布一个自包含安装包：由 `scripts/build-dmg.sh` 构建、由 `scripts/verify-desktop-bundle.sh` 把关的 macOS DMG。应用本身没有任何阻碍 Windows 平价的点——Tauri 外壳早已按 `resource_dir()/resources/{node.exe,harness/,profile-plugins/,bundled-skills/,presets/,kb-runtime/,installed-runtime-cli.js}` 解析资源并拒绝 `.cmd`/`.ps1` Node shim——但不存在 Windows 产物，这个 crate 也从未在本仓库里为 Windows 编译过。

两条交叉编译路径都不存在。Tauri 需要 MSVC 工具链、WebView2 和 NSIS 才能产出 Windows bundle；PyInstaller 无法为另一个操作系统冻结 ask-knowledge sidecar。macOS 工作站根本无法产出该产物，这让构建主机成为设计的一部分，而不是实现细节。

## 决策

### 构建主机

`.github/workflows/desktop-windows.yml` 运行在 GitHub 托管的 `windows-2025` 上，仅手动触发，设置 `timeout-minutes: 60` 与 `permissions: contents: read`。它不持久化凭据地检出，用原生 Windows 目标目录安装 pnpm，安装 Node 24、Rust stable 与 Python 3.12，然后依次运行 `pnpm install`（沿用 `ci.yml` 的 ReFS block-clone 分支）、`pnpm run build`、`node scripts/build-exe.mjs`、静默 NSIS 安装到 runner 临时目录、针对已安装树的 `node scripts/verify-desktop-exe.mjs`，以及 `dist/octopus_DSH_Setup.exe` 产物上传。门不绿，就没有产物。

### Windows 构建脚本

`scripts/build-exe.mjs` 逐阶段镜像 `scripts/build-dmg.sh`：预检（Windows 平台、pnpm、cargo/rustc、除非 `--skip-kb` 否则需要 Python、固定版本的 `pnpm dlx @tauri-apps/cli@2.11.4`、已构建的工作区 lib）→ 在负载组装之前以 release 模式编译 `dsh-desktop`，让 Rust 错误在几分钟内暴露 → 下载 `node-v24.14.0-win-x64.zip`，对照该版本的 `SHASUMS256.txt` 校验 SHA-256，用 System32 的 `tar.exe` 解压（bsdtar 读 zip；Node 24 没有内置解压）→ `scripts/collect-runtime-deps.mjs` → 播种 profile 插件与随包技能 → 用 `scripts/write-seed-rev.mjs` 记录播种树的内容修订 → 除非 `--skip-kb` 否则冻结 KB sidecar → 暂存 preset → 用 `pnpm dlx @tauri-apps/cli@2.11.4 build --bundles nsis` 打包 → 把安装包复制到 `dist/octopus_DSH_Setup.exe`。Tauri CLI 失败时，报错信息给出 cargo 回退路径（`cargo install --locked tauri-cli@2.11.4`，然后在 `apps/desktop/src-tauri` 运行 `cargo tauri build --bundles nsis`）。

`tauri-build` 在编译期解析合并后的平台配置里的资源路径，因此快速失败的编译看不到缺失资源；编译步骤先按 `tauri.windows.conf.json` 的 `bundle.resources` 逐条创建空文件或空目录占位，每个暂存阶段覆盖自己的占位，负载检查则拒绝仍为空的文件、空的播种目录，以及缺失或不是 64 个小写十六进制字符的 `resources/seed-rev.txt`。

### 安装包配置

负载暂存在 `apps/desktop/src-tauri/resources/`，也就是 `build.rs` 已写入 `installed-runtime-cli.js` 的目录。`apps/desktop/src-tauri/tauri.windows.conf.json` 设置 `targets: ["nsis"]`、`icon.ico`，以及列出每个暂存条目的 `bundle.resources` 列表形式；JSON 级平台合并会替换基础数组。`resources/presets/` 始终创建，使该条目在没有 preset 的构建里也能解析。`webviewInstallMode` 保持不设置（默认 `downloadBootstrapper` 符合产品对体积的敏感度），安装包不签名。

### Sidecar、依赖农场与 slim 模式

`scripts/build-kb-sidecar.mjs` 是 `scripts/build-kb-sidecar.sh` 的平台感知移植，后者继续作为 macOS 入口：venv 目录布局按平台区分，Windows 上 `--add-data` 分隔符为 `;`，输出名带 `.exe`，八个自检标志相同，pip 与 PyInstaller 固定在脚本内。`scripts/collect-runtime-deps.mjs` 改用 `path.relative`/`path.sep` 比较复制路径，因为它原先的字面 `/` 前缀检查在 Windows 上静默地什么都不跳过，把嵌套 store 树泄漏进了农场。

`--presets <dir>` 把每个 preset 子目录复制进安装包；`--presets none` 与默认值打印警告并随包不带 preset，因为 `env-ngo-project-assistant` 的源在本仓库之外。`--skip-kb` 产出 slim 安装包，其门禁通过标准排除 sidecar 检查与生命周期冒烟里的 ask-knowledge pin。

### Windows 就绪门

`scripts/verify-desktop-exe.mjs` 针对已安装树运行：外壳二进制与资源骨架、`node.exe --version`、harness 清单与 companion 模块图、带 pin 覆盖层的 companion 生命周期、符号链接与构建机路径泄漏、随包插件与技能、KB sidecar 自检及其重定位复跑。`scripts/smoke-companion-lifecycle.mjs` 增加了布局探测（`Contents/Resources` 与安装根目录）、按平台的 Node 二进制名、`os.homedir()` 与 `path.isAbsolute`，使两个门共用一个冒烟；`scripts/build-dmg.sh` 与 `scripts/verify-desktop-bundle.sh` 未被改动。

`scripts/verify-desktop-exe.spec.ts` 解析两个 shell 脚本，断言 `.mjs` 构建重复的那些值：`NODE_VERSION`、八个 sidecar 自检标志，以及 `--collect-all`/`--hidden-import` 集合。它存在的原因是仓库 linter 忽略 `.mjs` 文件。

## 验证

| 覆盖面 | 位置 |
|---|---|
| `NODE_VERSION`、sidecar 自检标志与 PyInstaller 标志集合继续与 macOS 脚本相等 | `scripts/verify-desktop-exe.spec.ts` |
| 已安装树就绪：骨架、内置 Node、harness 清单、模块图、带 pin 覆盖层的生命周期、泄漏、插件/技能、sidecar 自检、重定位 | `scripts/verify-desktop-exe.mjs`，由工作流在静默安装与产物上传之间运行 |
| macOS bundle 路径不变 | 针对已构建 `.app` 运行 `scripts/verify-desktop-bundle.sh`，它走共用冒烟脚本的 macOS 分支 |

测试不需要 API key，不调用模型。工作流本身就是打包门。

## 备选方案

**在本地 Windows 机器上构建。** 所有者要手工运行构建并承担全部验证负担；否决，因为必须由同一个 agent 构建并自验产物，而这只有 CI runner 路径能提供。

**从 macOS 交叉编译。** Tauri 没有受支持的 macOS 到 Windows 交叉编译（MSVC、WebView2、NSIS），PyInstaller 也无法交叉编译 sidecar。否决，因为它不可能。

**把 `env-ngo-project-assistant` preset 提交进这个公开仓库，让两个构建都随包携带。** 所有者选择 v1 的 EXE 不带 preset；`--presets` 在不提交内容的前提下保留了这项能力。

**用 `bundle.resources` 的映射形式并把暂存放在 `src-tauri` 之外。** 列表形式配合 `src-tauri/resources/` 下的暂存更简单，且所有路径都相对配置文件。若 CI 显示列表形式行为异常，映射形式仍是记录在案的退路。

**目标改为 MSI 而不是 NSIS。** MSI 不在范围内；NSIS 是 Tauri 的默认 Windows bundle，其 `/S /D=` 静默安装正是 CI 门所需的。

## 后果

- 安装包不签名，因此在代码签名进入范围之前，SmartScreen 可能显示「Windows protected your PC」；构建脚本会打印与 DMG 脚本针对 Gatekeeper 同类的提示。
- crate 的首次 Windows 编译是已定价的风险；构建把编译排在昂贵负载步骤之前、把门排在产物上传之前，因此失败只花一次干净运行，而不是产出一个坏产物。
- 两个 sidecar 冻结脚本与 Node 版本如今把事实重复在 shell 脚本与 Node 脚本之间；`scripts/verify-desktop-exe.spec.ts` 是机械保障，macOS 脚本仍是 macOS 入口。
- Windows 用户得到与 DMG 相同的功能集，差别只在随包 preset：只有 preset 被提交或用 `--presets` 传入时才会随包。
- macOS 链路保持原行为；唯一的共享改动是冒烟脚本的平台感知布局探测。
