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

    /// 一次打开剪贴板，同时写入 CF_HDROP（文件列表）与 CF_UNICODETEXT（文本）。
    ///
    /// 为什么需要它（2026-09-18 回归修复）：原先「复制卡片」改为只写文本后，
    /// 资源管理器里粘贴只能得到文件名 —— write_text 会先 empty_clipboard，
    /// 两次调用各自清空，两格式无法共存。
    ///
    /// ⚠️ 实现要点（真机测试 `real_clipboard_dual_format_roundtrip` 实测教训）：
    /// clipboard-win 的**高级 setter（formats::FileList / Unicode 的 write_clipboard）
    /// 内部自带 open + empty** —— 第二次调用会把先写入的格式清掉，双格式名存实亡。
    /// 因此这里全程**一个打开会话 + raw::set_without_clear**：
    ///   · CF_HDROP：手工构造 DROPFILES 头（pFiles=20、fWide=1）+ UTF-16LE
    ///     路径列表（每路径 \0 结尾、整体再 \0）；
    ///   · CF_UNICODETEXT：UTF-16LE + 双 \0 终止（文本为空时跳过，文件已就位不算错）。
    pub fn write_files_and_text(paths: &[String], text: &str) -> Result<usize, String> {
        let files = validate_file_paths(paths)?;

        let _clipboard = open_clipboard()?;
        empty_clipboard()?;

        // 1) CF_HDROP：DROPFILES 头（20 字节）+ 宽字符路径列表 + 终止 NUL
        let mut hdrop: Vec<u8> = Vec::with_capacity(64);
        hdrop.extend_from_slice(&20u32.to_le_bytes()); // pFiles = sizeof(DROPFILES)
        hdrop.extend_from_slice(&0i32.to_le_bytes()); // pt.x
        hdrop.extend_from_slice(&0i32.to_le_bytes()); // pt.y
        hdrop.extend_from_slice(&0u32.to_le_bytes()); // fNC = FALSE
        hdrop.extend_from_slice(&1u32.to_le_bytes()); // fWide = TRUE（宽字符）
        for path in &files {
            for unit in path.to_string_lossy().encode_utf16() {
                hdrop.extend_from_slice(&unit.to_le_bytes());
            }
            hdrop.extend_from_slice(&[0, 0]); // 路径以 NUL 结尾
        }
        hdrop.extend_from_slice(&[0, 0]); // 列表以空路径（双 NUL）终止
        raw::set_without_clear(formats::CF_HDROP, &hdrop)
            .map_err(|error| format!("写入系统剪贴板失败：{error}"))?;

        // 2) CF_UNICODETEXT：非空才追加（UTF-16LE + 双 NUL 终止）
        if !text.is_empty() {
            let mut wide: Vec<u8> = Vec::with_capacity(text.len() * 2 + 2);
            for unit in text.encode_utf16() {
                wide.extend_from_slice(&unit.to_le_bytes());
            }
            wide.extend_from_slice(&[0, 0]);
            raw::set_without_clear(formats::CF_UNICODETEXT, &wide)
                .map_err(|error| format!("写入系统剪贴板失败：{error}"))?;
        }

        Ok(files.len())
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

    pub fn write_files_and_text(_paths: &[String], _text: &str) -> Result<usize, String> {
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

/// 同时写入文件列表（CF_HDROP）与文本（CF_UNICODETEXT）：一次打开剪贴板写两格式，
/// 资源管理器粘贴出文件、记事本粘贴出文字（2026-09-18 回归修复）。
#[tauri::command]
pub fn write_clipboard_files_and_text(paths: Vec<String>, text: String) -> Result<usize, String> {
    native::write_files_and_text(&paths, &text)
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
    //
    // ⚠️ 两个真实剪贴板测试必须**串行**：cargo test 默认并行，而系统剪贴板是
    // 全局互斥资源 —— 一个测试 empty_clipboard 会把另一个刚写入的内容清掉
    // （2026-09-18 实测：并行跑时两个测试的 read 都返回空，误报「写入失败」）。
    #[cfg(windows)]
    static CLIPBOARD_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[cfg(windows)]
    #[test]
    fn real_clipboard_roundtrip_when_available() {
        let _guard = CLIPBOARD_LOCK.lock().unwrap_or_else(|error| error.into_inner());
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

    // 【双格式共存真机验证】（2026-09-18：复制文件卡后在外部粘贴出真文件的关键）
    // clipboard-win 的高级 setter（formats::Unicode.write_clipboard）若内部自带
    // open + empty，第二次写入会把先写入的 CF_HDROP 冲掉 —— 双格式就名存实亡。
    // 本测试在真实桌面会话下验证「一次写入后两种格式都能读回」；打开失败（无头 /
    // 被占用）时退化为中文错误断言。
    #[cfg(windows)]
    #[test]
    fn real_clipboard_dual_format_roundtrip_when_available() {
        let _guard = CLIPBOARD_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        let dir = temp_dir("dual-format");
        let file = dir.join("外贴文件.txt");
        std::fs::write(&file, b"x").unwrap();
        let path_text = file.to_string_lossy().into_owned();

        match native::write_files_and_text(&[path_text.clone()], "双格式文本") {
            Ok(count) => {
                assert_eq!(count, 1);
                // 文件格式还在（关键断言：文本段写入没有清掉 CF_HDROP）
                let files = native::read_files().unwrap();
                assert_eq!(files, vec![path_text], "CF_HDROP 被后续文本写入清掉——双格式未共存");
                // 文本格式也读得回（Getter trait 须在作用域内才能调 read_clipboard）
                use clipboard_win::Getter as _;
                let _clipboard =
                    clipboard_win::Clipboard::new_attempts(10).expect("打开剪贴板失败（读回文本）");
                let mut text = String::new();
                clipboard_win::formats::Unicode
                    .read_clipboard(&mut text)
                    .expect("读回 CF_UNICODETEXT 失败");
                assert_eq!(text, "双格式文本");
            }
            // 无头会话 / 剪贴板被占用：只要求错误是中文且可展示
            Err(error) => assert!(!error.is_empty(), "错误信息不能为空"),
        }

        std::fs::remove_dir_all(&dir).ok();
    }
}
