# 011 Linux 安装包与发布验收

**类型：HITL**

## What to build

完成 Linux x86_64 AppImage、deb 和 CLI 发布包。发布物包含 MuPDF WASM、AGPL
许可证、第三方声明、完整源码获取说明和使用文档，并在干净 Linux 环境验证
安装、PDF 导入、工程重开、SVG 导出和 CLI。

## Acceptance criteria

- [ ] CI 在兼容基线系统构建 AppImage、deb 和 CLI 发布包。
- [ ] 安装后的桌面应用不依赖 Python、Poppler、librsvg、Node 或 Bun。
- [ ] CLI 发布包能定位相邻 MuPDF WASM 并完成真实 PDF 转换。
- [ ] 发布物包含 AGPL-3.0-or-later、MuPDF 版权声明和对应源码说明。
- [ ] 干净 Linux 虚拟机通过桌面端和 CLI 冒烟测试。
- [ ] 人工在 CorelDRAW 或等价矢量编辑器中确认尺寸与路径可编辑性。

## Blocked by

- 007 兼容现有 CLI
- 008 工程保存、重开与 PDF 重关联
- 009 高级接缝和导出选项
- 010 性能、取消与资源回收
