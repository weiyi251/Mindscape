// ============================================================================
// 模块说明（中文）
// 布局文件读写命令。对应开发计划书 17.5（命令签名）与 17.6（数据持久化策略）。
//
//   read_layout(space_path)  -> Result<String, String>   返回 layout.json 的 JSON 字符串
//   write_layout(space_path, json) -> Result<(), String> 原子写入
//
// 关键行为：
//   · 文件不存在 → 返回默认空结构，不报错（17.5）
//   · 原子写入 → 先写 layout.json.tmp 并 fsync，再 rename 覆盖，避免写入中断损坏文件（17.6）
//   · 解析失败 → 不覆盖原文件，把原文件备份为 layout.json.bak，并返回 Err（17.6）
//   · version > 1 → 原样返回文件内容，由前端按只读模式打开（17.6）
//
// 【告警通道约定 · 已与用户确认】
//   17.5 把 read_layout 的签名固定为 `Result<String, String>`（不含 AppHandle），无法发事件；
//   17.5 同时规定「错误信息用中文，可直接展示给用户」。因此损坏时的提示走 Err 通道：
//     - Err 且消息以 LAYOUT_CORRUPT_MARKER 开头 → 文件已损坏、已备份为 .bak，前端应展示该消息
//       并改用空布局继续（切勿立刻回写磁盘）
//     - version > 1 不作为错误，仍返回 Ok(原文)，只读状态由前端读 version 字段自行判定
//   前端侧对应实现在 core/storage/LocalFolderProvider.ts（T0.7），两处的标记必须保持一致。
//
// 铁律（17.5）：只做「安全执行 + 明确报错」，不做业务判断。
// ============================================================================

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// 布局数据目录名（第 3 章：`.mindscape\`，不显示在画布上）
pub const LAYOUT_DIR: &str = ".mindscape";
/// 布局文件名
pub const LAYOUT_FILE: &str = "layout.json";
/// 损坏时的备份后缀
pub const LAYOUT_BAK_SUFFIX: &str = ".bak";
/// 当前支持的最高数据版本（对应 4.2 的 version）
pub const SUPPORTED_LAYOUT_VERSION: i64 = 1;

/// 布局文件损坏时的 Err 消息前缀。前端据此判定「已恢复为空布局」，两侧必须一致。
pub const LAYOUT_CORRUPT_MARKER: &str = "布局文件损坏";

/// 默认空布局（与前端 core/types.ts 的 createEmptyLayout() 结构一致）。
///
/// 此处刻意返回完整结构而非最小 `{"version":1}`：read_layout 的调用方未必经过
/// zod 补默认值，返回完整结构才能让命令自身是自洽的。
///
/// version 取自 [`SUPPORTED_LAYOUT_VERSION`] 而非字面量，避免升级数据版本时两处漏改。
pub fn empty_layout_json() -> String {
    format!(
        concat!(
            r#"{{"version":{},"#,
            r#""canvas":{{"zoom":1.0,"offsetX":0.0,"offsetY":0.0}},"#,
            r#""cards":[],"partitions":[],"connections":[],"removed":[],"extensions":{{}}}}"#
        ),
        SUPPORTED_LAYOUT_VERSION
    )
}

fn layout_dir(space_path: &str) -> PathBuf {
    Path::new(space_path).join(LAYOUT_DIR)
}

fn layout_file(space_path: &str) -> PathBuf {
    layout_dir(space_path).join(LAYOUT_FILE)
}

fn layout_bak_file(space_path: &str) -> PathBuf {
    layout_dir(space_path).join(format!("{LAYOUT_FILE}{LAYOUT_BAK_SUFFIX}"))
}

fn err_msg(path: &Path, err: &io::Error) -> String {
    let shown = path.to_string_lossy();
    match err.kind() {
        io::ErrorKind::NotFound => format!("路径不存在：{shown}"),
        io::ErrorKind::PermissionDenied => format!("无权限访问：{shown}"),
        _ => format!("操作失败：{shown}（{err}）"),
    }
}

/// 读取布局文件。
///
/// 返回 JSON 字符串（不是解析后的结构）。文件不存在 → 默认空结构，不报错。
/// 文件存在但 JSON 损坏 → 备份为 .bak 后返回 Err（消息见 LAYOUT_CORRUPT_MARKER）。
#[tauri::command]
pub fn read_layout(space_path: String) -> Result<String, String> {
    let file = layout_file(&space_path);

    let raw = match fs::read_to_string(&file) {
        Ok(raw) => raw,
        Err(err) if err.kind() == io::ErrorKind::NotFound => {
            // 17.5：不存在则返回默认空结构，不报错
            return Ok(empty_layout_json());
        }
        Err(err) => return Err(err_msg(&file, &err)),
    };

    // 只校验是否为合法 JSON；字段级校验由前端 zod 负责（T0.4）
    if serde_json::from_str::<serde_json::Value>(&raw).is_err() {
        // 17.6：不覆盖原文件，备份为 .bak，然后由前端加载空布局
        let message = match backup_broken_layout(&layout_bak_file(&space_path), &raw) {
            Ok(()) => format!(
                "{LAYOUT_CORRUPT_MARKER}，已备份为 {LAYOUT_FILE}{LAYOUT_BAK_SUFFIX} 并重建。\
                 该空间的卡片摆放与连线需要重新整理。"
            ),
            Err(backup_err) => format!(
                "{LAYOUT_CORRUPT_MARKER}，且备份失败（{backup_err}）。原文件未被改写，请先手动备份。"
            ),
        };
        return Err(message);
    }

    // version > 1：原样返回，由前端按只读模式打开（17.6）
    Ok(raw)
}

/// 把损坏的原文件另存为 .bak（已存在则覆盖）。
///
/// 刻意不改写、不删除原文件 —— 符合 17.6「不覆盖原文件」。
fn backup_broken_layout(bak: &Path, raw: &str) -> io::Result<()> {
    if let Some(parent) = bak.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(bak, raw.as_bytes())
}

/// 原子写入布局文件。
///
/// 步骤：确保 `.mindscape\` 存在 → 写 `layout.json.tmp` 并 fsync → rename 覆盖原文件。
/// Windows 下 `fs::rename` 使用 MoveFileEx(MOVEFILE_REPLACE_EXISTING)，可直接覆盖。
#[tauri::command]
pub fn write_layout(space_path: String, json: String) -> Result<(), String> {
    let dir = layout_dir(&space_path);
    if !dir.is_dir() {
        fs::create_dir_all(&dir).map_err(|err| err_msg(&dir, &err))?;
    }

    let dest = layout_file(&space_path);
    let tmp = dir.join(format!("{LAYOUT_FILE}.tmp"));

    // 写入临时文件并落盘，确保 rename 之前数据已经写出
    {
        let mut handle = fs::File::create(&tmp).map_err(|err| err_msg(&tmp, &err))?;
        handle
            .write_all(json.as_bytes())
            .map_err(|err| err_msg(&tmp, &err))?;
        handle.flush().map_err(|err| err_msg(&tmp, &err))?;
        handle.sync_all().map_err(|err| err_msg(&tmp, &err))?;
    }

    // 原子替换：失败时清理临时文件，避免残留
    if let Err(err) = fs::rename(&tmp, &dest) {
        let _ = fs::remove_file(&tmp);
        return Err(err_msg(&dest, &err));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests (T0.6 acceptance: 手动截断 json 后读取，程序不崩、原文件被备份)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn unique_space(tag: &str) -> PathBuf {
        let seq = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "mindscape-t06-{tag}-{}-{seq}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("无法创建测试临时目录");
        dir
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    fn space_str(dir: &Path) -> String {
        dir.to_string_lossy().into_owned()
    }

    #[test]
    fn read_layout_returns_empty_structure_when_file_missing() {
        let space = unique_space("missing");

        let json = read_layout(space_str(&space)).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(value["version"], 1);
        assert_eq!(value["cards"].as_array().unwrap().len(), 0);
        assert_eq!(value["partitions"].as_array().unwrap().len(), 0);
        assert_eq!(value["connections"].as_array().unwrap().len(), 0);
        assert_eq!(value["removed"].as_array().unwrap().len(), 0);
        assert_eq!(value["canvas"]["zoom"], 1.0);
        assert!(value["extensions"].is_object());

        cleanup(&space);
    }

    #[test]
    fn write_then_read_round_trips_and_leaves_no_tmp() {
        let space = unique_space("roundtrip");
        let payload = r#"{"version":1,"cards":[{"id":"c_1"}]}"#.to_string();

        write_layout(space_str(&space), payload.clone()).unwrap();
        assert_eq!(read_layout(space_str(&space)).unwrap(), payload);

        // .mindscape 目录已自动创建，且不残留 .tmp
        assert!(layout_dir(&space_str(&space)).is_dir());
        assert!(!layout_dir(&space_str(&space))
            .join(format!("{LAYOUT_FILE}.tmp"))
            .exists());

        cleanup(&space);
    }

    #[test]
    fn write_layout_overwrites_existing_file_atomically() {
        let space = unique_space("overwrite");

        write_layout(space_str(&space), r#"{"version":1,"cards":[]}"#.to_string()).unwrap();
        write_layout(
            space_str(&space),
            r#"{"version":1,"cards":[{"id":"c_2"}]}"#.to_string(),
        )
        .unwrap();

        let raw = read_layout(space_str(&space)).unwrap();
        assert!(raw.contains("c_2"));

        cleanup(&space);
    }

    /// T0.6 的核心验收：手动截断 json 后读取，程序不崩、原文件被备份。
    #[test]
    fn truncated_layout_is_backed_up_and_reported_via_err() {
        let space = unique_space("broken");
        let dir = layout_dir(&space_str(&space));
        fs::create_dir_all(&dir).unwrap();

        // 手动写入被截断的 JSON（模拟写入中断 / 磁盘损坏）
        let broken = r#"{"version":1,"cards":[{"id":"c_1""#;
        let file = dir.join(LAYOUT_FILE);
        fs::write(&file, broken).unwrap();

        // 读取：不 panic，返回带标记的中文错误（前端据此改用空布局）
        let err = read_layout(space_str(&space)).unwrap_err();
        assert!(
            err.starts_with(LAYOUT_CORRUPT_MARKER),
            "错误信息应以损坏标记开头，实际：{err}"
        );
        assert!(err.contains(LAYOUT_BAK_SUFFIX), "错误信息应说明备份去向：{err}");

        // 原文件保持原样（17.6：不覆盖原文件）
        assert_eq!(fs::read_to_string(&file).unwrap(), broken);

        // 原文件已备份为 layout.json.bak，内容与损坏文件一致
        let bak = dir.join(format!("{LAYOUT_FILE}{LAYOUT_BAK_SUFFIX}"));
        assert!(bak.is_file(), "应生成 layout.json.bak");
        assert_eq!(fs::read_to_string(&bak).unwrap(), broken);

        // 损坏时仍然能拿到一份可用的空布局（由前端在收到该错误后使用）
        let empty: serde_json::Value = serde_json::from_str(&empty_layout_json()).unwrap();
        assert_eq!(empty["version"].as_i64().unwrap(), SUPPORTED_LAYOUT_VERSION);

        cleanup(&space);
    }

    #[test]
    fn future_version_is_returned_untouched() {
        let space = unique_space("future");
        let dir = layout_dir(&space_str(&space));
        fs::create_dir_all(&dir).unwrap();

        let future = r#"{"version":9,"cards":[],"unknownField":123}"#;
        fs::write(dir.join(LAYOUT_FILE), future).unwrap();

        // 原样返回（由前端按只读模式打开），不改写、不备份
        assert_eq!(read_layout(space_str(&space)).unwrap(), future);
        assert!(!dir
            .join(format!("{LAYOUT_FILE}{LAYOUT_BAK_SUFFIX}"))
            .exists());

        cleanup(&space);
    }

    #[test]
    fn read_layout_on_missing_space_dir_is_not_an_error() {
        let ghost = std::env::temp_dir().join("mindscape-t06-not-a-real-space-xyz");
        let json = read_layout(ghost.to_string_lossy().into_owned()).unwrap();
        assert!(json.contains("\"version\":1"));
    }
}
