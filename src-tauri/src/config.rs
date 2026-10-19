use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ============ 应用信息（鸿升中学） ============
#[allow(dead_code)]
pub const APP_NAME: &str = "鸿升智能电源管理";
pub const APP_FULL_NAME: &str = "鸿升中学 · 智能电源管理";
#[allow(dead_code)]
pub const APP_VERSION: &str = "1.0.7";
#[allow(dead_code)]
pub const ORG: &str = "鸿升中学";
#[allow(dead_code)]
pub const DEPARTMENT: &str = "教务处";
#[allow(dead_code)]
pub const COPYRIGHT: &str = "© 2025 鸿升中学 教务处";
pub const RUN_KEY_NAME: &str = "鸿升智能电源管理";
pub const TASK_PREFIX: &str = "HSPower_";
pub const MAX_LOGS: usize = 300;

pub const ACTIONS: [&str; 6] = ["shutdown", "restart", "sleep", "hibernate", "lock", "wake"];
pub const TASK_TYPES: [&str; 5] = ["once", "daily", "weekly", "weekday", "weekend"];

pub fn action_label(a: &str) -> &'static str {
    match a {
        "shutdown" => "关机",
        "restart" => "重启",
        "sleep" => "睡眠",
        "hibernate" => "休眠",
        "lock" => "锁定",
        "wake" => "定时开机",
        _ => "未知",
    }
}

pub fn type_label(t: &str) -> &'static str {
    match t {
        "once" => "仅一次",
        "daily" => "每天",
        "weekly" => "每周",
        "weekday" => "工作日",
        "weekend" => "周末",
        _ => "未知",
    }
}

pub fn now_str() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn now_ts() -> i64 {
    Local::now().timestamp()
}

// ============ 数据模型 ============
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    pub action: String, // shutdown | restart | sleep | hibernate | lock | wake
    #[serde(rename = "type")]
    pub task_type: String, // once | daily | weekly | weekday | weekend
    pub time: String, // HH:mm
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>, // yyyy-MM-dd，仅一次时使用
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub days: Option<Vec<u8>>, // 1..=7（周一..周日），每周时使用
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub autostart: bool,
    pub minimize_to_tray: bool,
    pub password_enabled: bool,
    #[serde(default)]
    pub password_hash: String,
    #[serde(default)]
    pub password_salt: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            autostart: false,
            minimize_to_tray: true,
            password_enabled: false,
            password_hash: String::new(),
            password_salt: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub time: String,
    pub level: String, // info | success | warn | error
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Countdown {
    pub action: String,
    pub mode: String, // system | app
    pub ends_at: i64, // unix 秒
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub settings: Settings,
    #[serde(default)]
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub logs: Vec<LogEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub countdown: Option<Countdown>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PowerCaps {
    pub sleep_available: bool,
    pub hibernate_available: bool,
    pub raw: String,
}

// ============ 配置存储 ============
pub struct Store {
    pub dir: PathBuf,
}

impl Store {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn config_path(&self) -> PathBuf {
        self.dir.join("config.json")
    }

    pub fn helpers_dir(&self) -> PathBuf {
        self.dir.join("helpers")
    }

    pub fn load(&self) -> Config {
        match fs::read_to_string(self.config_path()) {
            Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
            Err(_) => Config::default(),
        }
    }

    pub fn save(&self, cfg: &Config) -> Result<(), String> {
        let _ = fs::create_dir_all(&self.dir);
        let tmp = self.dir.join("config.json.tmp");
        let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
        fs::write(&tmp, json).map_err(|e| format!("写入配置失败: {}", e))?;
        fs::rename(&tmp, self.config_path()).map_err(|e| format!("保存配置失败: {}", e))
    }

    pub fn add_log(&self, cfg: &mut Config, level: &str, msg: &str) {
        cfg.logs.insert(
            0,
            LogEntry {
                time: now_str(),
                level: level.to_string(),
                message: msg.to_string(),
            },
        );
        if cfg.logs.len() > MAX_LOGS {
            cfg.logs.truncate(MAX_LOGS);
        }
    }
}

// ============ 全局状态 ============
pub struct AppState {
    pub store: Store,
    pub config: std::sync::Mutex<Config>,
    pub is_admin: std::sync::Mutex<bool>,
}

impl AppState {
    pub fn new(store: Store, cfg: Config, is_admin: bool) -> Self {
        Self {
            store,
            config: std::sync::Mutex::new(cfg),
            is_admin: std::sync::Mutex::new(is_admin),
        }
    }
}

// ============ 密码哈希 ============
pub fn hash_password(pwd: &str, salt: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(pwd.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

pub fn new_salt() -> String {
    uuid::Uuid::new_v4().to_string()
}
