#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "用法：$0 /path/to/pdf2plt.AppImage" >&2
  exit 2
fi

appimage_path="$(realpath "$1")"
if [[ ! -x "$appimage_path" ]]; then
  echo "AppImage 不存在或不可执行：$appimage_path" >&2
  exit 2
fi

work_dir="$(mktemp -d /tmp/pdf2plt-appimage-check.XXXXXX)"
trap 'rm -rf -- "$work_dir"' EXIT

(
  cd "$work_dir"
  "$appimage_path" --appimage-extract >/dev/null
)

app_dir="$work_dir/squashfs-root"
lib_dir="$app_dir/usr/lib"
mapfile -d '' conflicting_libraries < <(
  find "$lib_dir" -maxdepth 1 \( -type f -o -type l \) \
    \( \
      -name 'libwayland-*.so*' -o \
      -name 'libglib-2.0.so*' -o \
      -name 'libgio-2.0.so*' -o \
      -name 'libgobject-2.0.so*' -o \
      -name 'libgmodule-2.0.so*' -o \
      -name 'libgst*.so*' -o \
      -name 'libmount.so*' -o \
      -name 'libblkid.so*' -o \
      -name 'libselinux.so*' -o \
      -name 'libpcre2-8.so*' -o \
      -name 'libzstd.so*' -o \
      -name 'libelf.so*' -o \
      -name 'libffi.so*' \
    \) -print0
)

if (( ${#conflicting_libraries[@]} > 0 )); then
  echo "AppImage 仍包含会与新版 Mesa/GLib 冲突的基础库：" >&2
  printf '  %s\n' "${conflicting_libraries[@]##*/}" | sort >&2
  exit 1
fi

if ! grep -q 'PDF2PLT_HOST_GSTREAMER_PATHS' "$app_dir/AppRun"; then
  echo "AppRun 未恢复主机 GStreamer 插件搜索路径。" >&2
  exit 1
fi

echo "AppImage 新版 Mesa/GLib 兼容性检查通过。"
