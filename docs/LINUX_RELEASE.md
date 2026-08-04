# Linux x86_64 发布与验收

## 构建基线

正式 Linux 发布使用 Ubuntu 22.04 x86_64、Node.js 22、pnpm 11.17.0、
Bun 1.3.14 和稳定版 Rust。`.github/workflows/linux-release.yml` 是可执行的
发布构建定义；版本依赖由 `pnpm-lock.yaml` 和 Rust `Cargo.lock` 固定。

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm release:cli
pnpm release:desktop
```

`release:desktop` 会在 Tauri 默认打包之后移除 AppImage 中会与新版本
Mesa/GLib 冲突的旧版 Wayland、GLib 和 GStreamer 基础库，恢复主机 GStreamer
插件路径，再使用固定版本且经过 SHA-256 校验的 appimagetool 重打包。不要把
未经 `scripts/postprocess-appimage.sh` 处理的 Tauri 原始 AppImage 作为发布物。

产物包括：

```text
dist/release/
  pdf2plt-cli-linux-x64.tar.gz
  pdf2plt-cli-linux-x64/
    pdf-pattern-svg
    mupdf-wasm.wasm
    LICENSE
    THIRD_PARTY_NOTICES.md
    SOURCE_OFFER.md
    USER_GUIDE.md
apps/desktop/src-tauri/target/release/bundle/
  appimage/pdf2plt_0.1.0_amd64.AppImage
  deb/pdf2plt_0.1.0_amd64.deb
```

每次二进制发布还必须从同一 Git 提交生成并发布对应源码：

```bash
git archive --format=tar.gz \
  --prefix=pdf2plt-0.1.0-source/ \
  --output=dist/release/pdf2plt-0.1.0-source.tar.gz HEAD
sha256sum dist/release/*
```

## 自动检查

在发布前执行以下检查：

1. 在干净 Ubuntu 22.04 环境安装 `deb`，启动 `pdf2plt`，导入真实 PDF，保存并
   重开工程，再导出 SVG。
2. 使用 `APPIMAGE_EXTRACT_AND_RUN=1` 启动 AppImage，确认主窗口可用。
3. 在未安装 Node/Bun 的环境解压 CLI 包，确认可执行文件能找到相邻
   `mupdf-wasm.wasm` 并转换真实 PDF。
4. 用桌面端与 CLI 从同一个 `.pattern-layout.json` 导出，比较 SHA-256；输出应
   完全一致。
5. 检查 SVG 只有一个根 `<svg>`，页面实例数与工程一致，且不是整页位图。
6. 使用 `ldd` 和 `dpkg-deb -f` 检查运行时依赖；使用 `dpkg-deb -c` 检查许可
   证、第三方声明、源码说明和用户文档均已进入安装包。
7. 运行 `scripts/check-appimage-compat.sh <AppImage>`，确认发布物不再携带会与
   新版 Mesa/GLib 冲突的基础库，并在 Ubuntu 26.04 Wayland 上确认窗口不是白屏。

本地容器基线位于
`.scratch/tauri-vue-editor/release-build.Dockerfile` 与
`.scratch/tauri-vue-editor/release-smoke.Dockerfile`。它们用于复现 WebKitGTK
构建环境和 Xvfb 桌面冒烟测试，不属于最终运行时依赖。

## 人工矢量编辑器验收

最后在 CorelDRAW 或等价矢量编辑器中导入桌面端生成的 SVG：

1. 确认导入单位为毫米，宽高与应用导出摘要一致，允许 `0.1 pt` 以内误差。
2. 确认版型线条可单独选择和编辑，而不是一张整页位图。
3. 检查页面接缝连续、无重复红色辅助线、无意外白色页面背景。
4. 把编辑器名称、版本、样本文件、实际尺寸和结论记录到对应发布任务。

未完成本节人工检查时，发布任务保持 HITL 状态，不标记为完全验收。
