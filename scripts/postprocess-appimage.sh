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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work_dir="$(mktemp -d /tmp/pdf2plt-appimage-postprocess.XXXXXX)"
trap 'rm -rf -- "$work_dir"' EXIT

runtime_offset="$($appimage_path --appimage-offset)"
if [[ ! "$runtime_offset" =~ ^[0-9]+$ ]] || (( runtime_offset < 4096 )); then
  echo "无法从原始 AppImage 读取有效 runtime 偏移量：$runtime_offset" >&2
  exit 1
fi
runtime_path="$work_dir/runtime-x86_64"
head -c "$runtime_offset" "$appimage_path" >"$runtime_path"

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

if (( ${#conflicting_libraries[@]} == 0 )); then
  echo "未找到需要移除的 AppImage 基础库；打包器输出可能已经变化。" >&2
  exit 1
fi

printf '移除 %d 个与新版 Mesa/GLib 冲突的 AppImage 基础库。\n' \
  "${#conflicting_libraries[@]}"
rm -f -- "${conflicting_libraries[@]}"
install -m 0755 "$script_dir/appimage/AppRun" "$app_dir/AppRun"

appimagetool_version="1.9.1"
appimagetool_sha256="ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0"
appimagetool_path="$work_dir/appimagetool-x86_64.AppImage"
curl --fail --location --silent --show-error \
  "https://github.com/AppImage/appimagetool/releases/download/$appimagetool_version/appimagetool-x86_64.AppImage" \
  --output "$appimagetool_path"
printf '%s  %s\n' "$appimagetool_sha256" "$appimagetool_path" | sha256sum --check --status
chmod +x "$appimagetool_path"

repacked_path="$work_dir/$(basename "$appimage_path")"
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 \
  "$appimagetool_path" --no-appstream --runtime-file "$runtime_path" \
  "$app_dir" "$repacked_path" >/dev/null
chmod +x "$repacked_path"
mv -f -- "$repacked_path" "$appimage_path"

"$script_dir/check-appimage-compat.sh" "$appimage_path"
sha256sum "$appimage_path"
