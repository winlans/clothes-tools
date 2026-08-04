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
sudo apt-get install -y libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev libxdo-dev
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
