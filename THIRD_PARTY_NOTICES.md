# 第三方软件声明

pdf2plt 0.1.0 包含或使用以下主要第三方组件。确切的直接与传递依赖版本记录在
`pnpm-lock.yaml` 和 `apps/desktop/src-tauri/Cargo.lock` 中。

## MuPDF / MuPDF.js 1.28.0

- Copyright © 2004–2026 Artifex Software, Inc.
- License: GNU Affero General Public License v3.0 or later
- Homepage: <https://mupdf.com/>
- Source: <https://mupdf.com/downloads/archive/mupdf-1.28.0-source.tar.gz>

MuPDF is free software: you can redistribute it and/or modify it under the terms
of the GNU Affero General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. MuPDF is distributed without any warranty. Alternative commercial
licensing is available from Artifex Software, Inc.

The complete AGPL text is included in `LICENSE`. Corresponding-source and build
instructions are in `SOURCE_OFFER.md`.

## Desktop and web application components

- Tauri 2 and official Tauri plugins — Apache-2.0 OR MIT
- Vue 3 — MIT
- Pinia 3 — MIT
- Konva 10 — MIT
- serde and serde_json — Apache-2.0 OR MIT

## CLI runtime

The standalone `pdf-pattern-svg` executable embeds the Bun runtime and the
unmodified MuPDF WASM binary. Bun is
Copyright © Jarred Sumner and contributors and is distributed under the MIT
license. Its JavaScriptCore and other bundled third-party notices are available
from <https://bun.sh/docs/project/licensing>.

No Python, Poppler, librsvg, Node.js, or separately installed Bun runtime is
used by the released application at run time.
