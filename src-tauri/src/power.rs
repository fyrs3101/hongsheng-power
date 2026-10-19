use crate::config::{self, AppState, PowerCaps, Store, action_label, now_ts};
use std::fs;
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出程序", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    TrayIconBuilder::new()
        .icon(icon)
        .tooltip(config::APP_FULL_NAME)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// 当前进程是否以管理员身份运行
pub fn is_admin() -> bool {
    let out = crate::ps::run_powershell(
        "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)",
    );
    out.stdout.trim().eq_ignore_ascii_case("true")
}

const SLEEP_PS1: &str = r#"# 智能电源管理 - 睡眠辅助脚本
$sig = '[DllImport("powrprof.dll")] public static extern bool SetSuspendState(bool Hibernate, bool ForceCritical, bool DisableWakeEvent);'
try {
    $t = Add-Type -MemberDefinition $sig -Name HongshengSleep -Namespace HongshengPower -PassThru
    $null = $t::SetSuspendState($false, $true, $false)
} catch {
    rundll32.exe powrprof.dll,SetSuspendState 0,1,0
}
"#;

pub fn ensure_helpers(store: &Store) -> Result<(), String> {
    let dir = store.helpers_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("创建辅助脚本目录失败: {}", e))?;
    let path = dir.join("sleep.ps1");
    if !path.exists() {
        fs::write(&path, SLEEP_PS1).map_err(|e| format!("写入睡眠脚本失败: {}", e))?;
    }
    Ok(())
}

/// 立即执行电源动作
pub fn execute_action(store: &Store, action: &str) -> Result<(), String> {
    let _ = ensure_helpers(store);
    match action {
        "shutdown" => crate::ps::run_cmd(&["/c", "shutdown /s /f /t 0"]),
        "restart" => crate::ps::run_cmd(&["/c", "shutdown /r /f /t 0"]),
        "hibernate" => crate::ps::run_cmd(&["/c", "shutdown /h"]),
        "lock" => crate::ps::run_cmd(&["/c", "rundll32.exe user32.dll,LockWorkStation"]),
        "sleep" => {
            let p = store.helpers_dir().join("sleep.ps1");
            let mut cmd = Command::new("powershell.exe");
            cmd.creation_flags(crate::ps::CREATE_NO_WINDOW).args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                &p.display().to_string(),
            ]);
            let out = crate::ps::run_with_timeout(cmd)
                .map_err(|e| format!("执行睡眠失败: {}", e))?;
            if out.status.success() {
                Ok(())
            } else {
                Err(crate::ps::decode_console(&out.stderr).trim().to_string())
            }
        }
        _ => Err(format!("不支持的动作: {}", action)),
    }
}

/// 查询睡眠 / 休眠能力
pub fn get_power_capabilities() -> PowerCaps {
    let mut cmd = Command::new("cmd.exe");
    cmd.creation_flags(crate::ps::CREATE_NO_WINDOW)
        .args(["/c", "powercfg /a"]);
    let out = crate::ps::run_with_timeout(cmd);
    let raw = match out {
        Ok(o) => {
            let mut s = crate::ps::decode_console(&o.stdout);
            let e = crate::ps::decode_console(&o.stderr);
            if !e.trim().is_empty() {
                if !s.trim().is_empty() {
                    s.push('\n');
                }
                s.push_str(e.trim());
            }
            s
        }
        Err(e) => format!("查询失败: {}", e),
    };
    // 取 "不可用/没有" 之前的部分作为可用状态
    let lower = raw.to_lowercase();
    let split_at = lower
        .find("not available")
        .or_else(|| lower.find("unavailable"))
        .or_else(|| lower.find("不可用"))
        .or_else(|| raw.find("没有"));
    let available_part = match split_at {
        Some(i) => &raw[..i],
        None => &raw[..],
    };
    let al = available_part.to_lowercase();
    let sleep = al.contains("standby") || available_part.contains("待机") || available_part.contains("睡眠");
    let hibernate = al.contains("hibernate") || available_part.contains("休眠");
    PowerCaps {
        sleep_available: sleep,
        hibernate_available: hibernate,
        raw,
    }
}

/// 启动应用内倒计时线程（睡眠 / 休眠 / 锁定）
pub fn spawn_countdown_thread(app: AppHandle, action: String, ends_at: i64) {
    std::thread::spawn(move || {
        loop {
            let now = now_ts();
            if now >= ends_at {
                break;
            }
            {
                let st = app.state::<AppState>();
                let cfg = st.config.lock().unwrap();
                let same = cfg
                    .countdown
                    .as_ref()
                    .map(|c| c.ends_at == ends_at && c.action == action)
                    .unwrap_or(false);
                if !same {
                    return; // 已取消或被替换
                }
            }
            let wait = (ends_at - now_ts()).min(1).max(0) as u64;
            std::thread::sleep(std::time::Duration::from_secs(wait));
        }
        let st = app.state::<AppState>();
        let exec = execute_action(&st.store, &action);
        let mut cfg = st.config.lock().unwrap();
        cfg.countdown = None;
        match exec {
            Ok(()) => st
                .store
                .add_log(&mut cfg, "success", &format!("倒计时结束，已执行「{}」", action_label(&action))),
            Err(e) => st.store.add_log(
                &mut cfg,
                "error",
                &format!("倒计时执行「{}」失败: {}", action_label(&action), e),
            ),
        }
        let _ = st.store.save(&cfg);
    });
}

/// 启动时恢复倒计时显示
pub fn restore_countdown(app: &AppHandle) {
    let st = app.state::<AppState>();
    let mut cfg = st.config.lock().unwrap();
    let cd = cfg.countdown.clone();
    match cd {
        Some(c) => {
            if c.ends_at <= now_ts() {
                cfg.countdown = None;
                let _ = st.store.save(&cfg);
            } else if c.mode == "app" {
                drop(cfg);
                spawn_countdown_thread(app.clone(), c.action.clone(), c.ends_at);
            }
        }
        None => {}
    }
}

/// 校验任务数据
pub fn validate_task(
    name: &str,
    action: &str,
    task_type: &str,
    time: &str,
    date: &Option<String>,
    days: &Option<Vec<u8>>,
) -> Result<(), String> {
    use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 30 {
        return Err("任务名称需为 1-30 个字符".into());
    }
    if name.contains('\'') || name.contains('"') || name.contains('\n') || name.contains('\r') {
        return Err("任务名称不能包含引号或换行".into());
    }
    if !crate::config::ACTIONS.contains(&action) {
        return Err("未知的执行动作".into());
    }
    if !crate::config::TASK_TYPES.contains(&task_type) {
        return Err("未知的重复方式".into());
    }
    let mut valid_time = false;
    let parts: Vec<&str> = time.split(':').collect();
    if parts.len() == 2 {
        if let (Ok(h), Ok(m)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
            if parts[0].len() == 2 && parts[1].len() == 2 && h < 24 && m < 60 {
                valid_time = true;
            }
        }
    }
    if !valid_time {
        return Err("时间格式应为 HH:mm（24 小时制）".into());
    }
    match task_type {
        "once" => {
            let d = date.as_ref().ok_or("请选择执行日期")?;
            let nd = NaiveDate::parse_from_str(d, "%Y-%m-%d")
                .map_err(|_| "日期格式应为 YYYY-MM-DD".to_string())?;
            let nt = NaiveTime::parse_from_str(time, "%H:%M").unwrap();
            let target = NaiveDateTime::new(nd, nt);
            if target <= chrono::Local::now().naive_local() {
                return Err("执行时间不能早于当前时间".into());
            }
        }
        "weekly" => {
            let ds = days.as_ref().ok_or("请至少选择一个星期")?;
            if ds.is_empty() || ds.iter().any(|d| *d < 1 || *d > 7) {
                return Err("星期选择无效".into());
            }
        }
        _ => {}
    }
    Ok(())
}

/// Win11 原生圆角窗口。
/// `decorations: false` 的无边框窗口不会自动获得 DWM 圆角，
/// 这里通过 DwmSetWindowAttribute(DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND)
/// 补上 Windows 11 标志性的窗口圆角（Win11 build 16237+ 生效，Win10 上静默失败）。
#[cfg(windows)]
pub fn apply_win11_round_corners(window: &tauri::WebviewWindow) {
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut core::ffi::c_void,
            dw_attribute: u32,
            pv_attribute: *const core::ffi::c_void,
            cb_attribute: u32,
        ) -> i32;
    }
    // DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_ROUND = 2
    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWCP_ROUND: i32 = 2;

    if let Ok(hwnd) = window.hwnd() {
        let pref = DWMWCP_ROUND;
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd.0,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &pref as *const i32 as *const core::ffi::c_void,
                std::mem::size_of::<i32>() as u32,
            );
        }
    }
}

#[cfg(not(windows))]
pub fn apply_win11_round_corners(_window: &tauri::WebviewWindow) {}
