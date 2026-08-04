# 015 CLI 内嵌 MuPDF WASM

**类型：AFK**

## What to build

修复 Windows 用户单独启动 `pdf-pattern-svg.exe` 或直接从 ZIP 打开时提示
`mupdf-wasm.wasm` 必须与执行文件同目录的问题。使用 Bun standalone executable
文件嵌入能力，把 MuPDF WASM 放入 Windows/Linux CLI 可执行程序，发布包不再
携带外部 WASM。桌面 Tauri 应用继续使用 Vite 的 WASM 资源 URL，不改变其路径。

## Acceptance criteria

- [x] Windows 与 Linux CLI 可执行文件内嵌 MuPDF WASM。
- [x] 发布目录和压缩包不再包含外部 `mupdf-wasm.wasm`。
- [x] 发布物检查会把可执行文件复制到空目录并独立启动。
- [x] Windows CLI 在 Wine 空目录中启动，不再显示 WASM 同目录错误。
- [x] Windows CLI 使用真实 15 页 PDF 成功生成单根 SVG 和 15 个页面实例。
- [x] Linux 原有 CLI 命令和发布格式保持兼容。

## Verification

- `pnpm --filter @pdf2plt/cli typecheck`
- `pnpm --filter @pdf2plt/cli test`
- `pnpm release:cli:windows`
- `PDF2PLT_WINE_SMOKE=1 pnpm --filter @pdf2plt/cli verify:release windows-x64`
- `pnpm release:cli:linux`
- `pnpm --filter @pdf2plt/cli verify:release linux-x64`
- Wine 中使用 `ku小红叶528-4XL-A3.pdf` 完成 15 页转换。

## Blocked by

- 007 兼容现有 CLI
- 011 Linux 安装包与发布验收
- 014 Windows x64 安装包与 CLI 发布
