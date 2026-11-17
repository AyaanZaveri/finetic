//! Background work runs in the bundled Node runtime, never in the local server.
use super::{Event, notify};
use std::{
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, atomic::{AtomicBool, Ordering}},
};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Clone)]
pub struct Background {
    directory: PathBuf,
    cache: PathBuf,
    busy: Arc<AtomicBool>,
    ready: Arc<AtomicBool>,
}
impl Background {
    pub fn new(directory: &Path) -> Option<Self> {
        if !directory.join("resources/background-update.cjs").is_file() { return None; }
        Some(Self {
            directory: directory.into(),
            cache: dirs::data_local_dir()?.join("Navigator Desktop/updates"),
            busy: Arc::new(AtomicBool::new(false)),
            ready: Arc::new(AtomicBool::new(false)),
        })
    }
    pub fn check(&self) {
        let apply = self.ready.load(Ordering::Acquire);
        self.run(apply);
    }
    pub fn probe(&self) -> bool { self.run(false) }
    fn run(&self, apply: bool) -> bool {
        if self.busy.swap(true, Ordering::AcqRel) { return false; }
        let this = self.clone();
        let busy = self.busy.clone();
        let result = std::thread::Builder::new().name("update-download".into()).spawn(move || {
            let result = (|| -> Result<(), String> {
                let (node, script) = if apply {
                    (this.cache.join("update-node.exe"), this.cache.join("background-update.cjs"))
                } else {
                    (this.directory.join("resources/runtime/node.exe"), this.directory.join("resources/background-update.cjs"))
                };
                let mut command = Command::new(node);
                command.arg(script).arg(if apply { "apply" } else { "prepare" })
                    .arg(&this.directory).arg(env!("CARGO_PKG_VERSION")).arg(&this.cache)
                    .env_remove("NODE_OPTIONS").env_remove("NODE_PATH")
                    // No console and no parent-owned job: installation must
                    // continue after the app and its server have stopped.
                    .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
                #[cfg(windows)]
                command.creation_flags(0x08000000 | 0x00000200);
                let mut child = command.spawn().map_err(|e| e.to_string())?;
                let stdout = child.stdout.take().ok_or("Updater pipe missing")?;
                for line in BufReader::new(stdout).lines() {
                    let line = line.map_err(|e| e.to_string())?;
                    if line.len() > 1024 { return Err("Invalid updater response".into()); }
                    let message: serde_json::Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
                    match message["state"].as_str() {
                        Some("downloading") => notify(Event::Downloading),
                        Some("ready") => { this.ready.store(true, Ordering::Release); notify(Event::Ready); }
                        Some("current") => { this.ready.store(false, Ordering::Release); notify(Event::ProbeCurrent); }
                        Some("installing") if apply => {
                            notify(Event::Shutdown);
                            return Ok(()); // Drop the handle, not the helper process.
                        }
                        Some("error") => return Err("Could not prepare the update".into()),
                        _ => return Err("Unknown updater response".into()),
                    }
                }
                if !child.wait().map_err(|e| e.to_string())?.success() { return Err("Update helper failed".into()); }
                Ok(())
            })();
            if let Err(error) = result { log::warn!("{error}"); notify(Event::Error); }
            this.busy.store(false, Ordering::Release);
        });
        if result.is_err() { busy.store(false, Ordering::Release); }
        result.is_ok()
    }
}
