use crate::config::Task;
use std::path::Path;
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Windows CREATE_NO_WINDOW 进程创建标志（0x08000000）。
/// 启动 powershell.exe / cmd.exe 等控制台子系统程序时加上此标志，
/// 避免 GUI 主程序弹出闪烁的黑色控制台窗口。
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct PsOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

pub fn error_message(out: &PsOutput) -> String {
    let raw = if !out.stderr.trim().is_empty() {
        out.stderr.trim()
    } else {
        out.stdout.trim()
    };
    let s = raw.strip_prefix("ERR:").unwrap_or(raw);
    let s = s.trim();
    if s.is_empty() {
        return "未知错误".to_string();
    }
    friendly_error(s).to_string()
}

/// 把 Windows/PowerShell 常见报错映射为可操作的中文提示
fn friendly_error(raw: &str) -> String {
    let low = raw.to_lowercase();
    if low.contains("access is denied") || low.contains("拒绝访问") || low.contains("access denied") {
        return "权限不足：请右键程序图标，选择「以管理员身份运行」后重试。（当前程序未获得管理员权限，无法写入系统任务计划）".into();
    }
    let sched_down = low.contains("the task scheduler service")
        || (low.contains("not running") && low.contains("scheduler"));
    if sched_down {
        return "Windows「任务计划程序」服务未运行：请按 Win+R 输入 services.msc，找到 Task Scheduler 并启动。".into();
    }
    if low.contains("cannot find path") || low.contains("not recognize") {
        return "系统缺少 ScheduledTasks 模块，您的 Windows 版本可能过旧。".into();
    }
    if low.contains("exceeded the timeout") || low.contains("执行超时") {
        return raw.into();
    }
    raw.to_string()
}

const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(B64[(b0 >> 2) as usize] as char);
        out.push(B64[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            B64[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[(b2 & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// 解码 PowerShell 输出。
/// run_powershell 已强制 [Console]::OutputEncoding = UTF8，
/// 因此优先按 UTF-8 解码；失败时再回退 GBK（旧系统兼容）。
/// 注意：绝不能先试 UTF-16——GBK 字节流经常「碰巧」是合法 UTF-16，
/// 会解码出一堆看似汉字的乱码且不报任何错，这正是弹窗乱码的根源。
pub fn decode_ps(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.trim_start_matches('\u{FEFF}').to_string();
    }
    if bytes.len() >= 2 && bytes.len() % 2 == 0 {
        let u16s: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        if let Ok(s) = String::from_utf16(&u16s) {
            if !s.contains('\u{FFFD}') && !s.contains('\0') {
                return s.trim_start_matches('\u{FEFF}').to_string();
            }
        }
    }
    let (cow, _, _) = encoding_rs::GBK.decode(bytes);
    cow.into_owned()
}

/// 解码 cmd 控制台输出（简体中文 Windows 默认 GBK / 代码页 936）
pub fn decode_console(bytes: &[u8]) -> String {
    let (cow, _, _) = encoding_rs::GBK.decode(bytes);
    cow.into_owned()
}

/// PowerShell / cmd 执行超时（秒）。
/// 防止「任务计划程序」服务异常等原因导致子进程挂起时，
/// Tauri 命令无限期阻塞、界面表现为卡死。超时后强制结束子进程。
const PROCESS_TIMEOUT_SECS: u64 = 30;

/// 带超时与强制结束能力的进程执行器。
/// `Command::output()` 会无限期等待子进程退出，这在 GUI 程序中非常危险：
/// 任何一次子进程挂起都会让 invoke 调用永不返回、界面假死。
pub fn run_with_timeout(mut cmd: Command) -> Result<std::process::Output, String> {
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = cmd
        .spawn()
        .map_err(|e| format!("无法启动进程: {}", e))?;
    let shared = Arc::new(Mutex::new(child));
    let c2 = Arc::clone(&shared);
    let (tx, rx) = mpsc::channel();

    std::thread::spawn(move || {
        use std::io::Read;
        let out = loop {
            let mut ch = match c2.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            match ch.try_wait() {
                Ok(Some(_)) => {
                    // 进程已退出：读取管道剩余输出并等待状态
                    let mut stdout = Vec::new();
                    let mut stderr = Vec::new();
                    if let Some(mut so) = ch.stdout.take() {
                        let _ = so.read_to_end(&mut stdout);
                    }
                    if let Some(mut se) = ch.stderr.take() {
                        let _ = se.read_to_end(&mut stderr);
                    }
                    break ch.wait().map(|status| std::process::Output {
                        status,
                        stdout,
                        stderr,
                    });
                }
                Ok(None) => {
                    drop(ch);
                    std::thread::sleep(Duration::from_millis(200));
                }
                Err(e) => break Err(e),
            }
        };
        let _ = tx.send(out);
    });

    match rx.recv_timeout(Duration::from_secs(PROCESS_TIMEOUT_SECS)) {
        Ok(Ok(o)) => Ok(o),
        Ok(Err(e)) => Err(format!("进程执行失败: {}", e)),
        Err(_) => {
            // 超时：强制结束子进程（等待线程最多持锁 200ms）
            {
                let mut ch = match shared.lock() {
                    Ok(g) => g,
                    Err(p) => p.into_inner(),
                };
                let _ = ch.kill();
            }
            // 等待线程收尾（kill 后 try_wait 立即成功，管道随即 EOF）
            let _ = rx.recv_timeout(Duration::from_secs(3));
            Err(format!(
                "执行超时（{} 秒），进程已被强制结束。请检查 Windows「任务计划程序」服务是否处于运行状态。",
                PROCESS_TIMEOUT_SECS
            ))
        }
    }
}

/// 执行 PowerShell 脚本（-EncodedCommand，避免引号与编码问题）
pub fn run_powershell(script: &str) -> PsOutput {
    // 强制输出编码为 UTF-8：中文 Windows 上 powershell.exe 重定向输出
    // 默认用系统 OEM 代码页（936/GBK），不强制会导致错误信息乱码
    let script = format!(
        "$ProgressPreference = 'SilentlyContinue'\n$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n{}",
        script
    );
    let mut bytes = Vec::with_capacity(script.len() * 2);
    for u in script.encode_utf16() {
        bytes.extend_from_slice(&u.to_le_bytes());
    }
    let encoded = base64_encode(&bytes);
    let mut cmd = Command::new("powershell.exe");
    cmd.creation_flags(CREATE_NO_WINDOW).args([
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        &encoded,
    ]);
    match run_with_timeout(cmd) {
        Ok(o) => PsOutput {
            stdout: decode_ps(&o.stdout),
            stderr: decode_ps(&o.stderr),
            success: o.status.success(),
        },
        Err(e) => PsOutput {
            stdout: String::new(),
            stderr: format!("无法启动 PowerShell: {}", e),
            success: false,
        },
    }
}

/// 执行 cmd 命令
pub fn run_cmd(args: &[&str]) -> Result<(), String> {
    let mut cmd = Command::new("cmd.exe");
    cmd.creation_flags(CREATE_NO_WINDOW).args(args);
    let out = run_with_timeout(cmd).map_err(|e| format!("执行命令失败: {}", e))?;
    if out.status.success() {
        Ok(())
    } else {
        let err = decode_console(&out.stderr);
        if err.trim().is_empty() {
            Err("命令执行失败".to_string())
        } else {
            Err(err.trim().to_string())
        }
    }
}

pub fn system_task_name(id: &str) -> String {
    let short: String = id.chars().take(8).collect();
    format!("{}{}", crate::config::TASK_PREFIX, short)
}

fn day_name(d: u8) -> &'static str {
    match d {
        1 => "Monday",
        2 => "Tuesday",
        3 => "Wednesday",
        4 => "Thursday",
        5 => "Friday",
        6 => "Saturday",
        7 => "Sunday",
        _ => "Monday",
    }
}

/// 动作对应的可执行文件与参数
fn action_command(action: &str, helpers_dir: &Path) -> (String, String) {
    match action {
        "shutdown" => ("shutdown.exe".into(), "/s /f /t 0".into()),
        "restart" => ("shutdown.exe".into(), "/r /f /t 0".into()),
        "hibernate" => ("shutdown.exe".into(), "/h".into()),
        "lock" => ("rundll32.exe".into(), "user32.dll,LockWorkStation".into()),
        "sleep" => {
            let p = helpers_dir.join("sleep.ps1");
            (
                "powershell.exe".into(),
                format!(
                    "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"{}\"",
                    p.display()
                ),
            )
        }
        "wake" => ("cmd.exe".into(), "/c exit 0".into()),
        _ => ("shutdown.exe".into(), "/s /f /t 0".into()),
    }
}

fn trigger_expression(t: &Task) -> Result<String, String> {
    match t.task_type.as_str() {
        "once" => {
            let date = t.date.as_ref().ok_or("仅一次计划需要指定日期")?;
            Ok(format!(
                "New-ScheduledTaskTrigger -Once -At ([datetime]::ParseExact('{} {}','yyyy-MM-dd HH:mm',$null))",
                date, t.time
            ))
        }
        "daily" => Ok(format!("New-ScheduledTaskTrigger -Daily -At '{}'", t.time)),
        "weekday" => Ok(format!(
            "New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '{}'",
            t.time
        )),
        "weekend" => Ok(format!(
            "New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday,Sunday -At '{}'",
            t.time
        )),
        "weekly" => {
            let days = t.days.as_ref().ok_or("每周计划需要选择星期")?;
            if days.is_empty() {
                return Err("每周计划需要至少选择一个星期".into());
            }
            let names: Vec<&str> = days.iter().map(|d| day_name(*d)).collect();
            Ok(format!(
                "New-ScheduledTaskTrigger -Weekly -DaysOfWeek {} -At '{}'",
                names.join(","),
                t.time
            ))
        }
        _ => Err("未知的重复方式".into()),
    }
}

/// 在 Windows 任务计划程序中注册计划
pub fn register_task(task: &Task, is_admin: bool, helpers_dir: &Path) -> Result<(), String> {
    let name = system_task_name(&task.id);
    let (exe, args) = action_command(&task.action, helpers_dir);
    let trigger = trigger_expression(task)?;
    let settings = if task.action == "wake" {
        "New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -WakeToRun"
    } else {
        "New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries"
    };
    // 锁定动作必须在交互用户会话下执行；其余动作在管理员模式下交给 SYSTEM，未登录也能生效
    let principal = if is_admin && task.action != "lock" {
        " -User 'SYSTEM' -RunLevel 'Highest'"
    } else {
        ""
    };
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
try {{
    $a = New-ScheduledTaskAction -Execute '{exe}' -Argument '{args}'
    $t = {trigger}
    $s = {settings}
    Register-ScheduledTask -TaskName '{name}' -Action $a -Trigger $t -Settings $s -Force{principal} | Out-Null
    'OK'
}} catch {{
    Write-Output ('ERR:' + $_.Exception.Message)
    exit 1
}}
"#,
        exe = exe,
        args = args,
        trigger = trigger,
        settings = settings,
        name = name,
        principal = principal
    );
    let out = run_powershell(&script);
    if out.success && out.stdout.trim().starts_with("OK") {
        Ok(())
    } else {
        Err(error_message(&out))
    }
}

pub fn unregister_task(name: &str) -> Result<(), String> {
    let script = format!(
        "Unregister-ScheduledTask -TaskName '{}' -Confirm:$false -ErrorAction Stop",
        name
    );
    let out = run_powershell(&script);
    if out.success {
        Ok(())
    } else {
        Err(error_message(&out))
    }
}

pub fn set_task_state(name: &str, enable: bool) -> Result<(), String> {
    let cmd = if enable {
        "Enable-ScheduledTask"
    } else {
        "Disable-ScheduledTask"
    };
    let script = format!("{} -TaskName '{}' -ErrorAction Stop", cmd, name);
    let out = run_powershell(&script);
    if out.success {
        Ok(())
    } else {
        Err(error_message(&out))
    }
}

pub fn start_task_now(name: &str) -> Result<(), String> {
    let script = format!("Start-ScheduledTask -TaskName '{}' -ErrorAction Stop", name);
    let out = run_powershell(&script);
    if out.success {
        Ok(())
    } else {
        Err(error_message(&out))
    }
}

/// 列出所有 HSPower_* 系统计划任务，返回 (任务名, 是否启用)
pub fn list_system_tasks() -> Result<Vec<(String, bool)>, String> {
    let script = r#"
$ErrorActionPreference = 'Stop'
try {
    Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like 'HSPower_*' } | ForEach-Object {
        [pscustomobject]@{ n = $_.TaskName; s = ($_.State -ne 'Disabled') }
    } | ConvertTo-Json -Compress
} catch {
    '[]'
}
"#;
    let out = run_powershell(script);
    let text = out.stdout.trim();
    if text.is_empty() {
        return Ok(vec![]);
    }
    let v: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("解析任务列表失败: {}", e))?;
    let arr = match v {
        serde_json::Value::Array(a) => a,
        other => vec![other],
    };
    Ok(arr
        .iter()
        .filter_map(|o| {
            let n = o.get("n")?.as_str()?.to_string();
            let s = o.get("s")?.as_bool().unwrap_or(true);
            Some((n, s))
        })
        .collect())
}
