# 007 兼容现有 CLI

**类型：AFK**

## What to build

提供 `pdf-pattern-svg` TypeScript CLI，复用桌面应用相同的 MuPDF 和导出核心。
保留现有自动布局、手动页码范围、接缝、裁切、检测和覆盖参数语义，并增加从
工程文件直接导出的入口。

## Acceptance criteria

- [x] `-i input.pdf -c 3` 和 `-p '1-3|4-5|6-9'` 正常工作。
- [x] 支持正序/倒序范围、空白、不等长列、漏页和重复页校验。
- [x] 未指定 `-o` 时生成输入 PDF 同名 `.svg`，默认拒绝覆盖。
- [x] `--project` 可导出桌面端保存的工程。
- [x] 用户输入错误退出码为 2，并输出可操作的中文错误。
- [x] 所有旧参数都能解析；失去意义的外部扁平化参数给出弃用提示。
- [x] CLI 与桌面端对同一工程生成字节等价或规范化等价的 SVG。

## Blocked by

- 006 矢量 SVG 导出

## Verification

- `pnpm test`
- `pnpm typecheck`
- 528 PDF 的 `-c 3`、等价 `-p` 和 `--project` 三种导出结果 SHA-256
  完全相同。
- 639 PDF 未指定 `-o` 时生成同名 SVG；第二次运行拒绝覆盖并返回退出码 2。
- 639 外边界覆盖结果与旧 Python CLI 的成品尺寸同为
  `822.513 × 1153.149 mm`。
- 参数测试覆盖全部旧参数；`--rsvg-convert`、`--no-flatten` 和
  `--work-dir` 会给出明确提示。
