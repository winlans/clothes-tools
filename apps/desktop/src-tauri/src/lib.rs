use std::path::{Path, PathBuf};

use tauri_plugin_fs::FsExt;

fn canonical_pdf_path(path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);
    let is_pdf = candidate
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"));
    if !is_pdf {
        return Err("工程源文件必须是 PDF。".into());
    }

    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("无法访问工程源 PDF：{error}"))?;
    if !canonical.is_file() {
        return Err("工程源 PDF 不是普通文件。".into());
    }
    Ok(canonical)
}

#[tauri::command]
fn allow_pdf_read_scope(window: tauri::WebviewWindow, path: String) -> Result<String, String> {
    let canonical = canonical_pdf_path(&path)?;
    window
        .fs_scope()
        .allow_file(&canonical)
        .map_err(|error| format!("无法授权读取工程源 PDF：{error}"))?;
    Ok(canonical.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![allow_pdf_read_scope])
        .run(tauri::generate_context!())
        .expect("failed to run pdf2plt");
}

#[cfg(test)]
mod tests {
    use super::canonical_pdf_path;

    #[test]
    fn rejects_non_pdf_project_sources() {
        let error = canonical_pdf_path("/tmp/layout.svg").unwrap_err();
        assert_eq!(error, "工程源文件必须是 PDF。");
    }
}
