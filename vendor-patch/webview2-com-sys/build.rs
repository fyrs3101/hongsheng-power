fn main() -> Result<()> {
    // 大先生本地补丁：主函数内使用 env::var 需要此导入
    #[allow(unused_imports)]
    use std::env;

    webview2_link::update_rustc_flags(webview2_link::output_libs(
        webview2_path::get_manifest_dir()?,
        webview2_path::get_out_dir()?,
    )?)?;

    println!("cargo:rustc-link-lib=advapi32");

    // ===== 大先生本地补丁 =====
    // 让 GNU 工具链（x86_64-pc-windows-gnu）也能静态链接 MSVC 编译的
    // WebView2LoaderStatic.lib，使打包出的 exe 无需随附 WebView2Loader.dll。
    // 仅对 Windows 目标生效。
    if env::var("CARGO_CFG_TARGET_OS")?.as_str() != "windows" {
        return Ok(());
    }

    println!("cargo:rerun-if-changed=wv2_compat.c");

    let out_dir = webview2_path::get_out_dir()?;
    let manifest_dir = webview2_path::get_manifest_dir()?;
    let target_env = env::var("CARGO_CFG_TARGET_ENV")?;

    let target_arch = match env::var("CARGO_CFG_TARGET_ARCH")?.as_str() {
        "x86_64" => "x64",
        "x86" => "x86",
        "arm" => "arm",
        "aarch64" => "arm64",
        "arm64ec" => "x64",
        other => unimplemented!("`{}` architecture set by `CARGO_CFG_TARGET_ARCH`", other),
    };

    let arch_dir = out_dir.join(target_arch);
    let msvc_static = arch_dir.join("WebView2LoaderStatic.lib");
    let gnu_static = arch_dir.join("libWebView2LoaderStatic.a");

    if target_env == "gnu" {
        // GNU ld 的 -l 查找规则要求 lib<name>.a 命名；
        // 直接复制 MSVC 静态库（bfd 可读取 COFF 归档）。
        if msvc_static.exists() && !gnu_static.exists() {
            eprintln!("[wv2-compat] create {:?}", gnu_static);
            fs::copy(&msvc_static, &gnu_static)?;
        }

        // 编译 MSVC CRT 缺失符号兼容层
        let cc = env::var("CC_x86_64_pc_windows_gnu")
            .or_else(|_| env::var("CC_x86_64_w64_mingw32"))
            .unwrap_or_else(|_| "x86_64-w64-mingw32-gcc".to_string());
        let compat_c = manifest_dir.join("wv2_compat.c");
        let compat_o = arch_dir.join("wv2_compat.o");
        eprintln!("[wv2-compat] compile {:?} with {}", compat_c, cc);
        let status = Command::new(&cc)
            .arg("-c")
            .arg("-O2")
            .arg("-fno-strict-aliasing")
            .arg("-o")
            .arg(&compat_o)
            .arg(&compat_c)
            .status()?;
        if !status.success() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "wv2_compat.c 编译失败",
            )
            .into());
        }
        // GNU as 不接受 ?/@ 符号名，用 objcopy 将 C 符号重命名为 MSVC 名称修饰
        let objcopy = "x86_64-w64-mingw32-objcopy";
        let status = Command::new(objcopy)
            .arg("--redefine-sym")
            .arg("wv2_new_nothrow=??2@YAPEAX_KAEBUnothrow_t@std@@@Z")
            .arg("--redefine-sym")
            .arg("wv2_delete_sized=??3@YAXPEAX_K@Z")
            .arg("--redefine-sym")
            .arg("wv2_nothrow_obj=?nothrow@std@@3Unothrow_t@1@B")
            .arg(&compat_o)
            .status()?;
        if !status.success() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "wv2_compat.o 符号重命名失败",
            )
            .into());
        }
        // 以 rustc-link-lib 传入兼容层静态库，随最终二进制链接，
        // 可解析 WebView2LoaderStatic.a 中未定义的 MSVC CRT 符号。
        let ar = "x86_64-w64-mingw32-ar";
        let compat_a = arch_dir.join("libwv2compat.a");
        let status = Command::new(ar)
            .arg("crs")
            .arg(&compat_a)
            .arg(&compat_o)
            .status()?;
        if !status.success() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Other,
                "libwv2compat.a 打包失败",
            )
            .into());
        }
        println!("cargo:rustc-link-search=native={}", arch_dir.display());
        println!("cargo:rustc-link-lib=static=wv2compat");
    }

    Ok(())
}

#[derive(Debug, Error)]
pub enum Error {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Var(#[from] std::env::VarError),
}

pub type Result<T> = std::result::Result<T, Error>;

#[macro_use]
extern crate thiserror;

use std::env;
use std::fs;
use std::process::Command;

mod webview2_path {
    use std::{convert::From, env, path::PathBuf};

    pub fn get_out_dir() -> super::Result<PathBuf> {
        Ok(PathBuf::from(env::var("OUT_DIR")?))
    }

    pub fn get_manifest_dir() -> super::Result<PathBuf> {
        Ok(PathBuf::from(env::var("CARGO_MANIFEST_DIR")?))
    }
}

mod webview2_link {
    use std::{env, path::PathBuf};

    pub fn output_libs(manifest_dir: PathBuf, out_dir: PathBuf) -> super::Result<PathBuf> {
        const WEBVIEW2_LIBS: &[&str] = &[
            "WebView2Loader.dll",
            "WebView2Loader.dll.lib",
            "WebView2LoaderStatic.lib",
        ];
        // 大先生本地调整：只复制当前编译目标架构的库文件。
        // 原版会遍历 arm64/x64/x86 三个目录，导致仓库里必须保留
        // 三份各 10MB 的静态库（源码包 31MB）；本项目仅发布 x64，
        // 因此按目标架构取单份即可，缺目录也不再报错。
        let only_target = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
            Ok("x86_64") | Ok("arm64ec") | Ok("x86_64h") => Some("x64"),
            Ok("i686") | Ok("i586") => Some("x86"),
            Ok("aarch64") => Some("arm64"),
            _ => None,
        };
        let targets: Vec<&str> = only_target.map(|t| vec![t]).unwrap_or_default();

        for target in targets {
            for lib in WEBVIEW2_LIBS {
                use std::fs;

                let mut lib_src = manifest_dir.clone();
                lib_src.push(target);
                lib_src.push(lib);

                let mut lib_dest = out_dir.clone();
                lib_dest.push(target);
                if !lib_dest.is_dir() {
                    fs::create_dir(lib_dest.as_path())?;
                }

                lib_dest.push(lib);
                eprintln!("Copy from {:?} -> {:?}", lib_src, lib_dest);
                fs::copy(lib_src.as_path(), lib_dest.as_path())?;
            }
        }

        Ok(out_dir)
    }

    pub fn update_rustc_flags(lib_path: PathBuf) -> super::Result<()> {
        let target_arch = match env::var("CARGO_CFG_TARGET_ARCH")?.as_str() {
            "x86_64" => "x64",
            "x86" => "x86",
            "arm" => "arm",
            "aarch64" => "arm64",
            // ARM64EC uses the x64 machine type for linking and ABI compatibility
            "arm64ec" => "x64",
            unimplemented => unimplemented!(
                "`{}` architecture set by `CARGO_CFG_TARGET_ARCH`",
                unimplemented
            ),
        };
        let mut lib_path = lib_path;
        lib_path.push(target_arch);

        match lib_path.to_str() {
            Some(path) if lib_path.exists() => println!("cargo:rustc-link-search=native={path}"),
            _ => unimplemented!("`{}` is not supported by WebView2", target_arch),
        };

        Ok(())
    }
}
