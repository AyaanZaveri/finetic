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
    pub fn probe(&self) -> bool {
        // Keep a staged update ready for the user's restart action. A scheduled
        // check must not take its worker slot while the Ready button is shown.
        self.ready.load(Ordering::Acquire) || self.run(false)
    }
    fn run(&self, apply: bool) -> bool {
        if self.busy.swap(true, Ordering::AcqRel) { return false; }
        let this = self.clone();
        let busy = self.busy.clone();
        let result = std::thread::Builder::new().name("update-download".into()).spawn(move || {
            let result = (|| -> Result<Event, String> {
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
                let child = command.spawn().map_err(|e| e.to_string())?;
                completion(child, apply)
            })();
            // Publish a terminal state only after the worker is available for
            // the next click. A Ready button must never lead to a busy no-op.
            let event = match result {
                Ok(event) => {
                    this.ready.store(matches!(event, Event::Ready), Ordering::Release);
                    event
                }
                Err(error) => {
                    log::warn!("{error}");
                    this.ready.store(false, Ordering::Release);
                    Event::Error
                }
            };
            this.busy.store(false, Ordering::Release);
            notify(event);
        });
        if result.is_err() { busy.store(false, Ordering::Release); }
        result.is_ok()
    }
}

// Read progress immediately, but hold a terminal result until the helper has
// exited successfully. Installing is a handoff: that helper must outlive us.
fn completion(mut child: std::process::Child, apply: bool) -> Result<Event, String> {
    let stdout = child.stdout.take().ok_or("Updater pipe missing")?;
    let mut terminal = None;
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.len() > 1024 { return Err("Invalid updater response".into()); }
        let message: serde_json::Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        match message["state"].as_str() {
            Some("downloading") => notify(Event::Downloading),
            Some("ready") => terminal = Some(Event::Ready),
            Some("current") => terminal = Some(Event::Current),
            Some("installing") if apply => return Ok(Event::Shutdown),
            Some("error") => return Err("Could not prepare the update".into()),
            _ => return Err("Unknown updater response".into()),
        }
    }
    if !child.wait().map_err(|e| e.to_string())?.success() { return Err("Update helper failed".into()); }
    terminal.ok_or("Updater returned no result".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(script: &str) -> std::process::Child {
        Command::new("node").arg("-e").arg(script).stdout(Stdio::piped()).spawn().unwrap()
    }
    #[test]
    fn background_ready_requires_successful_helper_exit() {
        let child = fixture(r#"console.log('{"state":"ready"}'); process.exit(1)"#);
        assert!(completion(child, false).is_err());
        let child = fixture(r#"console.log('{"state":"ready"}'); setTimeout(() => process.exit(0), 50)"#);
        assert!(matches!(completion(child, false), Ok(Event::Ready)));
    }
    #[test]
    fn manual_checks_receive_an_unguarded_current_result() {
        let child = fixture(r#"console.log('{"state":"current"}')"#);
        assert!(matches!(completion(child, false), Ok(Event::Current)));
    }
    #[test]
    fn scheduled_checks_leave_a_staged_update_available() {
        let background = Background {
            directory: PathBuf::new(), cache: PathBuf::new(),
            busy: Arc::new(AtomicBool::new(false)),
            ready: Arc::new(AtomicBool::new(true)),
        };
        assert!(background.probe());
        assert!(!background.busy.load(Ordering::Acquire));
        assert!(background.ready.load(Ordering::Acquire));
    }
}
