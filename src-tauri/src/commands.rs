use crate::config::*;
use crate::{power, ps};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPayload {
    pub name: String,
    pub action: String,
    #[serde(rename = "type")]
    pub task_type: String,
    pub time: String,
    pub date: Option<String>,
    pub days: Option<Vec<u8>>,
    pub enabled: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    config: Config,
    is_admin: bool,
    exe_path: String,
    data_dir: String,
    version: String,
    countdown: Option<Countdown>,
    power_caps: PowerCaps,
}

fn exe_path_string() -> String {
    std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_default()
}

// ============ 内部同步逻辑 ============

pub fn sync_tasks_internal(app: &AppHandle) {
    let st = app.state::<AppState>();
    let is_admin = *st.is_admin.lock().unwrap();
    let helpers = st.store.helpers_dir();
    let _ = power::ensure_helpers(&st.store);
    let sys = ps::list_system_tasks().unwrap_or_default();
    let mut sys_map: HashMap<String, bool> = sys.into_iter().collect();

    // 1. 锁内：仅克隆任务快照，随即释放锁
    let tasks: Vec<Task> = {
        let cfg = st.config.lock().unwrap();
        cfg.tasks.clone()
    };

    // 2. 锁外：执行所有 PowerShell 操作（每个 1-3 秒，绝不能持锁执行，
    //    否则会阻塞 create_task 等命令，表现为界面卡住）
    let mut notes: Vec<(String, String)> = Vec::new(); // (level, message)
    let mut changed = false;
    for t in &tasks {
        let sysname = ps::system_task_name(&t.id);
        match sys_map.remove(&sysname) {
            Some(registered) => {
                if registered != t.enabled {
                    if let Err(e) = ps::set_task_state(&sysname, t.enabled) {
                        notes.push((
                            "warn".into(),
                            format!("更新「{}」启用状态失败: {}", t.name, e),
                        ));
                        changed = true;
                    } else {
                        changed = true;
                    }
                }
            }
            None => match ps::register_task(t, is_admin, &helpers) {
                Ok(()) => {
                    if !t.enabled {
                        let _ = ps::set_task_state(&sysname, false);
                    }
                    changed = true;
                }
                Err(e) => {
                    notes.push(("warn".into(), format!("恢复计划「{}」失败: {}", t.name, e)));
                    changed = true;
                }
            },
        }
    }
    // 清理已不在配置中的残留系统任务
    for (sysname, _) in sys_map {
        if ps::unregister_task(&sysname).is_ok() {
            changed = true;
        }
    }

    // 3. 锁内：写入日志并保存
    if changed || !notes.is_empty() {
        let mut cfg = st.config.lock().unwrap();
        for (level, msg) in notes {
            st.store.add_log(&mut cfg, &level, &msg);
        }
        if changed {
            let _ = st.store.save(&cfg);
        }
    }
}

// ============ Tauri 命令 ============

#[tauri::command]
pub fn get_bootstrap(state: tauri::State<'_, AppState>) -> Result<Bootstrap, String> {
    let cfg = state.config.lock().unwrap().clone();
    Ok(Bootstrap {
        config: cfg.clone(),
        is_admin: *state.is_admin.lock().unwrap(),
        exe_path: exe_path_string(),
        data_dir: state.store.dir.display().to_string(),
        version: APP_VERSION.to_string(),
        countdown: cfg.countdown,
        power_caps: power::get_power_capabilities(),
    })
}

#[tauri::command]
pub fn create_task(payload: TaskPayload, state: tauri::State<'_, AppState>) -> Result<Task, String> {
    power::validate_task(
        &payload.name,
        &payload.action,
        &payload.task_type,
        &payload.time,
        &payload.date,
        &payload.days,
    )?;
    let is_admin = *state.is_admin.lock().unwrap();
    let helpers = state.store.helpers_dir();
    power::ensure_helpers(&state.store)?;
    let task = Task {
        id: uuid::Uuid::new_v4().to_string(),
        name: payload.name.trim().to_string(),
        action: payload.action,
        task_type: payload.task_type,
        time: payload.time,
        date: payload.date,
        days: payload.days,
        enabled: payload.enabled.unwrap_or(true),
        created_at: now_str(),
    };
    ps::register_task(&task, is_admin, &helpers)?;
    if !task.enabled {
        let _ = ps::set_task_state(&ps::system_task_name(&task.id), false);
    }
    // 复核：确认系统任务确实已注册成功，避免"看起来创建了其实没有"
    let sysname = ps::system_task_name(&task.id);
    let registered = ps::list_system_tasks()
        .map(|v| v.iter().any(|(n, _)| *n == sysname))
        .unwrap_or(true);
    if !registered {
        return Err(format!(
            "系统任务计划未能创建（{0}）。请确认：1) 程序以管理员身份运行；2) Windows「任务计划程序」服务正在运行（Win+R 输入 services.msc 检查 Task Scheduler）。",
            sysname
        ));
    }
    let mut cfg = state.config.lock().unwrap();
    cfg.tasks.push(task.clone());
    st_log(&state, &mut cfg, "success", &format!(
        "创建定时计划「{}」：{} {}（系统任务 {}）",
        task.name,
        action_label(&task.action),
        type_label(&task.task_type),
        sysname
    ));
    // 写盘失败不应让用户误以为"创建失败"——系统任务已生效，
    // 因此记录错误但仍返回成功，并保证数据目录存在后重试一次
    if let Err(e) = state.store.save(&cfg) {
        let _ = std::fs::create_dir_all(&state.store.dir);
        if let Err(e2) = state.store.save(&cfg) {
            st_log(&state, &mut cfg, "warn", &format!(
                "计划已创建但配置保存失败（{} / {}），重启程序后该计划可能丢失",
                e, e2
            ));
        }
    }
    Ok(task)
}

#[tauri::command]
pub fn update_task(
    id: String,
    payload: TaskPayload,
    state: tauri::State<'_, AppState>,
) -> Result<Task, String> {
    power::validate_task(
        &payload.name,
        &payload.action,
        &payload.task_type,
        &payload.time,
        &payload.date,
        &payload.days,
    )?;
    let is_admin = *state.is_admin.lock().unwrap();
    let helpers = state.store.helpers_dir();
    power::ensure_helpers(&state.store)?;
    let old = {
        let cfg = state.config.lock().unwrap();
        cfg.tasks
            .iter()
            .find(|t| t.id == id)
            .cloned()
            .ok_or("计划不存在，可能已被删除")?
    };
    let task = Task {
        id: id.clone(),
        name: payload.name.trim().to_string(),
        action: payload.action,
        task_type: payload.task_type,
        time: payload.time,
        date: payload.date,
        days: payload.days,
        enabled: payload.enabled.unwrap_or(true),
        created_at: old.created_at,
    };
    // Register-ScheduledTask -Force 会覆盖同名任务，无需先注销
    ps::register_task(&task, is_admin, &helpers)?;
    if !task.enabled {
        let _ = ps::set_task_state(&ps::system_task_name(&id), false);
    }
    let mut cfg = state.config.lock().unwrap();
    if let Some(t) = cfg.tasks.iter_mut().find(|t| t.id == id) {
        *t = task.clone();
    }
    st_log(&state, &mut cfg, "info", &format!("修改定时计划「{}」", task.name));
    state.store.save(&cfg)?;
    Ok(task)
}

#[tauri::command]
pub fn delete_task(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let name = ps::system_task_name(&id);
    let task_name = {
        let cfg = state.config.lock().unwrap();
        cfg.tasks
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.name.clone())
            .unwrap_or_else(|| id.clone())
    };
    let _ = ps::unregister_task(&name);
    let mut cfg = state.config.lock().unwrap();
    cfg.tasks.retain(|t| t.id != id);
    st_log(&state, &mut cfg, "warn", &format!("删除定时计划「{}」", task_name));
    state.store.save(&cfg)?;
    Ok(())
}

#[tauri::command]
pub fn set_task_enabled(
    id: String,
    enabled: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let name = ps::system_task_name(&id);
    let (task_name, exists) = {
        let cfg = state.config.lock().unwrap();
        let t = cfg.tasks.iter().find(|t| t.id == id).ok_or("计划不存在")?;
        (t.name.clone(), true)
    };
    let _ = exists;
    ps::set_task_state(&name, enabled)?;
    let mut cfg = state.config.lock().unwrap();
    if let Some(t) = cfg.tasks.iter_mut().find(|t| t.id == id) {
        t.enabled = enabled;
    }
    st_log(
        &state,
        &mut cfg,
        "info",
        &format!("{}「{}」", if enabled { "启用" } else { "停用" }, task_name),
    );
    state.store.save(&cfg)?;
    Ok(())
}

#[tauri::command]
pub fn run_task_now(id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let name = ps::system_task_name(&id);
    let task_name = {
        let cfg = state.config.lock().unwrap();
        cfg.tasks
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.name.clone())
            .ok_or("计划不存在")?
    };
    ps::start_task_now(&name)?;
    let mut cfg = state.config.lock().unwrap();
    st_log(&state, &mut cfg, "info", &format!("立即执行计划「{}」", task_name));
    state.store.save(&cfg)?;
    Ok(())
}

#[tauri::command]
pub fn sync_tasks(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<Config, String> {
    sync_tasks_internal(&app);
    Ok(state.config.lock().unwrap().clone())
}

#[tauri::command]
pub fn immediate_action(action: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    if !ACTIONS.contains(&action.as_str()) || action == "wake" {
        return Err("不支持的立即执行动作".into());
    }
    power::execute_action(&state.store, &action)?;
    let mut cfg = state.config.lock().unwrap();
    st_log(
        &state,
        &mut cfg,
        "success",
        &format!("立即执行「{}」", action_label(&action)),
    );
    state.store.save(&cfg)?;
    Ok(())
}

#[tauri::command]
pub fn start_countdown(
    action: String,
    minutes: u32,
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Countdown, String> {
    if !ACTIONS.contains(&action.as_str()) || action == "wake" {
        return Err("不支持的动作".into());
    }
    if minutes < 1 || minutes > 1440 {
        return Err("倒计时时长需在 1 ~ 1440 分钟之间".into());
    }
    let secs = minutes as i64 * 60;
    let ends_at = now_ts() + secs;
    let mode = if action == "shutdown" || action == "restart" {
        "system"
    } else {
        "app"
    };
    if mode == "system" {
        let flag = if action == "shutdown" { "/s" } else { "/r" };
        ps::run_cmd(&["/c", &format!("shutdown {} /f /t {}", flag, secs)])?;
    }
    let cd = Countdown {
        action: action.clone(),
        mode: mode.to_string(),
        ends_at,
    };
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.countdown = Some(cd.clone());
        st_log(
            &state,
            &mut cfg,
            "info",
            &format!(
                "开始 {} 分钟倒计时「{}」（{}）",
                minutes,
                action_label(&action),
                if mode == "system" { "系统级" } else { "应用级" }
            ),
        );
        state.store.save(&cfg)?;
    }
    if mode == "app" {
        power::spawn_countdown_thread(app, action, ends_at);
    }
    Ok(cd)
}

#[tauri::command]
pub fn cancel_countdown(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mode = {
        let cfg = state.config.lock().unwrap();
        cfg.countdown.as_ref().map(|c| c.mode.clone())
    };
    if mode.as_deref() == Some("system") {
        ps::run_cmd(&["/c", "shutdown /a"])?;
    }
    let mut cfg = state.config.lock().unwrap();
    cfg.countdown = None;
    st_log(&state, &mut cfg, "info", "取消倒计时");
    state.store.save(&cfg)?;
    Ok(())
}

#[tauri::command]
pub fn set_autostart(enabled: bool, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let exe = exe_path_string();
    let script = if enabled {
        format!(
            "$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; if (-not (Test-Path $p)) {{ New-Item -Path $p -Force | Out-Null }}; New-ItemProperty -Path $p -Name '{}' -Value '\"{}\"' -PropertyType String -Force | Out-Null",
            RUN_KEY_NAME, exe
        )
    } else {
        format!(
            "Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name '{}' -ErrorAction SilentlyContinue",
            RUN_KEY_NAME
        )
    };
    let out = ps::run_powershell(&script);
    if !out.success {
        return Err(ps::error_message(&out));
    }
    let mut cfg = state.config.lock().unwrap();
    cfg.settings.autostart = enabled;
    st_log(
        &state,
        &mut cfg,
        "info",
        &format!("{}开机自动启动", if enabled { "开启" } else { "关闭" }),
    );
    state.store.save(&cfg)?;
    Ok(enabled)
}

#[tauri::command]
pub fn set_minimize_to_tray(enabled: bool, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.settings.minimize_to_tray = enabled;
    state.store.save(&cfg)?;
    Ok(())
}

#[tauri::command]
pub fn verify_password(password: String, state: tauri::State<'_, AppState>) -> Result<bool, String> {
    let cfg = state.config.lock().unwrap();
    let s = &cfg.settings;
    if !s.password_enabled || s.password_hash.is_empty() {
        return Ok(true);
    }
    Ok(hash_password(&password, &s.password_salt) == s.password_hash)
}

#[tauri::command]
pub fn set_password(
    old_password: Option<String>,
    new_password: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if new_password.trim().len() < 4 {
        return Err("管理密码至少需要 4 个字符".into());
    }
    let mut cfg = state.config.lock().unwrap();
    let s = &mut cfg.settings;
    if s.password_enabled && !s.password_hash.is_empty() {
        let ok = old_password
            .as_deref()
            .map(|p| hash_password(p, &s.password_salt) == s.password_hash)
            .unwrap_or(false);
        if !ok {
            return Err("原密码不正确".into());
        }
    }
    let salt = new_salt();
    s.password_salt = salt.clone();
    s.password_hash = hash_password(new_password.trim(), &salt);
    s.password_enabled = true;
    st_log(&state, &mut cfg, "success", "设置管理密码");
    state.store.save(&cfg)?;
    Ok(())
}

#[tauri::command]
pub fn clear_password(
    old_password: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    let s = &mut cfg.settings;
    if s.password_enabled && !s.password_hash.is_empty() {
        if hash_password(&old_password, &s.password_salt) != s.password_hash {
            return Err("原密码不正确".into());
        }
    }
    s.password_enabled = false;
    s.password_hash.clear();
    s.password_salt.clear();
    st_log(&state, &mut cfg, "info", "移除管理密码");
    state.store.save(&cfg)?;
    Ok(())
}

#[tauri::command]
pub fn relaunch_elevated(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let exe = exe_path_string();
    // -Verb RunAs 会触发 UAC 确认框；Start-Process 默认不等待子进程退出，
    // 但 PowerShell 会等待 UAC 交互结束，故限制超时并忽略失败细节，
    // 避免用户未点 UAC 时命令长时间挂起。
    let script = format!(
        "Start-Process -FilePath '{}' -Verb RunAs -ErrorAction Stop; 'OK'",
        exe.replace('\'', "''")
    );
    let out = ps::run_powershell(&script);
    let ok = out.success && out.stdout.contains("OK");
    {
        let mut cfg = state.config.lock().unwrap();
        st_log(
            &state,
            &mut cfg,
            if ok { "info" } else { "warn" },
            if ok {
                "以管理员身份重启应用"
            } else {
                "请求管理员权限未完成（可能取消了 UAC 确认）"
            },
        );
        let _ = state.store.save(&cfg);
    }
    if !ok {
        return Err(format!(
            "未获得管理员权限：{}。您也可以关闭程序后，右键程序图标选择「以管理员身份运行」。",
            ps::error_message(&out)
        ));
    }
    // 稍等提权实例完成启动，避免单实例插件把新进程当作重复实例杀掉
    std::thread::sleep(std::time::Duration::from_millis(1200));
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn enable_hibernate(state: tauri::State<'_, AppState>) -> Result<PowerCaps, String> {
    ps::run_cmd(&["/c", "powercfg /h on"])?;
    let caps = power::get_power_capabilities();
    let mut cfg = state.config.lock().unwrap();
    st_log(&state, &mut cfg, "info", "开启系统休眠功能");
    state.store.save(&cfg)?;
    Ok(caps)
}

#[tauri::command]
pub fn open_data_dir(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let dir = state.store.dir.display().to_string();
    ps::run_cmd(&["/c", &format!("start \"\" \"{}\"", dir)])
}

#[tauri::command]
pub fn get_logs(state: tauri::State<'_, AppState>) -> Result<Vec<LogEntry>, String> {
    Ok(state.config.lock().unwrap().logs.clone())
}

#[tauri::command]
pub fn clear_logs(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    cfg.logs.clear();
    state.store.save(&cfg)?;
    Ok(())
}

/// 统一的记日志辅助（内部使用）
fn st_log(state: &tauri::State<'_, AppState>, cfg: &mut Config, level: &str, msg: &str) {
    state.store.add_log(cfg, level, msg);
}
