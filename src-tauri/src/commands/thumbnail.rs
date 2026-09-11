// ============================================================================
// 模块说明（中文）
// 缩略图生成命令。对应开发计划书 17.5（命令签名）与 17.7（缩略图与性能策略）。
//
//   make_thumbnail(src, space_path) -> Result<ThumbInfo, String>
//
// 行为（严格按 17.7）：
//   · 长边 800px，保持宽高比
//   · 存放于 <空间文件夹>\.mindscape\thumbnails\{hash}.webp
//   · 已存在则直接返回路径（缓存），不重复解码
//   · 缓存失效：hash 的输入包含原文件 mtime，原图一改就自然换新文件
//
// 【技术决策 · 已与用户确认】
//   17.7 要求「webp 质量 80」，但 17.5 指定的 image crate **只支持无损 WebP 编码**
//   （官方文档：only lossless encoding is supported，有损需 libwebp）。
//   用户裁决：保留 .webp 路径约定，用无损编码，不引入额外的 C 依赖。
//   代价是照片类缩略图体积偏大（约为 JPEG q80 的 2~4 倍），换来的是无损画质。
//
// 【hash 的实现选择】
//   不用 std 的 DefaultHasher —— 它不保证跨 Rust 版本的稳定性，升级编译链会让
//   全部缓存失效。这里用自实现的 FNV-1a，简单且输出稳定。
//
// 铁律（17.5）：只做「安全执行 + 明确报错」，不做业务判断。
// ============================================================================

use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// 缩略图长边像素（17.7：长边 800px）
pub const THUMBNAIL_MAX_EDGE: u32 = 800;
/// 数据目录名（第 3 章：`.mindscape`，画布上不显示）
pub const DATA_DIR: &str = ".mindscape";
/// 缩略图子目录名（17.7）
pub const THUMBNAIL_DIR: &str = "thumbnails";

/// 缩略图信息。width/height 是**缩略图**的像素尺寸；
/// 因为生成时严格保持宽高比，所以它同时就是卡片初始宽高比的依据（T1.4）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbInfo {
    pub path: String,
    pub width: u32,
    pub height: u32,
}

/// FNV-1a：稳定、无依赖的字符串 hash（跨编译链版本输出一致）
fn stable_hash(input: &str) -> String {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    let mut hash = OFFSET_BASIS;
    for byte in input.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(PRIME);
    }
    format!("{hash:016x}")
}

/// 取文件的最后修改时间（Unix 毫秒）；取不到时返回 0
fn modified_millis(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// 缩略图缓存文件名：{hash}.webp，hash 由「相对路径 + mtime」决定
pub fn thumbnail_file_name(relative_path: &str, modified_millis: u64) -> String {
    format!("{}.webp", stable_hash(&format!("{relative_path}|{modified_millis}")))
}

fn thumbnails_dir(space_path: &Path) -> PathBuf {
    space_path.join(DATA_DIR).join(THUMBNAIL_DIR)
}

/// 生成缩略图到 `.mindscape/thumbnails/{hash}.webp`；已存在则直接返回（缓存）。
#[tauri::command]
pub fn make_thumbnail(src: String, space_path: String) -> Result<ThumbInfo, String> {
    let src_path = PathBuf::from(&src);
    let space = PathBuf::from(&space_path);

    let metadata = fs::metadata(&src_path).map_err(|error| format!("读取图片信息失败：{error}"))?;
    if !metadata.is_file() {
        return Err(format!("不是文件：{src}"));
    }

    // 缓存标识：相对空间文件夹的路径 + mtime（原图一改就换新文件）
    let relative = src_path
        .strip_prefix(&space)
        .unwrap_or(src_path.as_path())
        .to_string_lossy()
        .to_string();
    let file_name = thumbnail_file_name(&relative, modified_millis(&src_path));

    let thumb_dir = thumbnails_dir(&space);
    let thumb_path = thumb_dir.join(&file_name);

    // 缓存命中：只读图片头拿尺寸，不解码全图
    if thumb_path.is_file() {
        if let Ok((width, height)) = image::image_dimensions(&thumb_path) {
            return Ok(ThumbInfo {
                path: thumb_path.to_string_lossy().to_string(),
                width,
                height,
            });
        }
    }

    // 解码原图。用 image_dimensions 之外的完整解码，因为要真正缩放
    let image = image::ImageReader::open(&src_path)
        .map_err(|error| format!("打开图片失败：{error}"))?
        .with_guessed_format()
        .map_err(|error| format!("识别图片格式失败：{error}"))?
        .decode()
        .map_err(|error| format!("解码图片失败：{error}"))?;

    // thumbnail() 保持宽高比，长边不超过给定值。
    // ⚠️ 实测 image 0.25 的 thumbnail() 会把小图**放大**到目标尺寸，
    //    这里先自行判断：长边已经不超过上限就原样保留，不做无意义的上采样
    //    （放大只会让缩略图更大更慢，画质也不会变好）。
    let long_edge = image.width().max(image.height());
    let thumbnail = if long_edge > THUMBNAIL_MAX_EDGE {
        image.thumbnail(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE)
    } else {
        image
    };
    let width = thumbnail.width();
    let height = thumbnail.height();

    fs::create_dir_all(&thumb_dir).map_err(|error| format!("创建缩略图目录失败：{error}"))?;

    // 统一转 RGBA：图片可能是灰度 / 带透明通道，WebP 编码器只接受 Rgb8 / Rgba8
    let rgba = thumbnail.to_rgba8();

    let file = fs::File::create(&thumb_path).map_err(|error| format!("创建缩略图失败：{error}"))?;
    let writer = BufWriter::new(file);
    image::codecs::webp::WebPEncoder::new_lossless(writer)
        .encode(
            rgba.as_raw(),
            width,
            height,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| format!("写入缩略图失败：{error}"))?;

    Ok(ThumbInfo {
        path: thumb_path.to_string_lossy().to_string(),
        width,
        height,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    /// 每个用例独立的临时空间目录，避免并发互相干扰
    fn temp_space(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("mindscape-thumb-{tag}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_png(path: &Path, width: u32, height: u32) {
        let mut img = RgbaImage::new(width, height);
        for pixel in img.pixels_mut() {
            *pixel = Rgba([90, 125, 106, 255]);
        }
        img.save(path).unwrap();
    }

    #[test]
    fn stable_hash_is_deterministic_and_distinct() {
        assert_eq!(stable_hash("abc"), stable_hash("abc"));
        assert_ne!(stable_hash("abc"), stable_hash("abd"));
        assert_eq!(stable_hash("abc").len(), 16);
    }

    #[test]
    fn thumbnail_file_name_changes_with_mtime() {
        let a = thumbnail_file_name("参考资料/ref-01.jpg", 1000);
        let b = thumbnail_file_name("参考资料/ref-01.jpg", 2000);
        let c = thumbnail_file_name("参考资料/ref-02.jpg", 1000);

        assert!(a.ends_with(".webp"));
        assert_ne!(a, b, "mtime 变化应换新文件（缓存失效）");
        assert_ne!(a, c, "路径变化应换新文件");
    }

    #[test]
    fn missing_file_reports_chinese_error() {
        let space = temp_space("missing");
        let error = make_thumbnail(
            space.join("nope.jpg").to_string_lossy().to_string(),
            space.to_string_lossy().to_string(),
        )
        .unwrap_err();

        assert!(error.contains("读取图片信息失败"), "实际错误：{error}");
        fs::remove_dir_all(&space).ok();
    }

    #[test]
    fn non_image_file_reports_chinese_error() {
        let space = temp_space("not-image");
        let file = space.join("note.txt");
        fs::write(&file, b"hello").unwrap();

        let error = make_thumbnail(
            file.to_string_lossy().to_string(),
            space.to_string_lossy().to_string(),
        )
        .unwrap_err();

        assert!(
            error.contains("解码图片失败") || error.contains("识别图片格式失败"),
            "实际错误：{error}"
        );
        fs::remove_dir_all(&space).ok();
    }

    #[test]
    fn directory_path_reports_not_a_file() {
        let space = temp_space("dir");
        let error = make_thumbnail(
            space.to_string_lossy().to_string(),
            space.to_string_lossy().to_string(),
        )
        .unwrap_err();

        assert!(error.contains("不是文件"), "实际错误：{error}");
        fs::remove_dir_all(&space).ok();
    }

    #[test]
    fn generates_webp_under_thumbnails_and_keeps_aspect_ratio() {
        let space = temp_space("generate");
        let source = space.join("wide.png");
        write_png(&source, 1600, 1200); // 4:3

        let info = make_thumbnail(
            source.to_string_lossy().to_string(),
            space.to_string_lossy().to_string(),
        )
        .unwrap();

        // 落在 .mindscape/thumbnails 下
        let expected_dir = space.join(DATA_DIR).join(THUMBNAIL_DIR);
        assert!(Path::new(&info.path).starts_with(&expected_dir));
        assert!(info.path.ends_with(".webp"));
        assert!(Path::new(&info.path).is_file());

        // 长边不超过 800
        assert!(info.width.max(info.height) <= THUMBNAIL_MAX_EDGE);
        assert_eq!(info.width, THUMBNAIL_MAX_EDGE);
        // 4:3 比例保持
        assert_eq!(info.height, 600);
    }

    #[test]
    fn tall_image_is_limited_by_height() {
        let space = temp_space("tall");
        let source = space.join("tall.png");
        write_png(&source, 600, 1200);

        let info = make_thumbnail(
            source.to_string_lossy().to_string(),
            space.to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(info.height, THUMBNAIL_MAX_EDGE);
        assert_eq!(info.width, 400);
        fs::remove_dir_all(&space).ok();
    }

    #[test]
    fn small_image_is_not_upscaled() {
        let space = temp_space("small");
        let source = space.join("small.png");
        write_png(&source, 320, 240);

        let info = make_thumbnail(
            source.to_string_lossy().to_string(),
            space.to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!((info.width, info.height), (320, 240));
        fs::remove_dir_all(&space).ok();
    }

    #[test]
    fn second_call_reuses_cached_file() {
        let space = temp_space("cache");
        let source = space.join("a.png");
        write_png(&source, 1000, 1000);

        let first = make_thumbnail(
            source.to_string_lossy().to_string(),
            space.to_string_lossy().to_string(),
        )
        .unwrap();
        let second = make_thumbnail(
            source.to_string_lossy().to_string(),
            space.to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(first.path, second.path, "同一原图应命中同一个缓存文件");

        // thumbnails 目录下只有一个文件
        let count = fs::read_dir(space.join(DATA_DIR).join(THUMBNAIL_DIR))
            .unwrap()
            .count();
        assert_eq!(count, 1);
        fs::remove_dir_all(&space).ok();
    }

    #[test]
    fn modified_source_produces_new_thumbnail_file() {
        let space = temp_space("invalidate");
        let source = space.join("b.png");
        write_png(&source, 800, 800);
        let first = make_thumbnail(
            source.to_string_lossy().to_string(),
            space.to_string_lossy().to_string(),
        )
        .unwrap();

        // 改内容并确保 mtime 前进（部分文件系统 mtime 精度为秒）
        std::thread::sleep(std::time::Duration::from_millis(20));
        write_png(&source, 400, 400);
        let second = make_thumbnail(
            source.to_string_lossy().to_string(),
            space.to_string_lossy().to_string(),
        )
        .unwrap();

        assert_ne!(first.path, second.path, "原图变化后应生成新的缩略图");
        assert_eq!(second.width, 400);
        fs::remove_dir_all(&space).ok();
    }
}
