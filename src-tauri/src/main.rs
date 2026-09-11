// ============================================================================
// 模块说明（中文）
// 二进制入口。仅负责调用库里的 run()，保持极薄。
// 首行属性用于在 release 构建下隐藏额外的控制台窗口，请勿删除。
// ============================================================================

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mindscape_canvas_lib::run()
}
