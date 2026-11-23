//! Installation-only preparation. No window, profile lock, cookies or user data
//! is needed; ordinary launches never enter this path.
use crate::{mpv::Mpv, platform, startup_log, windows_process::Process};
use std::{
    io::Write,
    os::windows::process::CommandExt,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

pub fn prepare() -> Result<(), String> {
    let started = Instant::now();
    let data = dirs::data_local_dir().ok_or("No local application data directory")?.join("Navigator Desktop");
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let log = data.join("installation.jsonl");
    startup_log::record(&log, started, "preparation-started");
    let result = (|| {
        if std::env::args().count() != 2 { return Err("Unexpected installation preparation arguments".into()); }
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        let resources = executable.parent().ok_or("No installation directory")?.join("resources");
        let mut child = Process::prepare_install(&resources.join("runtime").join("node.exe"), &resources)?;
        let deadline = Instant::now() + Duration::from_secs(180);
        loop {
            match child.try_exit_code()? {
                Some(0) => break,
                Some(code) => return Err(format!("Startup file or local service verification failed (exit {code})")),
                None if Instant::now() >= deadline => return Err("Installation preparation timed out".into()),
                None => std::thread::sleep(Duration::from_millis(50)),
            }
        }
        // Closing the job also cleans any descendant left by a failed service.
        drop(child);
        startup_log::record(&log, started, "startup-files-and-service-verified");
        let library = resources.join("lib").join("libmpv-2.dll");
        platform::prepare_library(&library);
        let player = Mpv::new(&library, &[
            ("config", "no"), ("load-scripts", "no"), ("terminal", "no"),
            ("vo", "null"), ("ao", "null"), ("idle", "yes"),
        ])?;
        drop(player);
        startup_log::record(&log, started, "video-engine-verified");
        Ok(())
    })();
    startup_log::record(&log, started, if result.is_ok() { "preparation-complete" } else { "preparation-failed" });
    if let Err(message) = &result {
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(data.join("installation.log")) {
            let _ = writeln!(file, "{message}");
        }
    }
    result
}


pub fn materialize_delta() -> Result<(), String> {
    let mut args = std::env::args_os().skip(2);
    let base = PathBuf::from(args.next().ok_or("Missing delta base")?);
    let payload = PathBuf::from(args.next().ok_or("Missing delta payload")?);
    if args.next().is_some() { return Err("Unexpected delta arguments".into()); }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let stage = executable.parent().ok_or("Missing delta staging directory")?;
    let log = dirs::data_local_dir()
        .and_then(|path| std::fs::OpenOptions::new().create(true).append(true)
            .open(path.join("Navigator Desktop/installation.log")).ok())
        .map(Stdio::from)
        .unwrap_or_else(Stdio::null);
    let mut child = Command::new(base.join("resources/runtime/node.exe"))
        .arg(payload.join("delta.cjs"))
        .arg(&base)
        .arg(stage)
        .arg(payload.join("delta-manifest.json"))
        .current_dir(&payload)
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(log)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("Could not start delta worker: {error}"))?;
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) if status.success() => return Ok(()),
            Some(status) => return Err(format!("Delta worker failed: {status}")),
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Delta worker timed out".into());
            }
            None => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}
