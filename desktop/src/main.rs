#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
#[cfg(target_os = "linux")]
mod gtk_shell;
#[cfg(any(target_os = "macos", test))]
mod hdr;
#[cfg(any(windows, test))]
mod glass;
mod mpv;
mod media_cache;
#[cfg(any(target_os = "macos", test))]
mod frame_schedule;
mod platform;
mod player;
mod protocol;
mod render;
mod server;
#[cfg(any(windows, test))]
mod startup_log;
#[cfg(target_os = "macos")]
mod tao_shell;
#[cfg(target_os = "macos")]
mod macos_updater;
mod thumbnails;
mod thumbnail_images;
#[cfg(any(windows, test))]
mod window_state;
#[cfg(windows)]
mod windows_install;
#[cfg(windows)]
mod windows_updater;
#[cfg(any(windows, target_os = "macos", test))]
mod update_feed;
#[cfg(any(windows, test))]
mod windows_hdr;
#[cfg(windows)]
mod windows_process;
#[cfg(windows)]
mod windows_shell;
#[cfg(windows)]
mod windows_glass;

use mpv::Mpv;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Arc;

struct App {
    url: String,
    origin: String,
    bridge: String,
    data: PathBuf,
    library: PathBuf,
    devtools: bool,
    _server: Option<server::Server>,
    _instance: std::fs::File,
    smoke: bool,
    #[cfg(windows)]
    backend: Option<(PathBuf, u16)>,
    #[cfg(windows)]
    started: std::time::Instant,
}

impl App {
    fn load() -> Result<Self, String> {
        #[cfg(windows)]
        let started = std::time::Instant::now();
        let mut args = std::env::args().skip(1);
        let mut url = None;
        let mut resources = None;
        let mut profile = None;
        let mut library = std::env::var_os("NAVIGATOR_LIBMPV").map(PathBuf::from);
        let mut port: u16 = 37371;
        let mut devtools = cfg!(debug_assertions);
        let mut smoke = false;
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--url" => url = Some(args.next().ok_or("--url needs a value")?),
                "--profile" => profile = Some(PathBuf::from(args.next().ok_or("--profile needs a path")?)),
                "--resources" => {
                    resources = Some(PathBuf::from(
                        args.next().ok_or("--resources needs a path")?,
                    ))
                }
                "--libmpv" => {
                    library = Some(PathBuf::from(args.next().ok_or("--libmpv needs a path")?))
                }
                "--port" => {
                    port = args
                        .next()
                        .ok_or("--port needs a value")?
                        .parse()
                        .map_err(|_| "Invalid port")?
                }
                "--devtools" => devtools = true,
                "--smoke-test" => smoke = true,
                "--help" | "-h" => {
                    println!(
                        "Navigator Desktop\n  --url http://localhost:3000  Use an existing Next server\n  --resources PATH           Packaged server/runtime/lib folder\n  --libmpv PATH              Override the native library\n  --port PORT                Packaged server port (default 37371)\n  --profile PATH             Separate profile for native QA\n  --devtools                 Enable web inspector\n  --smoke-test               Check compositing with generated color bars"
                    );
                    std::process::exit(0);
                }
                _ => return Err(format!("Unknown argument: {arg}")),
            }
        }
        if port == 0 {
            return Err("Use a stable nonzero port so sign-ins keep their origin".into());
        }
        let data = match profile {
            Some(path) => path,
            None => dirs::data_local_dir().ok_or("No local data directory")?.join("Navigator Desktop"),
        };
        #[cfg(windows)]
        let data = if smoke { data.join("smoke") } else { data };
        std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        let instance = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(data.join("instance.lock"))
            .map_err(|e| e.to_string())?;
        if let Err(error) = instance.try_lock() {
            #[cfg(windows)]
            if matches!(error, std::fs::TryLockError::WouldBlock)
                && platform::activate_existing(smoke)
            {
                std::process::exit(0);
            }
            return Err(format!(
                "Cannot open Navigator's profile (another copy may be running): {error}"
            ));
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let resources = resources.unwrap_or_else(|| {
            if cfg!(target_os = "macos") && exe.parent().is_some_and(|p| p.ends_with("MacOS")) {
                exe.parent().unwrap().parent().unwrap().join("Resources")
            } else {
                exe.parent().unwrap().join("resources")
            }
        });
        #[cfg(windows)]
        let mut backend = None;
        let (url, server) = if smoke {
            ("about:blank".into(), None)
        } else {
            match url {
                Some(url) => (url, None),
                None if cfg!(debug_assertions) => ("http://localhost:3000".into(), None),
                None => {
                    #[cfg(not(windows))]
                    let server = server::Server::start(&resources, port)?;
                    #[cfg(windows)]
                    let server = {
                        backend = Some((resources.clone(), port));
                        None
                    };
                    #[cfg(not(windows))]
                    {
                        (format!("http://127.0.0.1:{port}"), Some(server))
                    }
                    #[cfg(windows)]
                    {
                        (format!("http://127.0.0.1:{port}"), server)
                    }
                }
            }
        };
        if !smoke {
            let parsed = protocol::media_url(&url)?;
            if parsed.username() != "" || parsed.password().is_some() {
                return Err("App URLs cannot contain credentials".into());
            }
        }
        let origin = if smoke {
            "null".into()
        } else {
            protocol::origin(&url).ok_or("Invalid app origin")?
        };
        let platform = std::env::consts::OS;
        let bridge = include_str!("bridge.js")
            .replace("__PROTOCOL__", &protocol::PROTOCOL.to_string())
            .replace("__ORIGIN__", &json!(origin).to_string())
            .replace("__PLATFORM__", &json!(platform).to_string());
        let bundled = if cfg!(target_os = "macos") {
            "libmpv.2.dylib"
        } else if cfg!(windows) {
            "libmpv-2.dll"
        } else {
            "libmpv.so.2"
        };
        let library = library.unwrap_or_else(|| {
            let vendor = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("vendor")
                .join(format!(
                    "{}-{}",
                    std::env::consts::OS,
                    std::env::consts::ARCH
                ))
                .join(bundled);
            let mut candidates = vec![resources.join("lib").join(bundled), vendor];
            if cfg!(target_os = "macos") {
                candidates.extend([
                    "/opt/homebrew/lib/libmpv.2.dylib".into(),
                    "/usr/local/lib/libmpv.2.dylib".into(),
                    "/opt/local/lib/libmpv.2.dylib".into(),
                ]);
            }
            candidates
                .into_iter()
                .find(|p| p.is_file())
                .unwrap_or_else(|| bundled.into())
        });
        Ok(Self {
            url,
            origin,
            bridge,
            data,
            library,
            devtools,
            _server: server,
            _instance: instance,
            smoke,
            #[cfg(windows)]
            backend,
            #[cfg(windows)]
            started,
        })
    }

    #[cfg(not(windows))]
    fn start_player(
        &self,
        surface: &platform::VideoSurface,
        emit: impl Fn(Value) + Send + Sync + 'static,
    ) -> Result<player::Player, String> {
        self.start_player_options(platform::mpv_options(surface), emit, |gamma, primaries| {
            #[cfg(target_os = "macos")]
            platform::update_hdr(gamma, primaries);
            #[cfg(not(target_os = "macos"))]
            let _ = (gamma, primaries);
        })
    }

    fn start_player_options(
        &self,
        mut options: Vec<(&'static str, String)>,
        emit: impl Fn(Value) + Send + Sync + 'static,
        colour: impl Fn(Option<String>, Option<String>) + Send + 'static,
    ) -> Result<player::Player, String> {
        if self.smoke {
            options.push(("loop-file", "inf".into()));
        }
        options.extend(
            [
                ("config", "no"),
                ("load-scripts", "no"),
                ("idle", "yes"),
                ("keep-open", "no"),
                ("osc", "no"),
                ("osd-bar", "no"),
                ("ytdl", "no"),
                ("input-default-bindings", "no"),
                ("input-vo-keyboard", "no"),
                ("input-cursor", "no"),
                ("terminal", "no"),
                ("access-references", "no"),
                ("load-unsafe-playlists", "no"),
                ("demuxer", "lavf"),
                (
                    "demuxer-lavf-o",
                    if self.smoke {
                        "protocol_whitelist=%45%file,http,https,tcp,tls,crypto,data,httpproxy"
                    } else {
                        "protocol_whitelist=%40%http,https,tcp,tls,crypto,data,httpproxy"
                    },
                ),
                ("force-window", if cfg!(windows) { "yes" } else { "no" }),
            ]
            .into_iter()
            .map(|(k, v)| (k, v.to_string())),
        );
        let borrowed: Vec<_> = options.iter().map(|(k, v)| (*k, v.as_str())).collect();
        #[cfg(windows)]
        platform::prepare_library(&self.library);
        if let Some(directory) = self.library.parent() {
            aiostreams_thumbs::library_dirs(vec![directory.to_path_buf()]);
        }
        let mpv = Arc::new(Mpv::new(&self.library, &borrowed)?);
        // Any missing required playback boundary is fatal, rather than a logged option warning.
        for (name, value) in [("access-references", "no"), ("load-unsafe-playlists", "no")] {
            mpv.set_property(name, value)?;
        }
        player::Player::start(mpv, emit, colour)
    }
}

/// Native compositor check with a generated Y4M file; no server or external media.
fn smoke_file() -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("navigator-smoke-{}.y4m", std::process::id()));
    let mut bytes = b"YUV4MPEG2 W320 H180 F30:1 Ip A1:1 C420jpeg\n".to_vec();
    for frame in 0..60 {
        bytes.extend(b"FRAME\n");
        for _ in 0..180 {
            for x in 0..320 {
                bytes.push(32 + (((x / 40 + frame / 10) % 7) * 30) as u8);
            }
        }
        bytes.extend(vec![90; 320 * 180 / 4]);
        bytes.extend(vec![180; 320 * 180 / 4]);
    }
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

fn receive(message: &Value) -> String {
    format!("window.__navigatorDesktopReceive?.({message});")
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();
    #[cfg(windows)]
    if std::env::args().nth(1).as_deref() == Some("--prepare-install") {
        if let Err(message) = windows_install::prepare() {
            // The installer reports the failure. Never open a dialog during a
            // silent installation, create a WebView profile or take the app lock.
            eprintln!("Navigator installation: {message}");
            std::process::exit(1);
        }
        return;
    }
    let result = App::load().and_then(|app| {
        #[cfg(target_os = "macos")]
        {
            tao_shell::run(app)
        }
        #[cfg(windows)]
        {
            windows_shell::run(app)
        }
        #[cfg(target_os = "linux")]
        {
            gtk_shell::run(app)
        }
    });
    if let Err(message) = result {
        #[cfg(windows)]
        platform::show_error(&message);
        eprintln!("Navigator Desktop: {message}");
        std::process::exit(1);
    }
}
