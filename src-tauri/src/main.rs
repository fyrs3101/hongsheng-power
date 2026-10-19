#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod power;
mod ps;

use config::{AppState, Store};
use std::fs;
use tauri::{Emitter, Manager, WindowEvent};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            power::show_main_window(app);
            // 通知前端：第二个实例被唤起（常见于新版 exe 双击后旧版仍在运行），
            // 弹出明确提示，避免用户误以为"启动失败/没变化"
            let _ = app.emit("instance-already-running", ());
        }))
        .setup(|app| {
            let data_dir = match app.path().app_data_dir() {
                Ok(d) => d,
                Err(e) => return Err(format!("无法获取数据目录: {}", e).into()),
            };
            let _ = fs::create_dir_all(&data_dir);
            let store = Store::new(data_dir);
            let cfg = store.load();
            let is_admin = power::is_admin();
            app.manage(AppState::new(store, cfg, is_admin));

            if let Err(e) = power::build_tray(app.handle()) {
                eprintln!("[智能电源管理] 托盘创建失败: {}", e);
            }

            // Win11 原生圆角窗口（无边框窗口不会自动获得 DWM 圆角）
            if let Some(w) = app.get_webview_window("main") {
                power::apply_win11_round_corners(&w);
                // 标题带版本号：任务栏 / Alt+Tab 中可直接确认运行的是否为最新版
                let _ = w.set_title(&format!(
                    "鸿升智能电源管理 v{}",
                    config::APP_VERSION
                ));
                // 小屏幕 / 高 DPI 适配：默认窗口尺寸超出屏幕时自动缩小一档，
                // 避免标题栏按钮被挤出屏幕外无法操作
                if let Ok(Some(monitor)) = w.current_monitor() {
                    let scale = monitor.scale_factor();
                    let sw = monitor.size().width as f64 / scale;
                    let sh = monitor.size().height as f64 / scale;
                    let mut ww = 1100.0f64;
                    let mut wh = 720.0f64;
                    if ww > sw - 40.0 {
                        ww = (sw - 40.0).max(940.0);
                    }
                    if wh > sh - 80.0 {
                        wh = (sh - 80.0).max(560.0);
                    }
                    if (ww - 1100.0).abs() > 1.0 || (wh - 720.0).abs() > 1.0 {
                        let _ = w.set_size(tauri::LogicalSize::new(ww, wh));
                    }
                    let _ = w.center();
                }
            }

            // 后台同步计划任务与恢复倒计时
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                commands::sync_tasks_internal(&handle);
                power::restore_countdown(&handle);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let minimize = {
                    let st = app.state::<AppState>();
                    let x = st.config.lock().unwrap().settings.minimize_to_tray;
                    x
                };
                if minimize {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap,
            commands::create_task,
            commands::update_task,
            commands::delete_task,
            commands::set_task_enabled,
            commands::run_task_now,
            commands::sync_tasks,
            commands::immediate_action,
            commands::start_countdown,
            commands::cancel_countdown,
            commands::set_autostart,
            commands::set_minimize_to_tray,
            commands::verify_password,
            commands::set_password,
            commands::clear_password,
            commands::relaunch_elevated,
            commands::enable_hibernate,
            commands::open_data_dir,
            commands::get_logs,
            commands::clear_logs,
        ])
        .run(tauri::generate_context!())
        .expect("运行智能电源管理失败");
}
