# 001 导入 PDF 并显示页面预览

**类型：AFK**

## What to build

建立 pnpm workspace、共享 TypeScript 核心和 Tauri 2 + Vue 3 桌面壳。用户从
系统对话框选择 PDF 后，MuPDF WASM 在 Worker 中打开文档，界面展示页数、页面
尺寸、加载进度和带页码的首批预览图。本切片只要求页面列表和预览，不包含排版。

## Acceptance criteria

- [x] 项目包含可独立构建的 core、desktop 和 cli workspace。
- [x] Tauri 窗口可选择本地 PDF，文件权限只覆盖用户选择的文件。
- [x] MuPDF 在 Worker 中返回页数和页面尺寸，主线程保持响应。
- [x] 所有页面尺寸在 `0.02pt` 容差内校验，不一致时指出具体页码。
- [x] 可见页预览与左侧页码列表正确显示，关闭文档后释放资源。
- [x] 使用真实 15 页 PDF 完成导入冒烟测试。

## Verification

- `pnpm typecheck`、`pnpm test` 和 `pnpm build` 通过；
- `ku小红叶528-4XL-A3.pdf` 共 15 页，页面尺寸为
  `841.890 × 1190.551pt`，首末页均生成 `566 × 800px` PNG；
- Ubuntu 24.04 隔离容器中完成 `tauri build --debug --no-bundle`；
- 构建产物在 Xvfb 中持续进入窗口事件循环，无启动崩溃。

## Blocked by

None - can start immediately.
