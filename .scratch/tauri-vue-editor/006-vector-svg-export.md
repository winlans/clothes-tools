# 006 矢量 SVG 导出

**类型：AFK**

## What to build

使用 MuPDF 页级 SVG 和共享布局生成一个 CorelDRAW 兼容的单页 SVG。导出器
需要移除可配置的红线和白色背景、重写 ID 引用、应用接缝裁切和页面位移，并
保持 PDF 1:1 尺寸。桌面应用提供保存对话框、进度和结果摘要。

## Acceptance criteria

- [x] 输出只有一个根 `<svg>`，尺寸同时包含毫米值和 point `viewBox`。
- [x] 每个页面实例的 ID、`url(#id)` 和 `href` 引用不会冲突。
- [x] 矢量 PDF 不得被导出为整页预览图片。
- [x] 空白占位在输出中保留空间但不创建可见对象。
- [x] 默认输出移除红线和白色背景，并能通过设置保留。
- [x] 528 与 639 PDF 的成品尺寸和视觉内容通过旧工具差异测试。

## Blocked by

- 002 自动排版并显示 Vue 画板
- 005 自动红线检测与裁切预览

## Verification

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- 浏览器真实导出 528：470 KB、15 个页面实例、145 个唯一 ID、145 个有效
  引用、单根 `<svg>`、无整页 `<image>`，红线和白底默认移除。
- `smoke:svg` 分别导出 528 与 639；与旧 Python 工具的 point 尺寸一致，
  72 DPI 渲染尺寸分别同为 `4030×3480` 和 `2353×3281`，白底视觉检查一致。
