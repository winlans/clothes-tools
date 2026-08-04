# Windows x64 发布与验收

## 构建基线

正式 Windows 发布使用 GitHub Actions 的 Windows Server 2022 x64、Node.js
22、pnpm 11.17.0、Bun 1.3.14、稳定版 Rust MSVC 工具链。可执行定义位于
`.github/workflows/windows-release.yml`。

Windows 本机需安装 Visual Studio 2022 Build Tools（Desktop development with
C++）、Rust MSVC、Node.js、pnpm 和 Bun，然后运行：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm release:cli:windows
pnpm release:desktop:windows
```

桌面端使用平台配置
`apps/desktop/src-tauri/tauri.windows.conf.json`，同时生成 NSIS `.exe` 和
WiX `.msi`。Tauri 官方要求 MSI 在 Windows 上原生构建，因此正式产物不在
Linux 上交叉编译。

## 发布物

```text
dist/release/
  pdf2plt-cli-windows-x64.zip
  pdf2plt-cli-windows-x64/
    pdf-pattern-svg.exe
    mupdf-wasm.wasm
    LICENSE
    THIRD_PARTY_NOTICES.md
    SOURCE_OFFER.md
    USER_GUIDE.md
  pdf2plt-0.1.0-source.tar.gz
apps/desktop/src-tauri/target/release/bundle/
  nsis/pdf2plt_0.1.0_x64-setup.exe
  msi/pdf2plt_0.1.0_x64_en-US.msi
```

普通用户优先使用 NSIS `.exe`；需要 MSI 部署的环境可使用 `.msi`。当前自动
构建未配置商业代码签名证书，Windows 可能显示“未知发布者”或 SmartScreen
提示。正式对外发布前应配置证书并验证 Authenticode 签名，不能通过关闭系统
安全检查规避提示。

Tauri 安装器默认在系统缺少 WebView2 时下载 bootstrapper。离线部署环境应在
发布前改为 Tauri 支持的离线 WebView2 安装模式，并重新测试安装包体积与启动。

## 自动检查

Windows CI 会执行以下检查：

1. TypeScript、Vue 和 Rust 测试全部通过。
2. Windows CLI 可执行 `--help`，且相邻 WASM 存在。
3. CLI ZIP 包包含许可证、第三方声明、源码说明和用户文档。
4. NSIS、MSI 和同提交源码归档均存在且非空。
5. 输出安装包与 CLI ZIP 的 SHA-256。

## 人工验收

1. 在 Windows 10 x64 和 Windows 11 x64 至少各测试一次安装、启动和卸载。
2. 导入真实多页 PDF，确认缩略图、自动红线识别、拖拽与白色空白块正常。
3. 导出 SVG，在 CorelDRAW 中核对毫米尺寸与矢量可编辑性。
4. 无 WebView2 的测试机验证在线 bootstrapper；离线发行则验证离线安装模式。
5. 配置签名后用 `Get-AuthenticodeSignature` 确认 `.exe` 和 `.msi` 签名有效。

完成本节实机检查前，Windows 发布任务保持 HITL 状态。
