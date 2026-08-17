# 对应源码与重建说明

pdf2plt 0.1.8 is distributed under **AGPL-3.0-or-later**. There is no warranty,
to the extent permitted by law. You may copy and modify it under the terms in
`LICENSE`.

## 获取对应源码

Each binary release must be published together with
`pdf2plt-0.1.8-source.tar.gz`. That archive is generated from the same Git commit
as the binaries and contains the preferred source form, build scripts,
`pnpm-lock.yaml`, and Rust `Cargo.lock`.

The release embeds the unmodified npm package `mupdf@1.28.0`. Its corresponding
upstream source archive is available from:

<https://mupdf.com/downloads/archive/mupdf-1.28.0-source.tar.gz>

The npm package metadata and full AGPL license are also preserved in the
release. Artifex's upstream repository is:

<https://github.com/ArtifexSoftware/mupdf>

## 重建 Linux x86_64 发布物

Use Ubuntu 22.04 x86_64, Node.js 22, pnpm 11.17.0, Bun 1.3.14, and the stable
Rust toolchain. Install the Linux dependencies shown in `README.md`, then run:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm release:cli
pnpm release:desktop
```

The CI recipe in `.github/workflows/linux-release.yml` is the authoritative,
machine-readable reconstruction procedure. JavaScript and Rust dependency
versions are pinned by the lock files; `mupdf-wasm.wasm` is embedded without
modification into the standalone CLI executable from `mupdf@1.28.0`.

## 重建 Windows x64 发布物

Use Windows Server 2022 or Windows 10/11 x64 with Node.js 22, pnpm 11.17.0,
Bun 1.3.14, the stable Rust MSVC toolchain, and Visual Studio 2022 Build Tools.
Then run:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm release:cli:windows
pnpm release:desktop:windows
```

The authoritative Windows recipe is `.github/workflows/windows-release.yml`.
It builds the MSI and NSIS installers natively on Windows and publishes the
same-version source archive alongside them.

For source availability questions, open an issue in the same repository from
which this release was obtained and include the pdf2plt version and artifact
name.
