# 008 工程保存、重开与 PDF 重关联

**类型：AFK**

> 历史实现记录：底层工程格式与 CLI 兼容入口仍保留；从任务 013 起，桌面应用
> 为保持简单转换流程，不再展示打开/保存工程入口。

## What to build

实现版本化 `.pattern-layout.json` 工程。工程保存源 PDF 路径和指纹、布局、空白、
接缝、输出设置和画板视图。重新打开时按相对路径、绝对路径和人工选择的顺序
关联 PDF，并对不匹配文件给出安全提示。

## Acceptance criteria

- [x] schemaVersion 1 有运行时校验和稳定序列化测试。
- [x] 保存后重开可恢复页码、空白、接缝、缩放和平移。
- [x] 工程优先使用相对路径，兼顾同目录整体移动。
- [x] 源文件缺失时显示重新选择对话框。
- [x] 页数、尺寸或 SHA-256 不一致时不得静默替换源 PDF。
- [x] Tauri 持久文件权限只覆盖用户已选择的工程与 PDF。

## Verification

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `cargo check`（`pdf2plt-tauri-verify` 镜像，含 dialog/fs/persisted-scope 插件）
- 浏览器 smoke：保存含空白块/接缝/相机状态的工程并重新选择 PDF 后完整恢复。
- Tauri capability 仅启用 dialog 选取及 `fs:allow-read-file` / `fs:allow-write-file`，
  未配置宽泛文件系统 scope；持久 scope 由用户选择的工程和 PDF 动态授予。

## Blocked by

- 004 空白占位与撤销重做
- 005 自动红线检测与裁切预览
