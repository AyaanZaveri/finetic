//! Independent demux/decode fallback for files without a usable sparse index.
//! It never seeks the playing mpv instance and does not retain JPEGs on disk.
use crate::mpv::{Event, Mpv};
use std::{collections::BTreeMap, path::{Path, PathBuf}, time::{Duration, Instant}};

pub(crate) struct Decoder {
    mpv: Mpv,
    loaded: bool,
    directory: PathBuf,
}

impl Decoder {
    pub(crate) fn new(library: &Path, headers: &BTreeMap<String, String>) -> Result<Self, String> {
        let options = [
            ("config", "no"), ("load-scripts", "no"), ("terminal", "no"),
            ("idle", "yes"), ("keep-open", "yes"), ("pause", "yes"),
            ("vo", "null"), ("ao", "null"), ("audio", "no"), ("sub", "no"),
            ("hwdec", "no"), ("demuxer", "lavf"), ("ytdl", "no"),
            ("access-references", "no"), ("load-unsafe-playlists", "no"),
            ("demuxer-lavf-o", "protocol_whitelist=%40%http,https,tcp,tls,crypto,data,httpproxy"),
            ("network-timeout", "4"), ("demuxer-max-bytes", "16MiB"),
            ("demuxer-max-back-bytes", "4MiB"), ("vf", "scale=448:-2"),
            ("screenshot-format", "jpg"), ("screenshot-jpeg-quality", "72"),
        ];
        let mpv = Mpv::new(library, &options)?;
        let fields = headers.iter().map(|(name, value)| {
            let field = format!("{name}: {value}");
            format!("%{}%{field}", field.len())
        }).collect::<Vec<_>>().join(",");
        mpv.set_property("http-header-fields", &fields)?;
        let mut token = [0_u8; 16];
        getrandom::getrandom(&mut token).map_err(|_| "preview temporary directory".to_string())?;
        let directory = std::env::temp_dir().join(format!("navigator-preview-{}", token.iter().map(|b| format!("{b:02x}")).collect::<String>()));
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&directory).map_err(|_| "preview temporary directory".to_string())?;
        Ok(Self { mpv, loaded: false, directory })
    }

    pub(crate) fn frame(&mut self, url: &str, at: u64, cancelled: impl Fn() -> bool) -> Option<Vec<u8>> {
        if cancelled() { return None; }
        let seconds = at as f64 / 1000.0;
        let mut started = self.loaded;
        let command = if self.loaded {
            self.mpv.command(&["seek", &seconds.to_string(), "absolute+exact"])
        } else {
            let options = format!("start=+{seconds},hr-seek=yes");
            self.mpv.command(&["loadfile", url, "replace", "-1", &options])
        };
        if command.is_err() { return None; }
        let until = Instant::now() + Duration::from_millis(4500);
        while Instant::now() < until && !cancelled() {
            match self.mpv.wait_event(0.05, |_| false) {
                Some(Event::StartFile { .. }) => started = true,
                Some(Event::PlaybackRestart) if started => {
                    self.loaded = true;
                    let path = self.directory.join("frame.jpg");
                    let _ = std::fs::remove_file(&path);
                    let result = self.mpv.command(&["screenshot-to-file", path.to_str()?, "video"]);
                    let bytes = if result.is_ok() { std::fs::read(&path).ok() } else { None };
                    let _ = std::fs::remove_file(&path);
                    return bytes.filter(|jpeg| jpeg.len() <= 16 << 20 && jpeg.starts_with(&[0xff, 0xd8, 0xff]));
                }
                Some(Event::EndFile { .. }) if started => break,
                Some(Event::Shutdown) => break,
                _ => {}
            }
        }
        let _ = self.mpv.command(&["stop"]);
        self.loaded = false;
        None
    }
}

impl Drop for Decoder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}
