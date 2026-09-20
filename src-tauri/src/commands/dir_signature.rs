// ============================================================================
// 模块说明（中文）
// 目录内容签名（A1：空间文件夹的外部变动感知，2026-09-20 用户计划第 3 步）。
//
// 用途：画布打开期间，用户可能在资源管理器里增删改文件。应用不做常驻 watch
//   （用户裁决：只在**窗口重新聚焦**与**手动重新扫描**时比对），因此需要一个
//   「此刻文件夹长什么样」的廉价指纹 —— 就是本命令返回的 hash。
//
// 覆盖范围与前端扫描口径**严格一致**（两层，不递归更深）：
//   · 根目录下的普通文件 + 一层子目录（分区）；
//   · 每个子目录下的普通文件；
//   · 一律跳过以 `.` 开头的项（隐藏文件 / `.mindscape`）与保留目录 `_已移除`
//     —— 这些项不会出现在画布上，改动它们不该惊动用户。
//
// 签名算法：把每条记录的「类型 + 相对路径 + 大小 + 修改时间（毫秒）」拼成一行，
//   **按行排序后**串成字节流，再取 FNV-1a 64 位哈希。排序保证与文件系统返回顺序无关。
//   自己实现 FNV-1a（十几行）而不引第三方：签名只在同一进程会话内用于「变了没有」的
//   比对，不需要跨版本稳定性，但需要**可单元测试**与零依赖（17 章不引未批准库）。
//
// 铁律（17.5）：返回 Result<T, String>，错误信息用中文、可直接展示；
//   接受绝对路径、不做隐式路径拼接；本层不做业务判断（「变了怎么办」由前端决定）。
//
// 实现日期：2026-09-20。
// ============================================================================

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use super::fs_ops::io_error_message;

/// 不参与签名的保留目录（与前端 core/board/partitions.ts 的 PARTITION_RESERVED_NAMES 一致）
const RESERVED_DIR_NAMES: [&str; 1] = ["_已移除"];

/// 目录内容签名（返回给前端的轻量 DTO，字段名为 camelCase）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirSignature {
    /// 内容签名（FNV-1a 64 位，16 位小写十六进制）
    pub hash: String,
    /// 参与签名的文件数（根目录 + 一层子目录）
    pub files: usize,
    /// 参与签名的一层子目录数
    pub dirs: usize,
}

/// 该目录项是否参与签名（跳过隐藏项与保留目录，与前端扫描口径一致）。
fn is_visible(name: &str, is_dir: bool) -> bool {
    if name.starts_with('.') {
        return false;
    }
    !(is_dir && RESERVED_DIR_NAMES.contains(&name))
}

/// 取修改时间的 Unix 毫秒；取不到（或早于 1970）返回 0，不报错。
fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// 列出目录下的可见项；单个项读取失败时跳过（与 list_dir 同策略，不因一个坏项整体失败）。
fn visible_entries(dir: &Path) -> std::io::Result<Vec<fs::DirEntry>> {
    let mut out = Vec::new();
    for item in fs::read_dir(dir)? {
        let entry = match item {
            Ok(entry) => entry,
            Err(err) => {
                eprintln!(
                    "[dir_signature] 跳过无法读取的目录项：{}（{err}）",
                    dir.to_string_lossy()
                );
                continue;
            }
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.metadata().map(|m| m.is_dir()).unwrap_or(false);
        if is_visible(&name, is_dir) {
            out.push(entry);
        }
    }
    Ok(out)
}

/// 收集签名素材行（已排序）：`d\0名字` 或 `f\0相对路径\0大小\0修改时间`。
///
/// 相对路径用 `/` 分隔（与前端 card.filePath 一致），保证跨平台可比。
fn signature_lines(root: &Path) -> std::io::Result<(Vec<String>, usize, usize)> {
    let mut lines: Vec<String> = Vec::new();
    let mut files = 0usize;
    let mut dirs = 0usize;

    for entry in visible_entries(root)? {
        let name = entry.file_name().to_string_lossy().into_owned();
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(err) => {
                eprintln!("[dir_signature] 跳过无法读取元数据的项：{name}（{err}）");
                continue;
            }
        };

        if metadata.is_dir() {
            dirs += 1;
            lines.push(format!("d\0{name}"));
            // 一层子目录：只统计其中的文件，不再往下递归
            for child in visible_entries(&entry.path())? {
                let child_metadata = match child.metadata() {
                    Ok(metadata) => metadata,
                    Err(err) => {
                        eprintln!(
                            "[dir_signature] 跳过无法读取元数据的项：{}（{err}）",
                            child.path().to_string_lossy()
                        );
                        continue;
                    }
                };
                if child_metadata.is_dir() {
                    // 更深层不参与扫描，但目录存在本身要进签名（否则改名/删除察觉不到）
                    lines.push(format!("d\0{name}/{}", child.file_name().to_string_lossy()));
                    continue;
                }
                files += 1;
                lines.push(format!(
                    "f\0{name}/{}\0{}\0{}",
                    child.file_name().to_string_lossy(),
                    child_metadata.len(),
                    modified_ms(&child_metadata)
                ));
            }
            continue;
        }

        files += 1;
        lines.push(format!(
            "f\0{name}\0{}\0{}",
            metadata.len(),
            modified_ms(&metadata)
        ));
    }

    lines.sort();
    Ok((lines, files, dirs))
}

/// FNV-1a 64 位哈希（自实现，零依赖、可单测）。
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// 计算空间文件夹的内容签名（两层，见模块说明）。
///
/// 路径不存在 / 无权限 → Err(中文消息)，与其余命令保持同一错误风格。
#[tauri::command]
pub fn dir_signature(path: String) -> Result<DirSignature, String> {
    let root = Path::new(&path);
    let (lines, files, dirs) = signature_lines(root).map_err(|err| io_error_message(&path, &err))?;
    let joined = lines.join("\n");

    Ok(DirSignature {
        hash: format!("{:016x}", fnv1a64(joined.as_bytes())),
        files,
        dirs,
    })
}

// ---------------------------------------------------------------------------
// Tests（A1）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn unique_dir(tag: &str) -> PathBuf {
        let seq = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "mindscape-a1-{tag}-{}-{seq}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("无法创建测试临时目录");
        dir
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    fn signature(dir: &Path) -> DirSignature {
        dir_signature(dir.to_string_lossy().into_owned()).expect("签名失败")
    }

    #[test]
    fn signature_is_stable_for_unchanged_folder() {
        let root = unique_dir("stable");
        fs::write(root.join("a.jpg"), b"aaaa").unwrap();
        fs::create_dir(root.join("参考资料")).unwrap();
        fs::write(root.join("参考资料").join("b.jpg"), b"bbbbbb").unwrap();

        let first = signature(&root);
        let second = signature(&root);

        assert_eq!(first, second);
        assert_eq!(first.files, 2);
        assert_eq!(first.dirs, 1);
        assert_eq!(first.hash.len(), 16);

        cleanup(&root);
    }

    #[test]
    fn signature_changes_when_file_content_size_changes() {
        let root = unique_dir("size");
        fs::write(root.join("a.jpg"), b"aaaa").unwrap();
        let before = signature(&root);

        fs::write(root.join("a.jpg"), b"aaaaaa").unwrap();
        let after = signature(&root);

        assert_ne!(before, after);
        assert_eq!(after.files, 1);

        cleanup(&root);
    }

    #[test]
    fn signature_changes_when_files_are_added_or_removed() {
        let root = unique_dir("count");
        let before = signature(&root);

        fs::write(root.join("new.jpg"), b"x").unwrap();
        let added = signature(&root);
        assert_ne!(before, added);
        assert_eq!(added.files, 1);

        fs::remove_file(root.join("new.jpg")).unwrap();
        assert_eq!(signature(&root), before);

        cleanup(&root);
    }

    #[test]
    fn signature_counts_files_inside_subfolders_and_notices_dir_rename() {
        let root = unique_dir("sub");
        fs::create_dir(root.join("旧名")).unwrap();
        fs::write(root.join("旧名").join("a.jpg"), b"a").unwrap();
        let before = signature(&root);
        assert_eq!(before.files, 1);
        assert_eq!(before.dirs, 1);

        fs::rename(root.join("旧名"), root.join("新名")).unwrap();
        let after = signature(&root);

        assert_ne!(before, after, "子文件夹改名必须被察觉");
        assert_eq!(after.files, 1);

        cleanup(&root);
    }

    #[test]
    fn hidden_items_and_reserved_dir_do_not_affect_signature() {
        let root = unique_dir("hidden");
        fs::write(root.join("keep.jpg"), b"k").unwrap();
        let before = signature(&root);

        fs::create_dir(root.join(".mindscape")).unwrap();
        fs::write(root.join(".mindscape").join("layout.json"), b"{}").unwrap();
        fs::create_dir(root.join("_已移除")).unwrap();
        fs::write(root.join("_已移除").join("old.jpg"), b"o").unwrap();
        fs::write(root.join(".hidden"), b"h").unwrap();

        let after = signature(&root);
        assert_eq!(before, after, "隐藏项与保留目录不应影响签名");

        cleanup(&root);
    }

    #[test]
    fn nested_deeper_than_two_levels_is_not_scanned() {
        let root = unique_dir("depth");
        let deep = root.join("A").join("B").join("C");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("deep.jpg"), b"d").unwrap();

        let sig = signature(&root);
        // 只扫两层：根目录下的 A 是一层子目录，A/B 记为目录（不递归进 C）
        assert_eq!(sig.files, 0);
        assert_eq!(sig.dirs, 1);

        cleanup(&root);
    }

    #[test]
    fn missing_path_reports_chinese_error() {
        let root = unique_dir("missing");
        let gone = root.join("不存在");
        let err = dir_signature(gone.to_string_lossy().into_owned()).unwrap_err();

        assert!(err.contains("路径不存在"), "实际错误：{err}");

        cleanup(&root);
    }

    #[test]
    fn fnv1a64_matches_known_vectors() {
        // FNV-1a 64 的空输入 = 偏移基数
        assert_eq!(fnv1a64(b""), 0xcbf2_9ce4_8422_2325);
        // "a" 的已知结果（FNV-1a 64）
        assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
    }
}
