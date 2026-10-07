# Agent Note: 桌面媒体运行时分发

Status: implemented

[English](2026-09-20-media-runtime-distribution.md) | 中文

## Problem

桌面媒体合成需要用户机器上的 FFmpeg 和 ffprobe。把这些二进制嵌入一键 DMG，就要处理架构、代码签名、动态库闭包，以及可验证的 LGPL-only 构建。阶段 1 机器上的 Homebrew FFmpeg 带 GPL 和 libx264，不能复制进专有应用。

## Decision

第一版不嵌入 FFmpeg。一键 DMG 只随包装运 desktop-media overlay。需要视频功能的用户自行安装 FFmpeg，并运行 `scripts/install-media-runtime.sh`。该脚本在 macOS 缺少 `ffmpeg` 时用 Homebrew 安装，解析 `$(brew --prefix)`，把该绝对前缀写入 `$DSH_HOME/media/user-runtime-home`，并检查 `bin/ffmpeg` 与 `bin/ffprobe` 存在。它不把 Homebrew 二进制复制进应用包。

插件按此顺序解析运行时根：

1. 绝对 `mediaRuntimePath` 插件配置
2. 绝对 `OCTOPUS_MEDIA_HOME`
3. `$DSH_HOME/media/user-runtime-home` 中的路径

缺少运行时不会让 companion 启动失败。合成、导入探测和缩略图提取失败并给出安装脚本说明。合成要求 `h264_videotoolbox` 和原生 `aac`。应用不对用户自有二进制套用 LGPL 随包装运规则。`inspectFfmpegLicense`／`assertShippableFfmpeg` 留给以后我们自己分发运行时的变更。

打包后的桌面 shell 不会把 `OCTOPUS_MEDIA_HOME` 指到随包的 `Contents/Resources/resources/media-runtime`。它不改变 `OCTOPUS_SIDECAR_HOME`。第一版不因启用媒体而拒绝 x64 DMG，因为 DMG 不含媒体二进制。

以后若随包 LGPL 运行时，需要 `scripts/build-media-runtime.sh`、嵌入、签名、`LICENSE`／`SOURCE.txt` 和重定位合成检查。该路线推迟。

### Stage 1 evidence

2026-09-20 在 macOS arm64 实测。Homebrew FFmpeg 8.1.2（`/opt/homebrew/bin/ffmpeg`，SHA-256 `2ce81b92499c1b6b96eb060c69723114bd0da13f1bfbd9da26dee24d099e644a`）带 `--enable-gpl --enable-libx264 --enable-libx265 --enable-openssl`。若嵌入则不可随包装运。第一版在安装脚本把 `/opt/homebrew` 写入 `user-runtime-home` 后，把它当作用户自有运行时。

同一对二进制可用 `h264_videotoolbox` 和原生 `aac` 把 1 秒无声片段与 0.4 秒旁白合成 10880 字节的 H.264/AAC MP4。放到含空格路径的副本仍从 `/opt/homebrew` 加载 Homebrew 动态库；因此第一版保持用户前缀，不把二进制搬进应用。

## Alternatives considered

**通用 `OCTOPUS_RESOURCES_HOME` 根。** 将来可供第三种打包运行时使用，但第一版只需要一条媒体路径，且不嵌入该运行时。

**在 DMG 中嵌入 LGPL FFmpeg。** 若我们再分发 FFmpeg，这是正确路线。阶段 1 未能产出可验证的 LGPL 树；嵌入 Homebrew 会随包装运 GPL／libx264。

**把可执行文件放进插件种子。** 插件依赖检查不负责签名 Mach-O 动态库、证明可重定位或提供许可材料。

## Consequences

一键 arm64 DMG 不含 FFmpeg 也能启动会话。在用户写入 `user-runtime-home` 之前，合成保持失败关闭。用户安装的 FFmpeg 版本和编码器集合会变化；缺少 `h264_videotoolbox` 或 `aac` 时失败。Homebrew 升级可能移动前缀，用户需重跑脚本。目标机器播放仍由系统播放器负责。知识库 sidecar 维持 `OCTOPUS_SIDECAR_HOME`。
