#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"
image_name="${PDF2PLT_WINDOWS_IMAGE:-pdf2plt-windows-cross-build:bookworm}"
target_dir="${PDF2PLT_WINDOWS_TARGET_DIR:-/tmp/pdf2plt-windows-target}"
xwin_cache_dir="${PDF2PLT_XWIN_CACHE_DIR:-/tmp/pdf2plt-xwin-cache}"
target_triple="x86_64-pc-windows-msvc"
installer_name="pdf2plt_0.1.4_x64-setup.exe"

mkdir -p "$target_dir" "$xwin_cache_dir"

docker build \
  --file "$repo_dir/.scratch/tauri-vue-editor/windows-cross-build.Dockerfile" \
  --tag "$image_name" \
  "$repo_dir"

docker run --rm \
  --volume "$target_dir:/workspace/apps/desktop/src-tauri/target" \
  --volume "$xwin_cache_dir:/xwin-cache" \
  --workdir /workspace \
  "$image_name" \
  pnpm tauri build \
    --runner cargo-xwin \
    --target "$target_triple" \
    --bundles nsis \
    --ci

installer_source="$target_dir/$target_triple/release/bundle/nsis/$installer_name"
application_source="$target_dir/$target_triple/release/pdf2plt.exe"
release_dir="$repo_dir/dist/release"
installer_target="$release_dir/$installer_name"
installer_temporary="$release_dir/.$installer_name.new"

if [[ ! -s "$installer_source" ]]; then
  echo "Windows NSIS 安装包不存在或为空：$installer_source" >&2
  exit 1
fi

if [[ ! -s "$application_source" ]]; then
  echo "Windows 可视化程序不存在或为空：$application_source" >&2
  exit 1
fi

application_kind="$(file -b "$application_source")"
if [[ "$application_kind" != *"PE32+"* \
  || "$application_kind" != *"(GUI)"* \
  || "$application_kind" != *"x86-64"* ]]; then
  echo "Windows 主程序不是 x64 GUI 可执行文件：$application_kind" >&2
  exit 1
fi

mkdir -p "$release_dir"
install -m 0644 "$installer_source" "$installer_temporary"
mv -f -- "$installer_temporary" "$installer_target"

printf '%s: %s\n' "$application_source" "$application_kind"
file "$installer_target"
sha256sum "$installer_target"
