// This file stays thin on purpose (see CLAUDE.md conventions): it just
// wires up plugins. File access (open/save dialogs, reading/writing .rms
// files) is handled entirely by the dialog and fs plugins below — there's
// no hand-written Rust command for it. See the frontend's
// src/hooks/useDocument.ts for why file I/O has to happen on this side of
// the process boundary at all.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
