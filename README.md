# 鸿升中学 · 智能电源管理

鸿升中学教务专用的 **Windows 电脑自动开关机管理工具**。定时计划由 Windows 任务计划程序（Task Scheduler）执行，关闭软件后依然生效。

- **开发者 / 版权**：鸿升中学（教务处） © 2025
- **版本**：v1.0.7
- **技术栈**：Tauri v2（Rust）+ 原生 HTML/CSS/JS 前端 + Windows 任务计划程序

## 功能

- 定时关机 / 重启 / 睡眠 / 休眠 / 锁定（每天 / 每周 / 工作日 / 周末 / 仅一次）
- 定时开机唤醒（Wake To Run，含 BIOS RTC 唤醒设置指引）
- 立即执行（5 秒安全确认）与倒计时执行（关机/重启由系统接管）
- 开机自启动、托盘驻留、管理密码保护、运行日志
- 管理员模式下以 SYSTEM 账户执行，未登录状态同样生效

## 目录结构

```
hongsheng-power/
├── frontend/            # 前端（Vite + 原生 JS）
│   ├── index.html
│   └── src/             # main.js / pages.js / styles.css / icons.js ...
├── src-tauri/           # Rust 后端（Tauri v2）
│   ├── src/             # main.rs / commands.rs / ps.rs / power.rs / config.rs
│   ├── icons/           # 应用与托盘图标
│   ├── capabilities/    # 窗口权限
│   └── tauri.conf.json
├── tools/               # 图标生成与说明书脚本
├── package.json
└── vite.config.js
```

## 开发与构建

环境要求：Node.js ≥ 18、Rust ≥ 1.77、mingw-w64（Linux 交叉编译）。

```bash
# 1. 安装依赖
npm install

# 2. 开发模式（需图形环境）
npm run tauri dev

# 3. 构建 Windows 版本
rustup target add x86_64-pc-windows-gnu
npm run tauri build -- --target x86_64-pc-windows-gnu --bundles nsis
```

产物位于 `src-tauri/target/x86_64-pc-windows-gnu/release/`：

- `鸿升智能电源管理.exe` — 免安装便携版
- `bundle/nsis/鸿升智能电源管理_1.0.7_x64-setup.exe` — 安装版

### 版本号位置

升级版本需同步修改四处（缺一处会导致界面显示与实际不符）：

| 文件 | 字段 |
|---|---|
| `package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `src-tauri/src/config.rs` | `APP_VERSION` |

### 打包失败排查

- `failed to bundle project: timeout: global` 或 TLS `peer closed connection`：
  NSIS 打包器需要从 GitHub 下载 `nsis_tauri_utils.dll`，网络不稳时会失败。
  exe 本身已编译完成，直接重新执行打包命令即可。
- Linux 上打包需安装：`apt install nsis libayatana-appindicator3-dev`。

## 实现说明

- 计划存储于 `%APPDATA%\cn.hongsheng.power\config.json`，系统任务名为 `HSPower_<id8>`
- 关机/重启/休眠调用 `shutdown.exe`，锁定调用 `rundll32 user32.dll,LockWorkStation`，睡眠通过 P/Invoke `SetSuspendState` 辅助脚本实现
- 唤醒计划使用 `New-ScheduledTaskSettingsSet -WakeToRun`
- 所有 PowerShell 调用通过 `-EncodedCommand`（UTF-16LE + Base64）传递，避免中文与引号问题

## WebView2 静态链接补丁（重要）

从 Linux 以 `x86_64-pc-windows-gnu` 交叉编译时，`webview2-com-sys` 默认只对 MSVC
目标静态链接 `WebView2LoaderStatic.lib`，GNU 工具链会退化为动态链接
`WebView2Loader.dll`，导致免安装版在未随附该 DLL 的电脑上报
「找不到 WebView2Loader.dll」错误。

本项目通过 `vendor-patch/webview2-com-sys` 本地补丁解决（见
`src-tauri/Cargo.toml` 的 `[patch.crates-io]`）：

1. `src/lib.rs`：GNU 目标同样静态链接 `WebView2LoaderStatic.lib`
2. `build.rs`：
   - 只复制**当前目标架构**的 WebView2 库（本项目仅 x64，故仓库内只保留
     `x64/`，源码包因此从 31MB 降到 11MB；如需其它架构请从
     `webview2-com-sys` 原 crate 拷回对应目录）
   - 将 MSVC `.lib` 复制为 GNU ld 可查找的 `libWebView2LoaderStatic.a`
     （bfd 可直接读取 COFF 归档）
   - 用 mingw gcc 编译 `wv2_compat.c`，提供 MSVC 编译产物缺失的 7 个 CRT
     内部符号（`__security_cookie`、`__security_check_cookie`、
     `_Init_thread_epoch/header/footer`、`std::operator new/delete`、`std::nothrow`），
     其中 C++ 符号经 `objcopy --redefine-sym` 重命名为 MSVC 名称修饰
   - 打包为 `libwv2compat.a` 并以 `rustc-link-lib=static=wv2compat` 链接
3. 验证方式：`x86_64-w64-mingw32-objdump -p hongsheng-power.exe | grep -i webview`
   应无输出（导入表中不再有 WebView2Loader.dll）

重新构建前请勿删除 `vendor-patch/` 目录。
