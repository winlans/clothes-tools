# 016 Linux 交叉生成 Windows 可视化安装包

**类型：AFK**

## What to build

在没有 Windows 构建机和可用 GitHub Actions 的情况下，使用 Tauri 支持的
`cargo-xwin` 路径从 Linux x64 交叉编译 Windows x64 Tauri 可视化程序，并用
NSIS 生成可安装的 `.exe`。构建命令应能重复执行，使用独立缓存，并把最终安装包
复制到统一的 `dist/release` 发布目录。

## Acceptance criteria

- [x] Docker 构建环境固定 Node.js、pnpm、Rust MSVC target 与 cargo-xwin 版本。
- [x] 根级命令能够交叉编译 Tauri 桌面程序并生成 NSIS 安装包。
- [x] 最终发布物是 Windows PE 安装器，不是 CLI ZIP 中的命令行程序。
- [x] 安装器内的主程序使用 Windows GUI 子系统，启动时不弹出 CLI 控制台窗口。
- [x] 安装包以非空文件原子写入 `dist/release`，并输出 SHA-256。
- [x] 文档说明交叉构建只生成 NSIS，MSI 与 Windows 实机验收仍由原生流程完成。

## Verification

- `bash -n scripts/build-windows-nsis.sh`
- `pnpm release:desktop:windows:cross`
- `file dist/release/pdf2plt_0.1.0_x64-setup.exe`
- `objdump -x <解包后的 pdf2plt.exe>` 显示 `Subsystem (Windows GUI)`。
- `sha256sum dist/release/pdf2plt_0.1.0_x64-setup.exe`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## Blocked by

- 014 Windows x64 安装包与 CLI 发布
- 015 CLI 内嵌 MuPDF WASM
