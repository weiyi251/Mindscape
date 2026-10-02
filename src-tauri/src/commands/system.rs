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
//
// 移动端适配 M1（2026-09-21）：
//   · `reveal_in_explorer` 在移动端直接返回中文「桌面专属」提示 —— Android 没有
//     「在文件管理器中选中该文件」的概念，opener 的 reveal_item_in_dir 无移动端实现；
//   · `read_image_size` 全平台保留（纯 Rust 逻辑，只读文件头）。
//
// 移动端适配 M4（2026-09-21）：`open_with_default` 同样改为移动端拒绝。
//   原计划是「保留，安卓能拉起系统查看器」，读插件源码后否决了：自由函数 `open_path`
//   在安卓 shell out 找 xdg-open；插件的移动端 API 发裸字符串而 Kotlin 按对象解析；
//   Kotlin 侧对 `file://` 路径起 ACTION_VIEW 会抛 FileUriExposedException，且空间文件
//   在本应用私有目录里外部应用也无权读。修好要在 gen/android 里加 FileProvider + 自定义
//   Kotlin，代价远超收益 —— 前端隐藏入口（`openWithSystemApp`），这里兜住直接 invoke。
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
///
/// 【为什么不用 `image::image_dimensions`】（2026-09-20 修复）
///   该便捷函数**只按扩展名挑解码器**：文件叫 `.png` 就强制走 PNG 解码器，
///   而不管文件里装的究竟是什么。于是「内容其实是 JPEG、扩展名却写 .png」的
///   文件必然报 `format error decoding Png: Invalid PNG signature`。
///   用户现场：把一张 JPEG 改名成 `粘贴-20260919-1425.png` 放进空间文件夹，
///   进入空间时弹出「图片尺寸读取失败，已按默认尺寸显示」——
///   文件本身完全能看（浏览器 / 看图软件都按内容识别），只有我们读不到尺寸。
///
///   修复：先自己嗅探**文件真实格式**，再让解码器只读图头取尺寸
///   （`with_guessed_format().into_dimensions()` 只读头部字段，不解码全图，
///   与原来一样快）。嗅探不出来时退回扩展名，保持与旧行为一致。
///
/// 铁律（17.5）：只做「安全执行 + 明确报错」，不做业务判断 ——
/// 这里不改名、不搬文件（铁律②③），只是把「读不到」变成「读得到」。
#[tauri::command]
pub fn read_image_size(path: String) -> Result<ImageSize, String> {
    let target = Path::new(&path);

    if !target.is_file() {
        return Err(format!("不是文件：{path}"));
    }

    let (width, height) = read_image_dimensions(target)
        .map_err(|error| format!("读取图片尺寸失败：{error}"))?;

    Ok(ImageSize { width, height })
}

/// 按**文件真实内容**（而非扩展名）解析图片尺寸。
///
/// 先经 `with_guessed_format()` 让 `image` 按文件头魔数选解码器 ——
/// 这样「JPEG 内容 + .png 扩展名」的文件也能正确读出尺寸；
/// 猜不出格式（既非已知魔数、也不是可识别扩展名）时才如实报错。
fn read_image_dimensions(target: &Path) -> Result<(u32, u32), String> {
    let reader = image::ImageReader::open(target)
        .map_err(|error| error.to_string())?
        .with_guessed_format()
        .map_err(|error| error.to_string())?;

    reader
        .into_dimensions()
        .map_err(|error| error.to_string())
}

/// 用系统默认程序打开文件（第九章「双击 PSD/PDF 用对应软件打开」）。
///
/// 借用 tauri-plugin-opener 的 `open_path`（ShellExecute 语义），不用 cmd 拼命令，
/// 避免路径含空格 / 中文时的引号转义问题。
///
/// 移动端 M4（2026-09-21）改为拒绝：安卓的 opener 通道三条硬伤全堵死（见
/// `src/core/system/platformCapabilities.ts` 里 `openWithSystemApp` 的注释）。
/// 前端已经不给这个入口，这里是绕过前端直接 invoke 时的第二道。
#[tauri::command]
pub fn open_with_default(path: String) -> Result<(), String> {
    open_with_default_on(path, cfg!(mobile))
}

/// `open_with_default` 的实现体，`is_mobile` 由 cfg 注入。
///
/// 单独拆出来只为了让「移动端先拒绝、桌面照常走」两个分支能在桌面宿主上测到
/// —— 否则移动分支要 `--target aarch64-linux-android` 才编译得到，跑不了。
fn open_with_default_on(path: String, is_mobile: bool) -> Result<(), String> {
    desktop_only_guard("用系统程序打开文件", is_mobile)?;

    let target = Path::new(&path);

    if !target.exists() {
        return Err(format!("路径不存在：{path}"));
    }

    tauri_plugin_opener::open_path(target, None::<&str>)
        .map_err(|error| format!("打开失败：{path}（{error}）"))
}

/// 应用发布页（GitHub Releases 的 latest 固定链接）。
///
/// URL 固定在 Rust 侧、命令不收前端参数：即使前端被注入，也只能打开这个
/// 写死的地址，不能唤起浏览器去任意 URL。
pub const RELEASE_PAGE_URL: &str = "https://github.com/weiyi251/Mindscape/releases/latest";

/// 在系统浏览器里打开发布页（双端可用）。
///
/// 安卓侧载没有 updater 渠道（lib.rs 里 updater 插件只在桌面装配），
/// 版本更新页在移动端用它引导用户到发布页下载新 APK 覆盖安装；
/// 桌面端自动更新失败时也可手动兜底。走 opener 的 Rust API，
/// 不需要 capabilities 授权（与 open_with_default 同一模式）。
/// 注意：这里刻意**不**套 `desktop_only_guard` —— 本命令就是给移动端用的。
#[tauri::command]
pub fn open_release_page() -> Result<(), String> {
    tauri_plugin_opener::open_url(RELEASE_PAGE_URL, None::<&str>)
        .map_err(|error| format!("打开发布页失败：{error}"))
}

/// 桌面专属能力的统一拒绝口径（纯函数，便于单测；2026-09-21 移动端适配 M1）。
///
/// 前端有平台能力表（`src/core/system/platformCapabilities.ts`）负责不显示这些入口，
/// 这里是**第二道**：绕过前端直接 invoke（插件、脚本、未来的其它前端）也必须拿到
/// 中文提示，而不是底层插件那句英文 `not implemented on mobile`。
fn desktop_only_guard(feature: &str, is_mobile: bool) -> Result<(), String> {
    if is_mobile {
        return Err(format!("{feature}仅在桌面版可用，移动端没有对应的系统能力"));
    }
    Ok(())
}

/// 在资源管理器中定位文件（T3.5 的降级方案：系统未关联打开方式时提示后调用）。
///
/// 移动端直接拒绝：Android 没有「在文件管理器中选中该文件」这一概念
/// （opener 的 `reveal_item_in_dir` 无移动端实现）。前端的能力表已不触发此调用，
/// 这里兜住直接 invoke 的情况。
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    desktop_only_guard("在文件夹中定位文件", cfg!(mobile))?;

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

    /// 回归（2026-09-20）：内容是 JPEG、扩展名却写 `.png` 的文件必须能读出尺寸。
    ///
    /// 用户现场：把一张 JPEG 改名成 `粘贴-20260919-1425.png` 放进空间文件夹，
    /// 进空间时顶部弹「图片尺寸读取失败：format error decoding Png:
    /// Invalid PNG signature」，卡片退回默认尺寸 —— 但文件本身完全正常。
    /// 根因是 `image::image_dimensions` 只按扩展名选解码器。
    #[test]
    fn reads_dimensions_when_extension_lies() {
        let dir = temp_dir("lying-ext");
        let file = dir.join("lying.png"); // ← 关键：名字是 .png
        image::RgbImage::from_pixel(1200, 40, image::Rgb([10, 20, 30]))
            .write_to(
                &mut std::fs::File::create(&file).unwrap(),
                image::ImageFormat::Jpeg, // ← 关键：内容按 JPEG 写
            )
            .unwrap();

        let size = read_image_size(file.to_string_lossy().to_string()).unwrap();
        assert_eq!((size.width, size.height), (1200, 40));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 反向：内容是 PNG、扩展名写 `.jpg` 也要读得出（同一根因的另一半）。
    #[test]
    fn reads_dimensions_when_extension_lies_the_other_way() {
        let dir = temp_dir("lying-ext-2");
        let file = dir.join("lying.jpg");
        image::RgbaImage::from_pixel(30, 90, Rgba([1, 2, 3, 255]))
            .write_to(
                &mut std::fs::File::create(&file).unwrap(),
                image::ImageFormat::Png,
            )
            .unwrap();

        let size = read_image_size(file.to_string_lossy().to_string()).unwrap();
        assert_eq!((size.width, size.height), (30, 90));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 扩展名完全无法识别（如 `.webp` 被启用特性排除、或无扩展名）时仍按内容识别。
    #[test]
    fn reads_dimensions_for_unknown_extension() {
        let dir = temp_dir("no-ext");
        let file = dir.join("no-extension");
        image::RgbImage::from_pixel(7, 5, image::Rgb([9, 9, 9]))
            .write_to(
                &mut std::fs::File::create(&file).unwrap(),
                image::ImageFormat::Jpeg,
            )
            .unwrap();

        let size = read_image_size(file.to_string_lossy().to_string()).unwrap();
        assert_eq!((size.width, size.height), (7, 5));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 真正损坏的文件仍如实报错（不能因为改了读取路径就把错误吞掉）。
    #[test]
    fn corrupt_image_still_reports_error() {
        let dir = temp_dir("corrupt");
        let file = dir.join("broken.png");
        // PNG 魔数正确、但后面全是垃圾 → 必须报错，不能返回假尺寸
        std::fs::write(&file, b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRgarbage").unwrap();

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

    // ---- 移动端 M4（2026-09-21）：安卓上「交给系统应用打开」整条通道断开 ----

    #[test]
    fn open_with_default_refuses_on_mobile_before_touching_the_path() {
        // 路径不存在也拿不到「路径不存在」，说明它在任何文件系统/系统调用之前就被挡住了
        let missing = std::env::temp_dir().join("mindscape-m4-open-mobile");
        let error = open_with_default_on(missing.to_string_lossy().into_owned(), true)
            .unwrap_err();
        assert!(error.contains("用系统程序打开文件"), "实际错误：{error}");
        assert!(error.contains("仅在桌面版可用"), "实际错误：{error}");
    }

    #[test]
    fn open_with_default_still_validates_the_path_on_desktop() {
        // 红线 R2：桌面分支一个字都不能变 —— 移动端那道闸不能把桌面也挡了
        let missing = std::env::temp_dir().join("mindscape-m4-open-desktop");
        let error = open_with_default_on(missing.to_string_lossy().into_owned(), false)
            .unwrap_err();
        assert!(error.contains("路径不存在"), "实际错误：{error}");
    }

    // ---- 移动端 M1（2026-09-21）：桌面专属能力的拒绝口径 ----
    // 宿主测试跑在桌面 cfg 下（`cfg!(mobile)` 恒为 false），所以这里测的是纯函数的两个分支；
    // 安卓上的真实分叉由 `cargo check --target aarch64-linux-android` 保证编译期正确。

    #[test]
    fn desktop_only_guard_names_the_feature_in_chinese() {
        let error = desktop_only_guard("在文件夹中定位文件", true).unwrap_err();
        assert!(error.contains("在文件夹中定位文件"), "实际错误：{error}");
        assert!(error.contains("仅在桌面版可用"), "实际错误：{error}");
    }

    #[test]
    fn desktop_only_guard_lets_desktop_through() {
        assert!(desktop_only_guard("在文件夹中定位文件", false).is_ok());
    }

    #[test]
    fn release_page_url_points_to_projects_latest_release() {
        // 守卫常量而非真开浏览器：URL 必须是本仓库发布页的固定链接，
        // 防止将来手滑改成别的站点（命令不收前端参数，这是唯一入口）。
        assert_eq!(
            RELEASE_PAGE_URL,
            "https://github.com/weiyi251/Mindscape/releases/latest"
        );
    }
}
