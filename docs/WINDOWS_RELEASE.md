# Windows x64 发布与验收

## 构建基线

正式 Windows 发布使用 GitHub Actions 的 Windows Server 2022 x64、Node.js
22、pnpm 11.17.0 和稳定版 Rust MSVC 工具链。可执行定义位于
`.github/workflows/windows-release.yml`，由 `.github/workflows/release.yml` 统一调用。

## CI 发布与自动更新

公开发布仓库为 `winlans/clothes-tools`。推送 `v*` 标签后自动构建 Windows
NSIS、MSI 和同提交源码归档，验证所有更新包签名，再发布 GitHub Release。
标签必须与根目录、desktop/core/cli package.json、Cargo.toml 和 tauri.conf.json
的版本一致。预发布标签生成 prerelease，不替换稳定版更新入口。

普通 main push / PR 运行类型检查、测试及前端构建。手动运行 Release 工作流时，
选择分支只构建附件，选择版本标签才发布 Release。Linux 由同一个 Release 工作流
并行构建，并与 Windows 产物合并到同一个 GitHub Release。

GitHub Actions 配置：

- Secret `TAURI_SIGNING_PRIVATE_KEY`：Tauri updater 私钥，与 tauri.conf.json 公钥配对。
- Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：私钥密码；无密码时可以不设置。
- `VITE_BAIDU_TONGJI_SITE_ID`：百度统计 hm.js 后的 32 位站点 ID，当前 Windows
  发布工作流使用 `3e8ed92b699635e1e97b269e145ab9e0`。这是公开站点 ID，不是访问
  密钥；本地 `.env` 留空可关闭统计，未配置时生产构建仍使用项目默认值。

私钥不进入源码。签名配置通过临时构建配置启用，本地常规构建不要求私钥。
`scripts/generate-update-manifest.mjs` 会校验 NSIS / MSI 的最终文件和可信注释签名，
生成同时支持两种安装方式的 `latest.json` 及 `SHA256SUMS`。构建失败、版本不符、
签名缺失或不匹配均不会发布更新清单；已发布版本拒绝覆盖，修复需使用新版本号。

更新入口：
`https://github.com/winlans/clothes-tools/releases/latest/download/latest.json`。
正式桌面版启动 3 秒后检查，每小时复查；检查失败按 1、5、15 分钟重试。
发现新版本后后台下载并验证签名，下载完成弹窗提示，由用户点击“重启并更新”。
“更多 → 检查更新”可以手动检查；“忽略此版本”只影响自动提醒，手动检查仍可更新。
未保存的排版、正在导入/计算/导出的任务会阻止安装。开发模式不自动更新。
下载缓存只保留在当前进程，退出后需重新下载。

百度统计只在配置站点 ID 的生产构建启用，记录启动、PDF 导入成功/失败、
SVG/PLT 导出成功/失败、更新检查/下载/安装等事件。使用固定事件名、格式和页数，
不发送文件名、文件路径、PDF 内容或原始错误。统计加载失败不影响应用。

Windows 本机需安装 Visual Studio 2022 Build Tools（Desktop development with
C++）、Rust MSVC、Node.js 和 pnpm，然后运行：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm release:desktop:windows
```

没有 Windows 构建机时，可在 Linux x64 主机上使用 Docker、`cargo-xwin` 和
NSIS 交叉生成可视化安装包：

```bash
pnpm release:desktop:windows:cross
```

该命令会缓存 Windows SDK 与 Rust 构建结果，并把安装包复制到
`dist/release/pdf2plt_0.1.9_x64-setup.exe`。缓存默认位于
`/tmp/pdf2plt-xwin-cache` 和 `/tmp/pdf2plt-windows-target`；可分别通过
`PDF2PLT_XWIN_CACHE_DIR` 与 `PDF2PLT_WINDOWS_TARGET_DIR` 修改。交叉构建只生成
NSIS `.exe`，不生成 WiX `.msi`，也不替代 Windows 10/11 实机验收。

桌面端使用平台配置
`apps/desktop/src-tauri/tauri.windows.conf.json`，同时生成 NSIS `.exe` 和
WiX `.msi`。Tauri 官方要求 MSI 在 Windows 上原生构建，因此正式产物不在
Linux 上交叉编译。

## 发布物

```text
dist/release/
  pdf2plt_0.1.9_x64-setup.exe
  pdf2plt-0.1.9-source.tar.gz
apps/desktop/src-tauri/target/release/bundle/
  nsis/pdf2plt_0.1.9_x64-setup.exe
  msi/pdf2plt_0.1.9_x64_en-US.msi
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
2. NSIS、MSI 和同提交源码归档均存在且非空。
3. 输出安装包的 SHA-256 已记录。

## 人工验收

1. 在 Windows 10 x64 和 Windows 11 x64 至少各测试一次安装、启动和卸载。
2. 导入真实多页 PDF，确认页面预览、自动辅助线识别、拖拽与工具栏空白块正常。
3. 分别导出 SVG 和 PLT，在 CorelDRAW 2021–2024 中核对毫米尺寸、文字轮廓与
   矢量可编辑性。
4. 无 WebView2 的测试机验证在线 bootstrapper；离线发行则验证离线安装模式。
5. 配置签名后用 `Get-AuthenticodeSignature` 确认 `.exe` 和 `.msi` 签名有效。

完成本节实机检查前，Windows 发布任务保持 HITL 状态。
