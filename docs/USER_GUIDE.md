# pdf2plt 0.1.8 使用说明

## 桌面应用

### Windows 10/11 x64

普通用户运行 `pdf2plt_0.1.8_x64-setup.exe` 安装；需要 MSI 部署时使用
`pdf2plt_0.1.8_x64_en-US.msi`。应用依赖 Microsoft Edge WebView2，系统缺失时
安装器会联网安装。当前未签名的自动构建包可能显示“未知发布者”，请先核对
发布页提供的 SHA-256；正式发行版应使用有效的 Authenticode 签名。

### Linux AppImage

```bash
chmod +x pdf2plt_0.1.8_amd64.AppImage
./pdf2plt_0.1.8_amd64.AppImage
```

如果系统没有 FUSE，可用
`APPIMAGE_EXTRACT_AND_RUN=1 ./pdf2plt_0.1.8_amd64.AppImage` 启动。

### Linux Debian / Ubuntu

```bash
sudo apt install ./pdf2plt_0.1.8_amd64.deb
pdf2plt
```

安装包会声明 WebKitGTK/GTK 等系统图形库依赖；不需要安装 Python、Poppler、
librsvg、Node.js 或 Bun。

### 可视化排版

1. 点击“打开 PDF”可一次选择多个分块版图，也可从文件管理器把一个或多个 PDF
   直接拖到应用窗口。每个文件会在独立标签中打开；重复导入同一个文件时会切换
   到已有标签。
2. 后台最多同时初始化两个文件，等待中的标签会显示“排队”；切换到等待标签会
   提高它的处理优先级。画板中的页面预览会按需生成。
3. 应用会根据逐页辅助线的几何模式自动识别每列页数，辅助线可以是红色、蓝色或
   其他清晰颜色；没有可靠辅助线模式时，会继续尝试匹配相邻页面重复内容。右侧
   “拼接模式”可选择“自动识别”“辅助线拼接”或“内容匹配”；
   手动选择后会只运行指定方案，选择会随工程保存。可修改识别结果，并从顶部工具栏
   拖入空白块，或使用拖拽、撤销/重做调整布局。
   不等长列会自动添加空白占位，例如 530 的第二列会在顶部补一个空白。
4. 辅助线方案继续显示四条拼接线的页面绝对坐标；内容匹配方案显示从左、右、上、
   下边缘分别裁掉的距离。两种方案内部使用相同导出坐标，旧工程和有辅助线 PDF
   的行为不变。内容匹配失败时会自动尝试其他栅格 DPI；开启“同步修改四个方向”
   后，修改任一裁切量会同时更新四边。也可关闭“裁切页间接缝”，然后核对成品尺寸。
5. 页码、水印等不是拼接辅助线的重复矢量内容，可点击“画笔消除”处理。在任一
   参考页用“加选”涂过目标；画笔只要接触对象，就会选中整个矢量对象，而不是把
   线条截断。首次涂选后系统会自动识别并用红色高亮命中对象；可切换“减选”、调整
   笔刷半径或撤销一笔。“生效范围”默认选择“全部页面”，也可改为“仅参考页”。
   跨页应用会学习参考页命中的对象类型，避免同一位置偶然经过的纸样路径被一并删除。
   “预览匹配”可用于检查所选范围内的全部红色标记，但不是确认前置步骤；参考页识别
   正确后可直接点击“确认消除”。规则会随工程保存，并同时作用于预览、SVG 和 PLT。
6. 默认不显示栅格，只呈现清爽的拼接结果；需要定位时可开启“显示栅格”。该
   开关在普通画板和全屏预览之间同步，并且不会改变导出的 SVG 或 PLT。
7. 在画板上直接输入 10%–400% 的任意缩放百分比；输入支持小数，加减按钮每次
   微调 0.1%。缩放框旁的计算器可按厘米输入校对块尺寸和投放尺寸，并按“当前比例 ×
   投放尺寸 ÷ 校对块尺寸”计算目标比例，确认后应用。点击“全屏预览”可进入只读
   全屏，使用滚轮缩放、空格键或鼠标中键平移，按 Esc 退出。
8. 点击“导出”后选择 SVG 或 PLT。打开多个标签时，可以选择要导出的标签并逐个
   修改默认文件名；单标签会直接打开保存对话框。排版、辅助线或导出设置有修改时，
   关闭标签或退出应用前会要求确认。

### CorelDRAW PLT

- “导出 PLT（CorelDRAW）”生成基础 HP-GL 文本文件，使用 CorelDRAW 支持的
  `1016 units/inch`（40 units/mm）、左下角原点和黑色 1 号笔。
- 在 CorelDRAW 2021–2024 中使用“文件 → 导入”选择 `.plt`。导入后的文字是
  可编辑轮廓，贝塞尔曲线按默认 0.05 mm 误差转换为短直线段。
- PLT 只表达刀路/轮廓，不保留线宽、填充色、透明度和页面位图。若 PDF 包含
  位图，应用会跳过位图并显示警告；需要完整视觉内容时请改用 SVG。
- 导出的 PLT 目标是 CorelDRAW 导入，不是直接发送给某一型号的刻字机或绘图仪。

## 独立 CLI

Windows 解压 `pdf2plt-cli-windows-x64.zip` 后可直接使用单文件 CLI：

```text
pdf2plt-cli-windows-x64/
  pdf-pattern-svg.exe
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

Linux 解压 `pdf2plt-cli-linux-x64.tar.gz` 后可直接使用单文件 CLI：

```text
pdf2plt-cli-linux-x64/
  pdf-pattern-svg
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

- `pdf-pattern-svg.exe` 是命令行转换器，不会打开图形界面；Windows 图形版请运行
  `pdf2plt_0.1.8_x64-setup.exe` 或安装 `.msi`。
- 自动辅助线检测失败：应用会在颜色与跨页几何模式均无法形成可靠布局时尝试内容匹配；置信度不足时，
  直接填写缺少的四边裁切量，或关闭“裁切页间接缝”。
- 开启“删除辅助线”时，预览和 SVG/PLT 导出会按检测坐标移除红色、蓝色等线型元素；
  同色但不位于辅助线位置的图案会保留。内容匹配方案不会启用坐标删除。
- 画笔误选或漏选：先看红色高亮，再用“减选”排除误命中的完整对象，或调小笔刷
  后重新加选。“预览匹配”可选；点击“确认消除”后，规则会写入工程和导出结果。
- SVG 已存在：更换输出名，或确认后使用 CLI 的 `--overwrite`。
- CorelDRAW 导入 PLT 后只有黑色细线：这是预期行为；PLT 输出的是可用于后续
  编辑或刀路处理的单色轮廓。

许可证、无担保声明和对应源码获取方式见 `LICENSE`、
`THIRD_PARTY_NOTICES.md` 与 `SOURCE_OFFER.md`。
