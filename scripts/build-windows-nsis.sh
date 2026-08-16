#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/.." && pwd)"
image_name="${PDF2PLT_WINDOWS_IMAGE:-pdf2plt-windows-cross-build:bookworm}"
target_dir="${PDF2PLT_WINDOWS_TARGET_DIR:-/tmp/pdf2plt-windows-target}"
xwin_cache_dir="${PDF2PLT_XWIN_CACHE_DIR:-/tmp/pdf2plt-xwin-cache}"
tauri_cache_dir="${PDF2PLT_TAURI_CACHE_DIR:-/tmp/pdf2plt-tauri-cache}"
target_triple="x86_64-pc-windows-msvc"
installer_name="pdf2plt_0.1.7_x64-setup.exe"

mkdir -p "$target_dir" "$xwin_cache_dir" "$tauri_cache_dir"

docker build \
  --file "$repo_dir/.scratch/tauri-vue-editor/windows-cross-build.Dockerfile" \
  --tag "$image_name" \
  "$repo_dir"

set +e
docker run --rm \
  --volume "$target_dir:/workspace/apps/desktop/src-tauri/target" \
  --volume "$xwin_cache_dir:/xwin-cache" \
  --volume "$tauri_cache_dir:/root/.cache/tauri" \
  --env "PDF2PLT_INSTALLER_NAME=$installer_name" \
  --workdir /workspace \
  "$image_name" \
  bash -lc '
    set -euo pipefail
    nsis_dir="/workspace/apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/nsis/x64"
    bundle_dir="/workspace/apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis"
    rm -f "$nsis_dir/installer.nsi" "$nsis_dir/nsis-output.exe" \
      "$bundle_dir/$PDF2PLT_INSTALLER_NAME"
    pnpm tauri build \
      --runner cargo-xwin \
      --target x86_64-pc-windows-msvc \
      --bundles nsis \
      --ci
  '
tauri_status=$?
set -e

if [[ $tauri_status -ne 0 ]]; then
  installer_script="$target_dir/$target_triple/release/nsis/x64/installer.nsi"
  if [[ ! -s "$installer_script" ]]; then
    exit "$tauri_status"
  fi

  # Debian NSIS 3.08 can segfault while adding the UTF-8 user guide. Use a fresh
  # container for the generated NSIS stage and package a Windows-friendly UTF-16
  # copy instead. The source guide and the original solid-LZMA layout stay intact.
  nsis_status=1
  for nsis_attempt in 1 2 3; do
    set +e
    docker run --rm \
      --volume "$target_dir:/workspace/apps/desktop/src-tauri/target" \
      --volume "$tauri_cache_dir:/root/.cache/tauri" \
      --env "PDF2PLT_INSTALLER_NAME=$installer_name" \
      --workdir /workspace \
      "$image_name" \
      bash -lc '
        set -euo pipefail
        nsis_dir="/workspace/apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/nsis/x64"
        bundle_dir="/workspace/apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis"
        packaged_guide="$nsis_dir/USER_GUIDE.windows.md"
        iconv -f UTF-8 -t UTF-16 /workspace/docs/USER_GUIDE.md \
          -o "$packaged_guide"
        sed -i \
          "s|/workspace/apps/desktop/src-tauri/../../../docs/USER_GUIDE.md|$packaged_guide|" \
          "$nsis_dir/installer.nsi"
        sed -i -E "s/^([[:space:]]*)File \/a /\\1File /" \
          "$nsis_dir/installer.nsi"
        test "$(grep -c "File .*USER_GUIDE\\.md" \
          "$nsis_dir/installer.nsi")" -eq 1
        cd "$nsis_dir"
        rm -f nsis-output.exe
        makensis -V2 -OUTPUTCHARSET UTF8 installer.nsi
        mkdir -p "$bundle_dir"
        install -m 0644 nsis-output.exe \
          "$bundle_dir/$PDF2PLT_INSTALLER_NAME"
      '
    nsis_status=$?
    set -e
    if [[ $nsis_status -eq 0 ]]; then
      break
    fi
    printf 'NSIS fresh-container retry %d/3 failed with status %d\n' \
      "$nsis_attempt" "$nsis_status" >&2
  done
  if [[ $nsis_status -ne 0 ]]; then
    exit "$nsis_status"
  fi
fi

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
