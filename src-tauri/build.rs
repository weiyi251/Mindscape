// ============================================================================
// 构建脚本说明（中文）
// Tauri 构建脚本。tauri-build 负责：能力/权限清单、Windows 资源嵌入
// （应用图标 icon.ico / 版本信息 / manifest）、配置代码生成。
//
// ⚠️ 2026-09-12 补充：tauri-build 自身只对 tauri.conf.json 声明 rerun-if-changed，
//   **不监听图标文件** —— 单独替换 icons/icon.ico 不会触发重嵌图标。
//   这里显式补上监听；注意 build 脚本重跑后 cargo 仍可能不重链接 exe
//   （构建输出内容不变时 bin 指纹不失效），generate-icon.mjs 在生成图标后
//   会 utimes 触碰 src/main.rs 强制下一次构建重链接。
// ============================================================================

fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
