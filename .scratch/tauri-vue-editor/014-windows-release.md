# 014 Windows x64 安装包发布

**类型：HITL**

## What to build

在 Windows 2022 x64 构建环境中生成 Tauri NSIS `.exe`、WiX `.msi`。Windows
与 Linux 使用独立的平台配置和 CI 工作流，不得改变现有 AppImage、deb 和
Linux CLI 的产出。发布物包含许可证、第三方声明、源码说明、用户文档和同提交
源码包。Windows CLI 不作为 GitHub 自动发布物。

## Acceptance criteria

- [x] Windows 平台配置声明 NSIS 和 MSI 两种安装包。
- [x] 根级构建命令可生成 Windows 桌面安装包。
- [x] Windows GitHub Actions 定义在 `windows-2022` 原生构建并上传全部发布物。
- [x] CI 检查安装包、许可证、源码说明和源码归档均存在。
- [x] Linux 原有构建命令和发布工作流保持兼容。
- [ ] GitHub Actions 实际运行成功并产出 NSIS `.exe` 与 WiX `.msi`。
- [ ] 在 Windows 10/11 x64 实机安装 NSIS 或 MSI，导入真实 PDF 并导出 SVG。

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- GitHub Actions `Windows release` 成功生成 `.exe` 与 `.msi`。
- Windows 10/11 实机完成桌面端安装与真实 PDF 转换，因此本任务保持 HITL。

## Blocked by

- 007 兼容现有 CLI
- 010 性能、取消与资源回收
- 013 压缩文档栏并统一布局控件
