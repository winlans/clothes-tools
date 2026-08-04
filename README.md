# pdf2plt

基于 Tauri 2、Vue 3、TypeScript 和 MuPDF WASM 的服装版图 PDF 可视化
排版与矢量 SVG 导出工具。

当前正在按纵向任务切片开发：

- [开发说明](docs/DEVELOPMENT.md)
- [开发任务](docs/TASKS.md)

旧版 Python 工具位于 `/home/winlans/pdf-pattern-svg-tool`，仅作为行为和真实
PDF 回归基线；新版应用不依赖 Python、Poppler 或 librsvg。

## 开发环境

需要 Node.js、pnpm、Rust 和 Bun。Ubuntu/Debian 构建 Tauri 桌面端还需要：

```bash
sudo apt-get install -y \
  build-essential libayatana-appindicator3-dev libwebkit2gtk-4.1-dev \
  libssl-dev librsvg2-dev libxdo-dev patchelf pkg-config
```

安装 JavaScript 依赖并验证 workspace：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

使用真实 PDF 验证 MuPDF 导入和首末页 PNG 预览：

```bash
pnpm smoke:pdf /path/to/input.pdf
```

## 命令行转换

CLI 与桌面应用复用相同的 MuPDF、红线检测和单根 SVG 导出核心：

```bash
# 自动按每列 3 页排列，默认输出 input.svg
pnpm cli -- -i /path/to/input.pdf -c 3

# 手动分列，支持正序/倒序范围和空白占位
pnpm cli -- -i /path/to/input.pdf -p '1-3|6-4|-,7-9'

# 从桌面工程直接导出
pnpm cli -- --project layout.pattern-layout.json -o output.svg
```

默认拒绝覆盖已有文件；确认覆盖时添加 `--overwrite`。完整参数可通过
`pnpm cli -- --help` 查看。旧版 `--rsvg-convert` 与 `--no-flatten` 仍可解析，
但只会显示弃用提示，因为新版始终直接生成单根 SVG。

## Linux 发布

构建独立的 Linux x86_64 CLI（不要求目标机安装 Bun/Node）：

```bash
pnpm release:cli
```

构建 AppImage 与 deb，并执行新版 Mesa/GLib 兼容性后处理：

```bash
pnpm release:desktop
```

发布物位于 `dist/release/` 与
`apps/desktop/src-tauri/target/release/bundle/`。发布时必须同时提供由
`git archive` 生成的同版本源码包。安装和命令行用法见
[`docs/USER_GUIDE.md`](docs/USER_GUIDE.md)，构建与验收流程见
[`docs/LINUX_RELEASE.md`](docs/LINUX_RELEASE.md)，许可证和对应源码说明见
[`LICENSE`](LICENSE)、[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 与
[`SOURCE_OFFER.md`](SOURCE_OFFER.md)。

构建不打包安装器的 Tauri 调试程序：

```bash
pnpm --filter @pdf2plt/desktop tauri build --debug --no-bundle
```

宿主机不方便安装 WebKitGTK 开发包时，也可用隔离容器复现原生构建：

```bash
docker build --progress=plain \
  -f .scratch/tauri-vue-editor/verify-tauri.Dockerfile \
  -t pdf2plt-tauri-verify .
```

任务 002 的真实 PDF 浏览器回归使用独立 Playwright 镜像，运行前先启动
`pnpm dev`，并把 15 页测试 PDF 挂载为 `/fixtures/input.pdf`：

```bash
docker build -f .scratch/tauri-vue-editor/browser-smoke.Dockerfile \
  -t pdf2plt-browser-smoke .
docker run --rm --network host \
  -v "$PWD/.scratch/tauri-vue-editor/browser-layout-smoke.cjs:/test.cjs:ro" \
  -v "/path/to/15-page.pdf:/fixtures/input.pdf:ro" \
  pdf2plt-browser-smoke node /test.cjs
```
