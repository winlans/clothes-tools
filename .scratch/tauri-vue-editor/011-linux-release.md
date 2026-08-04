# 011 Linux 安装包与发布验收

**类型：HITL**

## What to build

完成 Linux x86_64 AppImage、deb 和 CLI 发布包。发布物包含 MuPDF WASM、AGPL
许可证、第三方声明、完整源码获取说明和使用文档，并在干净 Linux 环境验证
安装、PDF 导入、工程重开、SVG 导出和 CLI。

## Acceptance criteria

- [x] CI 在兼容基线系统构建 AppImage、deb 和 CLI 发布包。
- [x] 安装后的桌面应用不依赖 Python、Poppler、librsvg、Node 或 Bun。
- [x] CLI 发布包能定位相邻 MuPDF WASM 并完成真实 PDF 转换。
- [x] 发布物包含 AGPL-3.0-or-later、MuPDF 版权声明和对应源码说明。
- [x] 干净 Linux 虚拟机通过桌面端和 CLI 冒烟测试。
- [ ] 人工在 CorelDRAW 或等价矢量编辑器中确认尺寸与路径可编辑性。

## 2026-08-04 自动验收记录

- 基线：Ubuntu 22.04 x86_64 容器；CI 使用 `ubuntu-22.04`。
- `deb` 安装后完成真实 15 页 PDF 导入、工程保存、自动重开和 SVG 导出；
  AppImage 使用 `APPIMAGE_EXTRACT_AND_RUN=1` 启动成功。
- 桌面端与独立 CLI 从同一工程生成的 SVG SHA-256 均为
  `d346221c62384f5096e86d83cd1e68522af8a5114c8c43ad55d98958e27ce2f4`，
  均为单根 SVG、15 个页面实例和 1865 个可见对象。
- 独立 CLI 在未安装 Node/Bun 的 `ubuntu:22.04` 中完成真实 PDF 转换，动态依赖
  仅为 glibc、pthread、dl 和 m；`deb` 只声明 WebKitGTK 与 GTK 运行时依赖。
- 安装包内已检查 `LICENSE`、`THIRD_PARTY_NOTICES.md`、`SOURCE_OFFER.md` 和
  `USER_GUIDE.md`。
- 待人工项：在 CorelDRAW 或等价编辑器中导入验收样本，核对毫米尺寸并确认
  路径可选择、可编辑。

## Blocked by

- 007 兼容现有 CLI
- 008 工程保存、重开与 PDF 重关联
- 009 高级接缝和导出选项
- 010 性能、取消与资源回收
