use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
#[cfg(not(windows))]
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// A packaged Next standalone server. Drop always reaps the owned process.
pub struct Server {
    #[cfg(not(windows))]
    child: Child,
    #[cfg(windows)]
    child: crate::windows_process::Process,
}
impl Server {
    #[cfg(target_os = "linux")]
    pub fn start(resources: &Path, port: u16) -> Result<Self, String> {
        Self::start_cancellable(resources, port, &AtomicBool::new(false))
    }
    pub fn start_cancellable(
        resources: &Path,
        port: u16,
        cancelled: &AtomicBool,
    ) -> Result<Self, String> {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Startup cancelled".into());
        }
        let address = SocketAddr::from(([127, 0, 0, 1], port));
        // Never attach a privileged bridge to an unrelated process on this port.
        let reservation = TcpListener::bind(address)
            .map_err(|e| format!("Desktop server port {port} is unavailable: {e}"))?;
        let node = resources
            .join("runtime")
            .join(if cfg!(windows) { "node.exe" } else { "node" });
        let directory = resources.join("server");
        if !node.is_file() || !directory.join("server.js").is_file() {
            return Err("Packaged Node runtime or Next standalone server is missing".into());
        }
        drop(reservation);
        #[cfg(windows)]
        let child = crate::windows_process::Process::spawn(&node, &directory, port)?;
        #[cfg(not(windows))]
        let child = Command::new(node)
            .arg("server.js")
            .current_dir(directory)
            .env("NODE_ENV", "production")
            .env("HOSTNAME", "127.0.0.1")
            .env("PORT", port.to_string())
            .env("NAVIGATOR_DESKTOP", "1")
            .spawn()
            .map_err(|e| format!("Could not start Next: {e}"))?;
        let mut server = Self { child };
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            if cancelled.load(Ordering::Relaxed) {
                return Err("Startup cancelled".into());
            }
            if let Some(status) = server.child.try_wait().map_err(|e| e.to_string())? {
                return Err(format!("Next exited during startup: {status}"));
            }
            if TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() {
                return Ok(server);
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        Err("Next did not start within 30 seconds".into())
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        #[cfg(windows)]
        self.child.stop();
        #[cfg(not(windows))]
        {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_does_not_start_or_attach_to_a_server() {
        let cancelled = AtomicBool::new(true);
        assert!(
            Server::start_cancellable(Path::new("missing"), 37371, &cancelled)
                .err()
                .unwrap()
                .contains("cancelled")
        );
    }
    #[test]
    fn occupied_port_is_never_reused() {
        let reservation = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = reservation.local_addr().unwrap().port();
        let error = Server::start_cancellable(Path::new("missing"), port, &AtomicBool::new(false))
            .err()
            .unwrap();
        assert!(error.contains("unavailable"));
    }
}
