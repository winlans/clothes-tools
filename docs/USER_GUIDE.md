# pdf2plt 0.1.0 使用说明

## 桌面应用

### Windows 10/11 x64

普通用户运行 `pdf2plt_0.1.0_x64-setup.exe` 安装；需要 MSI 部署时使用
`pdf2plt_0.1.0_x64_en-US.msi`。应用依赖 Microsoft Edge WebView2，系统缺失时
安装器会联网安装。当前未签名的自动构建包可能显示“未知发布者”，请先核对
发布页提供的 SHA-256；正式发行版应使用有效的 Authenticode 签名。

### Linux AppImage

```bash
chmod +x pdf2plt_0.1.0_amd64.AppImage
./pdf2plt_0.1.0_amd64.AppImage
```

如果系统没有 FUSE，可用
`APPIMAGE_EXTRACT_AND_RUN=1 ./pdf2plt_0.1.0_amd64.AppImage` 启动。

### Linux Debian / Ubuntu

```bash
sudo apt install ./pdf2plt_0.1.0_amd64.deb
pdf2plt
```

安装包会声明 WebKitGTK/GTK 等系统图形库依赖；不需要安装 Python、Poppler、
librsvg、Node.js 或 Bun。

### 可视化排版

1. 点击“打开 PDF”导入分块版图。
2. 等待首批缩略图出现；其余页面在后台继续生成。
3. 应用会根据逐页红线自动识别每列页数；可修改识别结果，并使用拖拽、空白
   占位、撤销/重做调整布局。不等长列会自动添加空白占位，例如 530 的第二列
   会在顶部补一个空白。
4. 应用会自动检测四条拼接线；可在右侧直接微调坐标，或关闭“裁切页间接缝”，
   然后核对成品尺寸。
5. 点击“导出 SVG”生成保持 1:1 尺寸的单根矢量 SVG。

## 独立 CLI

Windows 解压 `pdf2plt-cli-windows-x64.zip`，保持 `.exe` 与 WASM 相邻：

```text
pdf2plt-cli-windows-x64/
  pdf-pattern-svg.exe
  mupdf-wasm.wasm
  LICENSE
  THIRD_PARTY_NOTICES.md
  SOURCE_OFFER.md
  USER_GUIDE.md
```

PowerShell 示例：

```powershell
.\pdf-pattern-svg.exe -i input.pdf -c 3
.\pdf-pattern-svg.exe -i input.pdf -p '1-3|6-4|-,7-9'
```

Linux 解压 `pdf2plt-cli-linux-x64.tar.gz` 后，必须保持可执行文件与 WASM 相邻：

```text
pdf2plt-cli-linux-x64/
  pdf-pattern-svg
  mupdf-wasm.wasm
  LICENSE
  THIRD_PARTY_NOTICES.md
  SOURCE_OFFER.md
  USER_GUIDE.md
```

Linux 常用命令：

```bash
./pdf-pattern-svg -i input.pdf -c 3
./pdf-pattern-svg -i input.pdf -p '1-3|6-4|-,7-9'
./pdf-pattern-svg --project layout.pattern-layout.json -o output.svg
./pdf-pattern-svg --help
```

默认不覆盖已有 SVG；需要覆盖时添加 `--overwrite`。接缝与外边界参数单位是
PDF point，`72 pt = 1 inch`。

## 故障排查

- 提示缺少 `mupdf-wasm.wasm`：把发布包内的 WASM 放回可执行文件同一目录。
- 自动红线检测失败：直接填写缺少的拼接线，或关闭“裁切页间接缝”。
- SVG 已存在：更换输出名，或确认后使用 CLI 的 `--overwrite`。

许可证、无担保声明和对应源码获取方式见 `LICENSE`、
`THIRD_PARTY_NOTICES.md` 与 `SOURCE_OFFER.md`。
