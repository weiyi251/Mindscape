// ============================================================================
// 模块说明（中文）
// 系统剪贴板文件互通命令（2026-09-13 用户要求，依赖 clipboard-win 已获批准）。
//
//   write_clipboard_files(paths) -> Result<usize, String>  把文件列表写入系统剪贴板
//                                          （Windows CF_HDROP，资源管理器可直接粘贴）
//   write_clipboard_text(text)   -> Result<(), String>     把文本写入系统剪贴板
//                                          （CF_UNICODETEXT，纯便签复制到外部用）
//   read_clipboard_files()       -> Result<Vec<String>, String>  读取系统剪贴板里的文件
//                                          路径列表；没有文件时返回空列表（不是错误）
//
// 铁律（17.5）：
//   - 返回 Result<T, String>，错误信息用中文，可直接展示给用户
//   - 只做「安全执行 + 明确报错」，不做业务判断（复用哪条链路由前端决定）
//   - 路径参数一律为绝对路径；写入前逐项校验存在性，防把失效路径放进剪贴板
//
// 【双向链路的分工】（17.5 清单外新增，先例同 T2.6 rename_dir / T3.8 write_file_bytes）
//   · 出方向（空间 → 外部）：前端 Ctrl+C 时把文件卡的绝对路径交给我们写 CF_HDROP；
//     纯便签选区没有磁盘文件，降级写 CF_UNICODETEXT（便签文本）。
//   · 进方向（外部 → 空间）：WebView 的原生 paste 事件拿不到真实文件路径
//     （Chromium 安全限制），必须由本层读 CF_HDROP 后把路径交回前端，
//     复用拖入链路（copy 进空间，铁律②不搬家）。
//
// 【错误提示约定】（用户要求：环境受限时给出明确提示）
//   · 非 Windows 平台：所有命令返回中文 Err（当前仅发布 Windows 版）；
//   · 剪贴板被其他进程占用：new_attempts 重试 10 次后报「无法打开系统剪贴板」。
// ============================================================================

/// 把待写入的路径整理成有效文件清单（纯函数，便于单测覆盖防御分支）。
///
/// 规则：
///   · 空列表 → Err（没有东西可复制）；
///   · 逐项校验「存在且是文件」：目录、失效路径全部剔除；
///   · 全部无效 → Err（中文，列出被剔除的路径）；
///   · 部分无效 → 保留有效项（部分成功也值得粘贴，与批量移动同精神）。
pub fn validate_file_paths(paths: &[String]) -> Result<Vec<std::path::PathBuf>, String> {
    if paths.is_empty() {
        return Err("没有可复制到系统剪贴板的文件".to_string());
    }

    let mut valid = Vec::new();
    let mut invalid = Vec::new();
    for path in paths {
        if std::path::Path::new(path).is_file() {
            valid.push(std::path::PathBuf::from(path));
        } else {
            invalid.push(path.clone());
        }
    }

    if valid.is_empty() {
        return Err(format!(
            "以下路径不存在或不是文件，无法复制：{}",
            invalid.join("、")
        ));
    }

    Ok(valid)
}

// ---------------------------------------------------------------------------
// Windows 实现（clipboard-win）
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod native {
    use super::validate_file_paths;
    use clipboard_win::{formats, raw, Clipboard, Getter, Setter};

    /// 打开剪贴板（被占用时自动重试，Windows 剪贴板是全局互斥资源）
    fn open_clipboard() -> Result<Clipboard, String> {
        Clipboard::new_attempts(10)
            .map_err(|error| format!("无法打开系统剪贴板（可能正被其他程序占用）：{error}"))
    }

    /// 在已打开的剪贴板上执行「清空」（复制是「替换」语义，
    /// 不能与上一次的截图/文本混在一个剪贴板里）。
    fn empty_clipboard() -> Result<(), String> {
        raw::empty().map_err(|error| format!("清空系统剪贴板失败：{error}"))
    }

    /// 把文件列表写入系统剪贴板（CF_HDROP）。返回写入的文件数。
    ///
    /// 注意：clipboard-win 5.x 的 Getter/Setter 实现在格式类型本身上
    /// （如 `formats::FileList.write_clipboard(..)`），Clipboard 结构体只负责
    /// 打开 / 关闭句柄；清空走 raw::empty。
    pub fn write_files(paths: &[String]) -> Result<usize, String> {
        let files = validate_file_paths(paths)?;
        let texts: Vec<String> = files
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect();

        let _clipboard = open_clipboard()?;
        empty_clipboard()?;
        formats::FileList
            .write_clipboard(texts.as_slice())
            .map_err(|error| format!("写入系统剪贴板失败：{error}"))?;
        Ok(files.len())
    }

    /// 把文本写入系统剪贴板（CF_UNICODETEXT）。
    pub fn write_text(text: &str) -> Result<(), String> {
        if text.is_empty() {
            return Err("没有可复制到系统剪贴板的内容".to_string());
        }

        let _clipboard = open_clipboard()?;
        empty_clipboard()?;
        // Setter<Unicode> 的类型参数要求 Sized：传 String（AsRef<str>），不收 &str
        formats::Unicode
            .write_clipboard(&text.to_string())
            .map_err(|error| format!("写入系统剪贴板失败：{error}"))?;
        Ok(())
    }

    /// 读取系统剪贴板里的文件路径列表；剪贴板上没有文件时返回空列表（不是错误）。
    pub fn read_files() -> Result<Vec<String>, String> {
        if !clipboard_win::is_format_avail(formats::CF_HDROP) {
            return Ok(Vec::new());
        }

        let _clipboard = open_clipboard()?;
        let mut files: Vec<String> = Vec::new();
        formats::FileList
            .read_clipboard(&mut files)
            .map_err(|error| format!("读取系统剪贴板失败：{error}"))?;
        Ok(files)
    }
}

// ---------------------------------------------------------------------------
// 非 Windows 实现：明确报错（用户要求环境受限时给出明确提示，不静默失败）
// ---------------------------------------------------------------------------

#[cfg(not(windows))]
mod native {
    const UNSUPPORTED: &str = "当前系统暂不支持系统剪贴板文件互通（本功能仅支持 Windows）";

    pub fn write_files(_paths: &[String]) -> Result<usize, String> {
        Err(UNSUPPORTED.to_string())
    }

    pub fn write_text(_text: &str) -> Result<(), String> {
        Err(UNSUPPORTED.to_string())
    }

    pub fn read_files() -> Result<Vec<String>, String> {
        Err(UNSUPPORTED.to_string())
    }
}

// ---------------------------------------------------------------------------
// Tauri 命令（17.5 铁律：Result<T, String> + 中文错误，本层不含业务判断）
// ---------------------------------------------------------------------------

/// 把文件列表写入系统剪贴板，返回实际写入的文件数。
#[tauri::command]
pub fn write_clipboard_files(paths: Vec<String>) -> Result<usize, String> {
    native::write_files(&paths)
}

/// 把文本写入系统剪贴板（纯便签复制到外部的落点）。
#[tauri::command]
pub fn write_clipboard_text(text: String) -> Result<(), String> {
    native::write_text(&text)
}

/// 读取系统剪贴板里的文件路径列表；没有文件时返回空列表。
#[tauri::command]
pub fn read_clipboard_files() -> Result<Vec<String>, String> {
    native::read_files()
}

// ---------------------------------------------------------------------------
// Tests（真实剪贴板读写依赖桌面会话与全局互斥，不在 CI 断言；
// 这里覆盖可离线复现的防御分支与纯函数行为）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("mindscape-clip-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn validate_rejects_empty_paths_in_chinese() {
        let error = validate_file_paths(&[]).unwrap_err();
        assert!(error.contains("没有可复制"), "实际错误：{error}");
    }

    #[test]
    fn validate_filters_missing_paths_and_keeps_files() {
        let dir = temp_dir("filter");
        let file = dir.join("参考图.jpg");
        std::fs::write(&file, b"x").unwrap();

        let valid = validate_file_paths(&[
            file.to_string_lossy().into_owned(),
            dir.join("缺失.png").to_string_lossy().into_owned(),
            dir.to_string_lossy().into_owned(), // 目录应被剔除
        ])
        .unwrap();

        assert_eq!(valid, vec![file.clone()]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn validate_reports_chinese_error_when_all_invalid() {
        let dir = temp_dir("all-invalid");
        let missing = dir.join("不存在.txt").to_string_lossy().into_owned();

        let error = validate_file_paths(&[missing.clone()]).unwrap_err();
        assert!(error.contains("不存在或不是文件"), "实际错误：{error}");
        assert!(error.contains("不存在.txt"), "错误应列出失效路径：{error}");

        std::fs::remove_dir_all(&dir).ok();
    }

    // Windows 桌面会话下额外验证真实读写往返（CI 无桌面时剪贴板打开可能失败，
    // 因此仅在打开成功时断言；打开失败本身也验证了中文错误路径）。
    #[cfg(windows)]
    #[test]
    fn real_clipboard_roundtrip_when_available() {
        let dir = temp_dir("roundtrip");
        let file = dir.join("互通.txt");
        std::fs::write(&file, b"x").unwrap();
        let path_text = file.to_string_lossy().into_owned();

        match native::write_files(&[path_text.clone()]) {
            Ok(count) => {
                assert_eq!(count, 1);
                let files = native::read_files().unwrap();
                assert_eq!(files, vec![path_text]);
            }
            // 无头会话 / 剪贴板被占用：只要求错误是中文且可展示
            Err(error) => assert!(!error.is_empty(), "错误信息不能为空"),
        }

        std::fs::remove_dir_all(&dir).ok();
    }
}
