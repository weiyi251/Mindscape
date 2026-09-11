// ============================================================================
// 模块说明（中文）
// 系统集成命令。对应开发计划书 17.5 的 system.rs 部分：
//
//   open_with_default(path)  -> Result<(), String>       用系统默认程序打开文件（第九章）
//   reveal_in_explorer(path) -> Result<(), String>       在资源管理器中定位（降级方案）
//   read_image_size(path)    -> Result<ImageSize, String> 读取图片原始尺寸
//
// 【实现进度】
//   T1.4 —— read_image_size（卡片按图片原始宽高比显示）。
//   T3.5 —— open_with_default / reveal_in_explorer：
//           借用已装配的 tauri-plugin-opener 的公开 API（open_path / reveal_item_in_dir），
//           不自行拼 cmd 命令、不引入新依赖；错误统一翻译成中文（17.5 铁律）。
//
// 铁律（17.5）：只做「安全执行 + 明确报错」，不做业务判断。
// ============================================================================

use std::path::Path;

use serde::Serialize;

/// 图片原始尺寸
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSize {
    pub width: u32,
    pub height: u32,
}

/// 读取图片原始宽高（只解析文件头，不解码像素，很快）
#[tauri::command]
pub fn read_image_size(path: String) -> Result<ImageSize, String> {
    let target = Path::new(&path);

    if !target.is_file() {
        return Err(format!("不是文件：{path}"));
    }

    let (width, height) =
        image::image_dimensions(target).map_err(|error| format!("读取图片尺寸失败：{error}"))?;

    Ok(ImageSize { width, height })
}

/// 用系统默认程序打开文件（第九章「双击 PSD/PDF 用对应软件打开」）。
///
/// 借用 tauri-plugin-opener 的 `open_path`（ShellExecute 语义），不用 cmd 拼命令，
/// 避免路径含空格 / 中文时的引号转义问题。
#[tauri::command]
pub fn open_with_default(path: String) -> Result<(), String> {
    let target = Path::new(&path);

    if !target.exists() {
        return Err(format!("路径不存在：{path}"));
    }

    tauri_plugin_opener::open_path(target, None::<&str>)
        .map_err(|error| format!("打开失败：{path}（{error}）"))
}

/// 在资源管理器中定位文件（T3.5 的降级方案：系统未关联打开方式时提示后调用）。
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let target = Path::new(&path);

    if !target.exists() {
        return Err(format!("路径不存在：{path}"));
    }

    tauri_plugin_opener::reveal_item_in_dir(target)
        .map_err(|error| format!("定位失败：{path}（{error}）"))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("mindscape-size-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_png_dimensions() {
        let dir = temp_dir("png");
        let file = dir.join("shot.png");
        RgbaImage::from_pixel(320, 200, Rgba([10, 20, 30, 255]))
            .save(&file)
            .unwrap();

        let size = read_image_size(file.to_string_lossy().to_string()).unwrap();
        assert_eq!(size, ImageSize { width: 320, height: 200 });
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reads_jpeg_dimensions() {
        let dir = temp_dir("jpeg");
        let file = dir.join("photo.jpg");
        // ⚠️ JPEG 没有 alpha 通道，用 RgbImage 写；RgbaImage 会被编码器拒收
        image::RgbImage::from_pixel(64, 48, image::Rgb([200, 100, 50]))
            .save(&file)
            .unwrap();

        let size = read_image_size(file.to_string_lossy().to_string()).unwrap();
        assert_eq!((size.width, size.height), (64, 48));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_file_reports_chinese_error() {
        let dir = temp_dir("missing");
        let error = read_image_size(dir.join("nope.png").to_string_lossy().to_string()).unwrap_err();
        assert!(error.contains("不是文件"), "实际错误：{error}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn non_image_reports_chinese_error() {
        let dir = temp_dir("text");
        let file = dir.join("a.txt");
        std::fs::write(&file, b"not an image").unwrap();

        let error = read_image_size(file.to_string_lossy().to_string()).unwrap_err();
        assert!(error.contains("读取图片尺寸失败"), "实际错误：{error}");
        std::fs::remove_dir_all(&dir).ok();
    }

    // ---- T3.5 acceptance: open_with_default / reveal_in_explorer ----
    // （真实弹窗的分支无法在 CI 里稳定验证，这里只覆盖「路径不存在」的防御分支：
    //   绝不能在无参数校验时把用户路径直接丢给 ShellExecute。）

    #[test]
    fn open_with_default_rejects_missing_path_in_chinese() {
        let missing = std::env::temp_dir().join("mindscape-t35-open-missing-xyz");
        let error =
            open_with_default(missing.to_string_lossy().into_owned()).unwrap_err();
        assert!(error.contains("路径不存在"), "实际错误：{error}");
    }

    #[test]
    fn reveal_in_explorer_rejects_missing_path_in_chinese() {
        let missing = std::env::temp_dir().join("mindscape-t35-reveal-missing-xyz");
        let error =
            reveal_in_explorer(missing.to_string_lossy().into_owned()).unwrap_err();
        assert!(error.contains("路径不存在"), "实际错误：{error}");
    }
}
