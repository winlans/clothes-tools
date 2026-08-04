# 对应源码与重建说明

pdf2plt 0.1.0 is distributed under **AGPL-3.0-or-later**. There is no warranty,
to the extent permitted by law. You may copy and modify it under the terms in
`LICENSE`.

## 获取对应源码

Each binary release must be published together with
`pdf2plt-0.1.0-source.tar.gz`. That archive is generated from the same Git commit
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
versions are pinned by the lock files; the CLI's adjacent `mupdf-wasm.wasm` is
copied without modification from `mupdf@1.28.0`.

For source availability questions, open an issue in the same repository from
which this release was obtained and include the pdf2plt version and artifact
name.
