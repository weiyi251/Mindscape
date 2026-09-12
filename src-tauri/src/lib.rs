// ============================================================================
// 模块说明（中文）
// Tauri 后端入口。负责创建应用实例、注册插件与自定义命令模块。
//
// 对应开发计划书 17.1 / 17.10：
//   - Tauri v2 的插件必须在 capabilities/default.json 中显式授权后才能调用
//   - 空间文件夹内的文件读写一律走 commands/ 下的自定义命令（路径是用户任选的，
//     fs 插件无法预置 scope）；唯一例外是固定路径的 %APPDATA%\Mindscape\spaces.json，
//     它走 fs 插件（17.10 声明的 fs 权限就是为此），详见 core/storage/spacesFile.ts
//
// 本模块只做「装配」，不含任何业务判断（17.5 铁律）。
// ============================================================================

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // 应用内检查更新。检查端点与签名公钥配置在 tauri.conf.json 的 plugins.updater，
        // 这里只负责装配（17.5 铁律：本模块不含业务判断）。
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 更新安装完成后重启应用
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::fs_ops::list_dir,
            commands::fs_ops::create_dir,
            commands::fs_ops::dir_exists,
            commands::fs_ops::copy_file,
            commands::fs_ops::move_file,
            commands::fs_ops::move_files,
            commands::fs_ops::rename_dir,
            commands::fs_ops::delete_file,
            commands::fs_ops::write_file_bytes,
            commands::layout::read_layout,
            commands::layout::write_layout,
            commands::thumbnail::make_thumbnail,
            commands::system::read_image_size,
            commands::system::open_with_default,
            commands::system::reveal_in_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
