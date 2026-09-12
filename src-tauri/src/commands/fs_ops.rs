// ============================================================================
// 模块说明（中文）
// 文件与目录操作命令。对应开发计划书 17.5「Rust 侧命令清单」。
//
// 本文件（T0.5 / T2.1）实现：
//   list_dir                  —— 列出目录内容（一层，不递归）
//   create_dir                —— 创建目录（不存在时）
//   dir_exists                —— 检测目录是否存在
//   copy_file                 —— 复制文件到目标目录（重名自动加 _1）
//   move_file                 —— 移动文件到目标完整路径（自动建目录 + 重名加后缀）
//   move_files                —— 批量移动，返回成功 / 失败清单
//
// 【历史注记】copy_image_with_thumbnail（复制图片并生成缩略图）已于 2026-09-12
//   随「方案 A：空间文件夹内不再生成缩略图，卡片直接加载原图」的用户裁决移除 ——
//   图片复制与普通文件复制已无差别，前端统一走 copy_file。
//   thumbnail.rs 的 make_thumbnail 命令保留未删（回退保命符）。
//
// 【T2.1 的实现取舍】（17.5 未写明，按文档精神定）
//   重名策略：`名称.ext` 已存在 → `名称_1.ext` → `名称_2.ext`…（第 8.1 节示例），
//   尝试上限 MAX_CONFLICT_ATTEMPTS 次后改用「名称_时间戳」兜底，绝不覆盖已有文件。
//
// 铁律（17.5）：
//   - 所有命令返回 Result<T, String>，错误信息用中文，可直接展示给用户
//   - 路径参数一律为绝对路径，本层不做任何隐式路径拼接
//   - 禁止在本层做业务判断（如「该不该移除」），只做「安全执行 + 明确报错」
// ============================================================================

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// 目录项（返回给前端的轻量 DTO）。
///
/// 字段名序列化为 camelCase，便于前端直接消费。
/// `modified_at` 为 Unix 毫秒时间戳；取不到时返回 null（不报错）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    /// 文件名（不含目录部分）
    pub name: String,
    /// 完整路径（绝对路径）
    pub path: String,
    /// 是否为目录
    pub is_dir: bool,
    /// 字节大小；目录恒为 0（Windows 下目录的 metadata.len() 也是 0）
    pub size: u64,
    /// 最后修改时间（Unix 毫秒）
    pub modified_at: Option<u64>,
}

/// 把 io 错误翻译成可直接展示给用户的中文消息。
///
/// 单独抽成函数，便于对「无权限」这类难以在测试里稳定构造的分支做单元测试。
pub fn io_error_message(path: &str, err: &io::Error) -> String {
    match err.kind() {
        io::ErrorKind::NotFound => format!("路径不存在：{path}"),
        io::ErrorKind::PermissionDenied => format!("无权限访问：{path}"),
        io::ErrorKind::NotADirectory => format!("不是文件夹：{path}"),
        io::ErrorKind::AlreadyExists => format!("已存在同名文件或文件夹：{path}"),
        io::ErrorKind::InvalidInput => format!("路径不合法：{path}"),
        _ => format!("操作失败：{path}（{err}）"),
    }
}

/// 将一次目录项读取结果转换为 DirEntry；返回 None 表示「按规则跳过」。
fn to_dir_entry(entry: &fs::DirEntry) -> io::Result<Option<DirEntry>> {
    let path = entry.path();

    // 使用 metadata()（会跟随符号链接），与用户在资源管理器里看到的一致
    let metadata = entry.metadata()?;
    let is_dir = metadata.is_dir();

    // 17.5：跳过以 . 开头的目录（含 .mindscape）。
    // 仅跳过「目录」，隐藏文件（如 .gitignore 之类）照常返回，由前端决定是否显示。
    if is_dir {
        let hidden = path
            .file_name()
            .map(|name| name.to_string_lossy().starts_with('.'))
            .unwrap_or(false);
        if hidden {
            return Ok(None);
        }
    }

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);

    Ok(Some(DirEntry {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        is_dir,
        size: metadata.len(),
        modified_at,
    }))
}

/// 列出目录内容（一层，不递归）。
///
/// 返回内容不排序 —— 顺序策略属于前端（自动布局 / 视图）的职责，本层只如实返回。
/// 单个目录项读取失败时跳过并记录，不影响其余项（对应第十六章风险清单）。
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let dir = Path::new(&path);
    let entries = fs::read_dir(dir).map_err(|err| io_error_message(&path, &err))?;

    let mut out: Vec<DirEntry> = Vec::new();

    for item in entries {
        let entry = match item {
            Ok(entry) => entry,
            Err(err) => {
                eprintln!("[list_dir] 跳过无法读取的目录项：{path}（{err}）");
                continue;
            }
        };

        match to_dir_entry(&entry) {
            Ok(Some(entry)) => out.push(entry),
            Ok(None) => {}
            Err(err) => {
                eprintln!(
                    "[list_dir] 跳过无法读取元数据的目录项：{}（{err}）",
                    entry.path().to_string_lossy()
                );
            }
        }
    }

    Ok(out)
}

/// 创建目录（含多级父目录）；目录已存在时直接返回成功。
///
/// 用 create_dir_all 的原因：`_已移除\参考资料\` 这类目标需要按原文件夹结构逐级建立
/// （见第 7.1 节），逐级调用不如一次递归创建安全。
#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    let target = Path::new(&path);

    if target.is_dir() {
        return Ok(());
    }

    fs::create_dir_all(target).map_err(|err| io_error_message(&path, &err))
}

/// 检测目录是否存在。
///
/// 路径不存在 → Ok(false)；
/// 无权限等真实错误 → Err(中文消息)，不静默当成「不存在」。
#[tauri::command]
pub fn dir_exists(path: String) -> Result<bool, String> {
    match fs::metadata(Path::new(&path)) {
        Ok(metadata) => Ok(metadata.is_dir()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(io_error_message(&path, &err)),
    }
}

// ---------------------------------------------------------------------------
// T2.1 · 复制 / 移动
// ---------------------------------------------------------------------------

/// 重名时的最大尝试次数；超过后改用时间戳兜底。
pub const MAX_CONFLICT_ATTEMPTS: u32 = 1000;

/// 一次移动请求。`to` 是**目标完整路径**（不是目标目录）—— 移除到 `_已移除` 时
/// 需要保留原文件夹结构（第 7.1 节），所以目标必须能精确表达子目录。
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePair {
    pub from: String,
    pub to: String,
}

/// 批量移动中的单个失败项
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveFailure {
    /// 源路径（用户能据此在画布上认出是哪张卡）
    pub path: String,
    /// 失败原因（中文，可直接展示）
    pub reason: String,
}

/// 批量移动结果：成功清单 + 失败清单。
///
/// 设计成「部分成功也算成功」——第 7.4 节原则：
/// 宁可「部分还原 + 明确告知」，也不要「卡死不动」。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchMoveResult {
    /// 成功写入的目标路径
    pub succeeded: Vec<String>,
    /// 失败项及原因
    pub failed: Vec<MoveFailure>,
}

/// 把文件名拆成「主干 + 扩展名」，用于生成 `名称_1.ext`。
///
/// 只按最后一个 `.` 切分（`渲染.tar.gz` → `渲染.tar` + `gz`），与资源管理器的
/// 「复制并重命名」行为一致。
fn split_file_name(file_name: &str) -> (String, Option<String>) {
    match file_name.rfind('.') {
        // 开头就是 `.`（如 `.gitignore`）视为纯主干，不产生空主干
        Some(index) if index > 0 => (
            file_name[..index].to_string(),
            Some(file_name[index + 1..].to_string()),
        ),
        _ => (file_name.to_string(), None),
    }
}

/// 在 `dir` 下为 `file_name` 找一个尚未被占用的目标路径。
///
/// 规则（第 8.1 节）：`参考图.jpg` → `参考图_1.jpg` → `参考图_2.jpg`…
/// 全部被占用时退化为带时间戳的名字，**任何情况下都不覆盖已有文件**。
pub fn unique_path_in(dir: &Path, file_name: &str) -> PathBuf {
    let direct = dir.join(file_name);
    if !direct.exists() {
        return direct;
    }

    let (stem, extension) = split_file_name(file_name);
    let compose = |suffix: &str| match &extension {
        Some(ext) => format!("{stem}{suffix}.{ext}"),
        None => format!("{stem}{suffix}"),
    };

    for index in 1..=MAX_CONFLICT_ATTEMPTS {
        let candidate = dir.join(compose(&format!("_{index}")));
        if !candidate.exists() {
            return candidate;
        }
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    dir.join(compose(&format!("_{stamp}")))
}

/// 移动单个路径。
///
/// `fs::rename` 在 Windows 上**不能跨卷**（源与目标不在同一分区会报 os error 17），
/// 因此失败时降级为「复制 + 删除源」。`_已移除` 与空间同盘，正常走 rename 这条快路。
fn move_path(from: &Path, to: &Path) -> io::Result<()> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    // 降级路径：先复制再删源 —— 只有复制成功才删，避免半途失败把文件弄丢
    fs::copy(from, to)?;
    fs::remove_file(from)?;
    Ok(())
}

/// 复制文件到目标目录。
///
/// 目标目录不存在会自动创建；同名文件存在则自动重命名为 `xxx_1`（第 8.1 节）。
/// 返回**实际写入的完整路径**。
#[tauri::command]
pub fn copy_file(src: String, dest_dir: String) -> Result<String, String> {
    let source = PathBuf::from(&src);
    if !source.is_file() {
        return Err(format!("不是文件：{src}"));
    }

    let file_name = source
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| format!("无法解析文件名：{src}"))?;

    let dir = PathBuf::from(&dest_dir);
    fs::create_dir_all(&dir).map_err(|err| io_error_message(&dest_dir, &err))?;

    let target = unique_path_in(&dir, &file_name);
    fs::copy(&source, &target).map_err(|err| {
        format!(
            "复制失败：{src} → {}（{err}）",
            target.to_string_lossy()
        )
    })?;

    Ok(target.to_string_lossy().into_owned())
}

/// 移动文件到目标完整路径。
///
/// - 目标父目录不存在则自动创建（`_已移除\参考资料\` 这类结构靠它逐级建立）
/// - 目标已存在则自动重命名（第 7.1 节「保留原文件夹结构，天然避免同名冲突」之外的兜底）
/// - 返回**实际写入的完整路径**
///
/// 既用于「移除到 `_已移除`」，也用于「从 `_已移除` 恢复」——第 7.1 / 7.2 节。
#[tauri::command]
pub fn move_file(src: String, dest: String) -> Result<String, String> {
    let source = PathBuf::from(&src);
    if !source.is_file() {
        return Err(format!("不是文件：{src}"));
    }

    let dest_path = PathBuf::from(&dest);
    let parent = dest_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| format!("目标路径不合法：{dest}"))?;

    let parent_text = parent.to_string_lossy().into_owned();
    fs::create_dir_all(parent).map_err(|err| io_error_message(&parent_text, &err))?;

    let file_name = dest_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| format!("目标路径不合法：{dest}"))?;

    let target = unique_path_in(parent, &file_name);
    move_path(&source, &target).map_err(|err| {
        format!(
            "移动失败：{src} → {}（{err}）",
            target.to_string_lossy()
        )
    })?;

    Ok(target.to_string_lossy().into_owned())
}

/// 批量移动（批量移除 / 批量恢复用，第 7.1 / 7.2 节）。
///
/// 逐项执行，**单项失败不影响其余项**：失败的记入 `failed` 并附中文原因，
/// 由上层汇总成「N 个文件未能还原」清单（第 7.4 节）。
///
/// 只有整个入参无法处理时才返回 `Err`；正常情况下总是返回 `Ok(BatchMoveResult)`。
#[tauri::command]
pub fn move_files(pairs: Vec<MovePair>) -> Result<BatchMoveResult, String> {
    let mut succeeded: Vec<String> = Vec::new();
    let mut failed: Vec<MoveFailure> = Vec::new();

    for pair in pairs {
        match move_file(pair.from.clone(), pair.to.clone()) {
            Ok(path) => succeeded.push(path),
            Err(reason) => failed.push(MoveFailure {
                path: pair.from,
                reason,
            }),
        }
    }

    Ok(BatchMoveResult { succeeded, failed })
}

// ---------------------------------------------------------------------------
// T3.6 / T3.8 · 拖入 / 粘贴的辅助命令
// （17.5 清单外新增，先例同 T2.6 的 rename_dir：中文错误 + 安全边界校验）
// ---------------------------------------------------------------------------

/// 删除单个文件（addCards 命令撤销时清理「本次复制创建的副本」用）。
///
/// - 文件不存在 → 直接成功（幂等，适配「用户已手动删掉副本」的撤销场景）
/// - 目录 → Err（本命令只删文件，绝不递归，杜绝误删整棵子树）
#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let target = Path::new(&path);

    if !target.exists() {
        return Ok(());
    }
    if !target.is_file() {
        return Err(format!("不是文件：{path}"));
    }

    fs::remove_file(target).map_err(|err| io_error_message(&path, &err))
}

/// 把前端传入的二进制数据写入目标目录（T3.8 粘贴截图的落盘端）。
///
/// - 目标目录不存在会自动创建（`未分类\` 首次粘贴时）
/// - 重名自动加 `_1` 后缀（第 8.1 节策略，复用 unique_path_in）
/// - `file_name` 只允许纯文件名：含路径分隔符直接拒绝（安全边界，防路径遍历）
/// - 返回实际写入的完整路径
#[tauri::command]
pub fn write_file_bytes(
    dest_dir: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if file_name.is_empty() {
        return Err("文件名不能为空".to_string());
    }
    if file_name.contains('\\') || file_name.contains('/') {
        return Err(format!("文件名不能包含路径分隔符：{file_name}"));
    }

    let dir = PathBuf::from(&dest_dir);
    fs::create_dir_all(&dir).map_err(|err| io_error_message(&dest_dir, &err))?;

    let target = unique_path_in(&dir, &file_name);
    fs::write(&target, &bytes).map_err(|err| {
        format!(
            "写入失败：{}（{err}）",
            target.to_string_lossy()
        )
    })?;

    Ok(target.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// T2.6 · 重命名文件夹
// ---------------------------------------------------------------------------

/// 文件夹名中的非法字符（第六章保护措施 ①）。`..` 路径遍历单独防御。
pub const INVALID_FOLDER_CHARS: [char; 10] = ['\\', '/', ':', '*', '?', '"', '<', '>', '|', '\0'];

/// 检查新文件夹名是否合法。
///
/// 上层（前端）会先做一遍同样的校验，这里是最后一道防线 ——
/// 防止路径拼接被 `..` / 分隔符之类破坏（不属业务判断，属安全边界）。
pub fn is_valid_folder_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.starts_with('.')
        && !name.chars().any(|c| INVALID_FOLDER_CHARS.contains(&c))
}

/// 重命名文件夹（分区框改名用，第六章保护措施第 ⑤ 步的执行端）。
///
/// - `old_path` 是文件夹的**完整绝对路径**；`new_name` 是**新名字**（不是完整路径）
/// - 名字不合法 / 目标已存在 → `Err`（中文，可直接展示）
/// - 文件夹被占用（资源管理器打开着、文件被锁定）→ `fs::rename` 失败 → `Err`
/// - 成功返回重命名后的完整路径
#[tauri::command]
pub fn rename_dir(old_path: String, new_name: String) -> Result<String, String> {
    if !is_valid_folder_name(&new_name) {
        return Err(format!("文件夹名不合法：{new_name}"));
    }

    let source = PathBuf::from(&old_path);
    if !source.is_dir() {
        return Err(format!("不是文件夹：{old_path}"));
    }

    let parent = source
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| format!("路径不合法：{old_path}"))?;

    let target = parent.join(&new_name);
    if target.exists() {
        return Err(format!(
            "已存在同名文件或文件夹：{}",
            target.to_string_lossy()
        ));
    }

    fs::rename(&source, &target).map_err(|err| {
        format!(
            "重命名失败：{old_path} → {}（{err}）",
            target.to_string_lossy()
        )
    })?;

    Ok(target.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Tests (T0.5 / T2.1)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// 在系统临时目录下建一个唯一命名的目录，避免测试之间互相干扰。
    fn unique_dir(tag: &str) -> PathBuf {
        let seq = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "mindscape-t05-{tag}-{}-{seq}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("无法创建测试临时目录");
        dir
    }

    /// 尽力清理；失败不影响断言结果。
    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    /// 按名字排序后取出，消除文件系统返回顺序的影响。
    fn sorted_names(mut entries: Vec<DirEntry>) -> Vec<String> {
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        entries.into_iter().map(|e| e.name).collect()
    }

    #[test]
    fn list_dir_returns_chinese_names_and_marks_dirs() {
        let root = unique_dir("chinese");
        fs::create_dir(root.join("参考资料")).unwrap();
        fs::create_dir(root.join("灵感收集")).unwrap();
        fs::write(root.join("参考图.jpg"), b"0123456789").unwrap();

        let entries = list_dir(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(
            sorted_names(entries.clone()),
            vec![
                "参考图.jpg".to_string(),
                "参考资料".to_string(),
                "灵感收集".to_string(),
            ]
        );

        let by_name = |n: &str| entries.iter().find(|e| e.name == n).unwrap().clone();

        let dir_entry = by_name("参考资料");
        assert!(dir_entry.is_dir);
        assert!(dir_entry.path.ends_with("参考资料"));
        assert_eq!(dir_entry.size, 0);

        let file_entry = by_name("参考图.jpg");
        assert!(!file_entry.is_dir);
        assert_eq!(file_entry.size, 10);
        assert!(file_entry.modified_at.is_some());

        cleanup(&root);
    }

    #[test]
    fn list_dir_skips_dot_prefixed_directories_but_keeps_files() {
        let root = unique_dir("hidden");
        fs::create_dir(root.join(".mindscape")).unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::create_dir(root.join("正常目录")).unwrap();
        fs::write(root.join(".gitignore"), b"x").unwrap();

        let names = sorted_names(list_dir(root.to_string_lossy().into_owned()).unwrap());

        assert!(!names.contains(&".mindscape".to_string()), ".mindscape 应被跳过");
        assert!(!names.contains(&".git".to_string()), ".git 应被跳过");
        assert!(names.contains(&".gitignore".to_string()), "隐藏文件应保留");
        assert!(names.contains(&"正常目录".to_string()));

        cleanup(&root);
    }

    #[test]
    fn list_dir_on_empty_dir_returns_empty_vec() {
        let root = unique_dir("empty");
        let entries = list_dir(root.to_string_lossy().into_owned()).unwrap();
        assert!(entries.is_empty());
        cleanup(&root);
    }

    #[test]
    fn list_dir_on_missing_path_returns_chinese_error() {
        let missing = std::env::temp_dir().join("mindscape-t05-definitely-missing-xyz");
        let err = list_dir(missing.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("路径不存在"), "错误信息应为中文，实际：{err}");
    }

    #[test]
    fn list_dir_on_file_returns_chinese_error() {
        let root = unique_dir("notdir");
        let file = root.join("这是个文件.txt");
        fs::write(&file, b"x").unwrap();

        let err = list_dir(file.to_string_lossy().into_owned()).unwrap_err();
        assert!(
            err.contains("不是文件夹") || err.contains("操作失败"),
            "错误信息应为中文，实际：{err}"
        );

        cleanup(&root);
    }

    #[test]
    fn create_dir_is_recursive_and_idempotent() {
        let root = unique_dir("createdir");
        let nested = root.join("_已移除").join("参考资料");

        create_dir(nested.to_string_lossy().into_owned()).unwrap();
        assert!(nested.is_dir());

        // 再次调用应直接成功，不报「已存在」
        create_dir(nested.to_string_lossy().into_owned()).unwrap();
        assert!(nested.is_dir());

        cleanup(&root);
    }

    #[test]
    fn dir_exists_distinguishes_dir_file_and_missing() {
        let root = unique_dir("exists");
        let sub = root.join("子目录");
        fs::create_dir(&sub).unwrap();
        let file = root.join("文件.txt");
        fs::write(&file, b"x").unwrap();

        assert!(dir_exists(sub.to_string_lossy().into_owned()).unwrap());
        assert!(!dir_exists(file.to_string_lossy().into_owned()).unwrap());
        assert!(!dir_exists(root.join("不存在").to_string_lossy().into_owned()).unwrap());

        cleanup(&root);
    }

    /// 「无权限目录」在 Windows 上需要改 ACL 才能稳定构造，CI/沙箱里不可复现，
    /// 因此这里直接对错误映射函数做单元测试，覆盖权限分支的行为。
    #[test]
    fn permission_denied_maps_to_chinese_message() {
        let err = io::Error::new(io::ErrorKind::PermissionDenied, "os error 5");
        let msg = io_error_message("C:\\受保护目录", &err);
        assert!(msg.contains("无权限访问"), "实际：{msg}");
        assert!(msg.contains("C:\\受保护目录"));
    }

    #[test]
    fn not_found_maps_to_chinese_message() {
        let err = io::Error::new(io::ErrorKind::NotFound, "os error 2");
        assert!(io_error_message("D:\\不存在", &err).contains("路径不存在"));
    }

    // ---- T2.1 acceptance: 同名冲突自动加 _1 / 批量移动返回成功与失败清单 ----

    #[test]
    fn split_file_name_keeps_last_extension_and_handles_dotfiles() {
        assert_eq!(
            split_file_name("参考图.jpg"),
            ("参考图".to_string(), Some("jpg".to_string()))
        );
        // 多点文件名：只切最后一个点
        assert_eq!(
            split_file_name("渲染.tar.gz"),
            ("渲染.tar".to_string(), Some("gz".to_string()))
        );
        // 无扩展名
        assert_eq!(split_file_name("README"), ("README".to_string(), None));
        // 以点开头且无其他点 → 整体视为主干，避免产生空名字
        assert_eq!(split_file_name(".gitignore"), (".gitignore".to_string(), None));
    }

    #[test]
    fn copy_file_appends_suffix_when_target_exists() {
        let root = unique_dir("copy-conflict");
        let src_dir = root.join("源");
        let dest_dir = root.join("目标");
        fs::create_dir_all(&src_dir).unwrap();
        fs::create_dir_all(&dest_dir).unwrap();

        let source = src_dir.join("参考图.jpg");
        fs::write(&source, b"new-content").unwrap();
        // 预先占用同名文件，内容不同，用于验证「不覆盖」
        fs::write(dest_dir.join("参考图.jpg"), b"old-content").unwrap();

        let written = copy_file(
            source.to_string_lossy().into_owned(),
            dest_dir.to_string_lossy().into_owned(),
        )
        .unwrap();

        let written_path = PathBuf::from(&written);
        assert_eq!(written_path.file_name().unwrap(), "参考图_1.jpg");
        assert_eq!(fs::read(&written_path).unwrap(), b"new-content");
        assert_eq!(
            fs::read(dest_dir.join("参考图.jpg")).unwrap(),
            b"old-content",
            "已有文件不能被覆盖"
        );

        // 再复制一次 → 参考图_2.jpg
        let second = copy_file(
            source.to_string_lossy().into_owned(),
            dest_dir.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(PathBuf::from(second).file_name().unwrap(), "参考图_2.jpg");

        cleanup(&root);
    }

    #[test]
    fn copy_file_creates_dest_dir_and_reports_chinese_error_for_missing_src() {
        let root = unique_dir("copy-mkdir");
        let source = root.join("a.txt");
        fs::write(&source, b"x").unwrap();

        // 目标目录尚不存在
        let dest_dir = root.join("未分类").join("深层");
        copy_file(
            source.to_string_lossy().into_owned(),
            dest_dir.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert!(dest_dir.join("a.txt").is_file());

        let err = copy_file(
            root.join("不存在.txt").to_string_lossy().into_owned(),
            dest_dir.to_string_lossy().into_owned(),
        )
        .unwrap_err();
        assert!(err.contains("不是文件"), "实际：{err}");

        cleanup(&root);
    }

    #[test]
    fn move_file_creates_parent_chain_and_returns_actual_path() {
        let root = unique_dir("move-nested");
        let source = root.join("参考资料").join("ref-01.jpg");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, b"image").unwrap();

        // 模拟第 7.1 节：参考资料\ref-01.jpg → _已移除\参考资料\ref-01.jpg
        let dest = root.join("_已移除").join("参考资料").join("ref-01.jpg");
        let written = move_file(
            source.to_string_lossy().into_owned(),
            dest.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert_eq!(PathBuf::from(&written), dest);
        assert!(dest.is_file());
        assert!(!source.exists(), "移动后源文件应消失");

        cleanup(&root);
    }

    #[test]
    fn move_file_appends_suffix_instead_of_overwriting() {
        let root = unique_dir("move-conflict");
        let src_dir = root.join("src");
        let dest_dir = root.join("dest");
        fs::create_dir_all(&src_dir).unwrap();
        fs::create_dir_all(&dest_dir).unwrap();

        let source = src_dir.join("同名.png");
        fs::write(&source, b"new").unwrap();
        fs::write(dest_dir.join("同名.png"), b"existing").unwrap();

        let written = move_file(
            source.to_string_lossy().into_owned(),
            dest_dir.join("同名.png").to_string_lossy().into_owned(),
        )
        .unwrap();

        assert_eq!(PathBuf::from(&written).file_name().unwrap(), "同名_1.png");
        assert_eq!(
            fs::read(dest_dir.join("同名.png")).unwrap(),
            b"existing",
            "已有文件不能被覆盖"
        );

        cleanup(&root);
    }

    #[test]
    fn move_files_returns_succeeded_and_failed_lists() {
        let root = unique_dir("move-batch");
        let from_dir = root.join("_已移除").join("参考资料");
        let to_dir = root.join("参考资料");
        fs::create_dir_all(&from_dir).unwrap();

        let ok_a = from_dir.join("a.png");
        let ok_b = from_dir.join("b.png");
        fs::write(&ok_a, b"a").unwrap();
        fs::write(&ok_b, b"b").unwrap();

        let result = move_files(vec![
            MovePair {
                from: ok_a.to_string_lossy().into_owned(),
                to: to_dir.join("a.png").to_string_lossy().into_owned(),
            },
            MovePair {
                from: ok_b.to_string_lossy().into_owned(),
                to: to_dir.join("b.png").to_string_lossy().into_owned(),
            },
            // 故意不存在的源，用于验证「单项失败不影响其余项」
            MovePair {
                from: from_dir.join("缺失.png").to_string_lossy().into_owned(),
                to: to_dir.join("缺失.png").to_string_lossy().into_owned(),
            },
        ])
        .unwrap();

        assert_eq!(result.succeeded.len(), 2);
        assert_eq!(result.failed.len(), 1);
        assert!(result.failed[0].path.ends_with("缺失.png"));
        assert!(
            result.failed[0].reason.contains("不是文件"),
            "失败原因应为中文，实际：{}",
            result.failed[0].reason
        );
        assert!(to_dir.join("a.png").is_file());
        assert!(to_dir.join("b.png").is_file());

        cleanup(&root);
    }

    #[test]
    fn move_files_on_empty_input_returns_empty_result() {
        let result = move_files(vec![]).unwrap();
        assert!(result.succeeded.is_empty());
        assert!(result.failed.is_empty());
    }

    // ---- T3.6 / T3.8 acceptance: delete_file / write_file_bytes ----

    #[test]
    fn delete_file_is_idempotent_and_rejects_directory() {
        let root = unique_dir("delete-file");
        let file = root.join("副本.png");
        fs::write(&file, b"x").unwrap();

        delete_file(file.to_string_lossy().into_owned()).unwrap();
        assert!(!file.exists());

        // 幂等：再删一次不报错
        delete_file(file.to_string_lossy().into_owned()).unwrap();

        // 目录绝不能删（只删文件，防误删子树）
        let dir = root.join("子目录");
        fs::create_dir_all(&dir).unwrap();
        let err = delete_file(dir.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("不是文件"), "实际：{err}");
        assert!(dir.is_dir(), "目录必须原样保留");

        cleanup(&root);
    }

    #[test]
    fn write_file_bytes_creates_dir_suffixes_conflict_and_rejects_separators() {
        let root = unique_dir("write-bytes");
        let dest = root.join("未分类");

        let first = write_file_bytes(
            dest.to_string_lossy().into_owned(),
            "粘贴-20260911-1400.png".to_string(),
            vec![1, 2, 3],
        )
        .unwrap();
        assert!(PathBuf::from(&first).is_file());
        assert_eq!(fs::read(&first).unwrap(), vec![1, 2, 3]);

        // 重名自动加 _1
        let second = write_file_bytes(
            dest.to_string_lossy().into_owned(),
            "粘贴-20260911-1400.png".to_string(),
            vec![4],
        )
        .unwrap();
        assert!(second.ends_with("粘贴-20260911-1400_1.png"));

        // 路径遍历防御
        let err = write_file_bytes(
            dest.to_string_lossy().into_owned(),
            "a/b.png".to_string(),
            vec![],
        )
        .unwrap_err();
        assert!(err.contains("路径分隔符"), "实际：{err}");

        cleanup(&root);
    }

    // ---- T2.6 acceptance: rename_dir ----

    #[test]
    fn is_valid_folder_name_rejects_illegal_and_reserved_names() {
        assert!(is_valid_folder_name("参考资料"));
        assert!(is_valid_folder_name("我的 方案-2"));

        // 非法字符（第六章保护措施 ①）
        for bad in ["a\\b", "a/b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b"] {
            assert!(!is_valid_folder_name(bad), "应拒绝：{bad}");
        }
        // 空名 / 保留名 / 隐藏名 / 路径遍历
        assert!(!is_valid_folder_name(""));
        assert!(!is_valid_folder_name("."));
        assert!(!is_valid_folder_name(".."));
        assert!(!is_valid_folder_name(".mindscape"));
    }

    #[test]
    fn rename_dir_renames_and_returns_new_path() {
        let root = unique_dir("rename-ok");
        let dir = root.join("旧名字");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("图.jpg"), b"x").unwrap();

        let renamed = rename_dir(
            dir.to_string_lossy().into_owned(),
            "新名字".to_string(),
        )
        .unwrap();

        let new_path = root.join("新名字");
        assert_eq!(PathBuf::from(&renamed), new_path);
        assert!(new_path.is_dir());
        assert!(new_path.join("图.jpg").is_file(), "内容应原样保留");
        assert!(!dir.exists(), "旧目录应消失");

        cleanup(&root);
    }

    #[test]
    fn rename_dir_rejects_conflict_illegal_and_missing() {
        let root = unique_dir("rename-conflict");
        let dir = root.join("甲");
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(root.join("乙")).unwrap();

        // ② 同名冲突
        let err = rename_dir(dir.to_string_lossy().into_owned(), "乙".to_string()).unwrap_err();
        assert!(err.contains("已存在同名"), "实际：{err}");

        // ① 非法字符
        let err = rename_dir(dir.to_string_lossy().into_owned(), "a|b".to_string()).unwrap_err();
        assert!(err.contains("不合法"), "实际：{err}");

        // 源不存在
        let err = rename_dir(
            root.join("不存在").to_string_lossy().into_owned(),
            "丙".to_string(),
        )
        .unwrap_err();
        assert!(err.contains("不是文件夹"), "实际：{err}");

        cleanup(&root);
    }
}
