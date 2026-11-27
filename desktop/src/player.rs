use crate::mpv::{Event, Kind, Mpv};
use crate::protocol::{Command, TrackKind};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const PROPERTIES: &[(&str, Kind)] = &[
    ("time-pos", Kind::Double),
    ("duration", Kind::Double),
    ("pause", Kind::Flag),
    ("volume", Kind::Double),
    ("mute", Kind::Flag),
    ("speed", Kind::Double),
    ("paused-for-cache", Kind::Flag),
    ("seeking", Kind::Flag),
    ("demuxer-cache-time", Kind::Double),
    ("demuxer-cache-state", Kind::Json),
    ("track-list", Kind::Json),
    ("chapter-list", Kind::Json),
    ("sub-text", Kind::String),
    ("video-params/w", Kind::Double),
    ("video-params/h", Kind::Double),
    ("video-params/gamma", Kind::String),
    ("video-params/primaries", Kind::String),
    ("frame-drop-count", Kind::Double),
    ("decoder-frame-drop-count", Kind::Double),
];

// Bitmap codecs have no `sub-text`: let mpv composite their original images.
// Text codecs keep using the shared React subtitle renderer.
fn bitmap_subtitles_selected(tracks: &Value) -> bool {
    tracks.as_array().is_some_and(|tracks| tracks.iter().any(|track| {
        track["type"] == "sub" && track["selected"] == true
            && matches!(track["codec"].as_str(), Some("hdmv_pgs_subtitle" | "dvd_subtitle" | "dvb_subtitle" | "xsub"))
    }))
}

fn sync_subtitle_visibility(mpv: &Mpv, delay: f64) -> Result<Value, String> {
    let tracks = mpv.get_property("track-list", Kind::Json).unwrap_or(json!([]));
    mpv.set_property("sub-visibility", if bitmap_subtitles_selected(&tracks) { "yes" } else { "no" })?;
    let applied_delay = if bitmap_subtitles_selected(&tracks) { 0.0 } else { delay };
    mpv.set_property("sub-delay", &applied_delay.to_string())?;
    Ok(tracks)
}

fn video_colour(mpv: &Mpv) -> (Option<String>, Option<String>) {
    let text = |name| {
        mpv.get_property(name, Kind::String)
            .and_then(|value| value.as_str().map(str::to_owned))
    };
    (text("video-params/gamma"), text("video-params/primaries"))
}

/// Every sender wakes the native event wait, including direct IPC/smoke senders.
#[derive(Clone)]
pub struct PlayerRequests {
    sender: mpsc::Sender<Command>,
    mpv: Arc<Mpv>,
}
impl PlayerRequests {
    pub fn send(&self, command: Command) -> Result<(), mpsc::SendError<Command>> {
        let result = self.sender.send(command);
        if result.is_ok() { self.mpv.wakeup(); }
        result
    }
}

fn event_wait(dirty: bool, elapsed: Duration, batch: usize) -> f64 {
    if batch == 32 { return 0.0; } // More queued commands may outlive a coalesced wakeup.
    if dirty {
        let remaining = Duration::from_millis(250).saturating_sub(elapsed);
        // Windows may truncate fractional milliseconds in the native wait.
        // Round up with one guard millisecond: native timers can return
        // just before the deadline. State delivery remains within 2 ms of it.
        if remaining.is_zero() { 0.0 } else { ((remaining.as_secs_f64() * 1000.0).ceil() + 1.0) / 1000.0 }
    }
    else { -1.0 } // mpv events, requests and shutdown explicitly wake this wait.
}

/// All blocking client calls run here, away from the render API's UI thread.
pub struct Player {
    pub mpv: Arc<Mpv>,
    requests: PlayerRequests,
    quit: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    #[cfg(test)]
    idle_wakes: Arc<std::sync::atomic::AtomicU64>,
    #[cfg(windows)]
    glass: crate::glass::Sampler,
}

impl Player {
    pub fn start(
        mpv: Arc<Mpv>,
        emit: impl Fn(Value) + Send + Sync + 'static,
        colour: impl Fn(Option<String>, Option<String>) + Send + 'static,
    ) -> Result<Self, String> {
        // Read once per player. Direct mode keeps the original URL and headers
        // for both mpv and the separate preview decoder, without a local relay.
        let source_setting = std::env::var("NAVIGATOR_PLAYBACK_SOURCE").ok();
        let source_mode = crate::media_cache::PlaybackSourceMode::from_setting(source_setting.as_deref());
        log::debug!("playback source mode: {source_mode:?}");
        // Text cues are drawn by React. Bitmap track selection enables native drawing.
        mpv.set_property("sub-visibility", "no")?;
        let emit = Arc::new(emit);
        for (id, (name, kind)) in PROPERTIES.iter().enumerate() {
            mpv.observe(name, *kind, id as u64)?;
        }
        mpv.request_log_messages("warn")?;
        let (sender, inbox) = mpsc::channel();
        let requests = PlayerRequests { sender, mpv: mpv.clone() };
        let quit = Arc::new(AtomicBool::new(false));
        #[cfg(windows)]
        let glass = crate::glass::Sampler::start(emit.clone(), quit.clone())?;
        #[cfg(windows)]
        let glass_control = glass.control.clone();
        let (client, stopped) = (mpv.clone(), quit.clone());
        #[cfg(test)]
        let idle_wakes = Arc::new(std::sync::atomic::AtomicU64::new(0));
        #[cfg(test)]
        let worker_idle_wakes = idle_wakes.clone();
        let worker = std::thread::Builder::new().name("navigator-mpv".into()).spawn(move || {
            let mut wake_lock = crate::wake_lock::WakeLock::default();
            let mut wake_file_open = false;
            let mut session = String::new();
            let mut desired = String::new();
            let mut subtitle_delay = 0.0;
            let mut audio_delay = 0.0;
            let mut entries = HashMap::<i64, String>::new();
            let mut playing_id = -1;
            let mut last_colour = (None, None);
            let mut previews: Option<crate::thumbnails::Previews> = None;
            let mut preview_source = None;
            let mut media_source: Option<crate::media_cache::MediaSource> = None;
            let mut retired_media = Vec::new();
            let mut direct_source: Option<(String, String, BTreeMap<String, String>, f64)> = None;
            let mut pending_preview = None;
            let mut load_started = None;
            let mut first_ready_logged = false;
            let mut state = json!({"position":0.0,"duration":0.0,"paused":true,"volume":1.0,"muted":false,"rate":1.0,"buffering":false,"seeking":false,"buffered":0.0,"bufferedRanges":[],"width":0,"height":0});
            let mut dirty = false;
            let mut last = Instant::now();
            while !stopped.load(Ordering::Relaxed) {
                let mut batch = 0;
                for command in inbox.try_iter().take(32) {
                    batch += 1;
                    let target = match &command {
                        Command::Load { session, .. } | Command::Play { session } | Command::Pause { session }
                        | Command::Seek { session, .. } | Command::Volume { session, .. } | Command::Muted { session, .. }
                        | Command::SubtitleDelay { session, .. } | Command::AudioDelay { session, .. } | Command::Rate { session, .. } | Command::Track { session, .. } | Command::Stop { session } | Command::Thumbnail { session, .. } | Command::VideoFit { session, .. } | Command::Glass { session, .. } => session,
                        Command::MediaMetadata { .. } | Command::UpdateStatus {} | Command::UpdateCheck { .. } | Command::UpdateAutomatic { .. } | Command::WindowControlsVisible { .. } | Command::Fullscreen { .. } | Command::WindowDrag { .. } | Command::WindowControl { .. } | Command::AppReady { .. } | Command::ClientStage { .. } | Command::GlassConsumed { .. } | Command::NativeHdrPeak { .. } | Command::NativeEngine { .. } => continue,
                    };
                    if !matches!(command, Command::Load { .. }) && target != &desired { continue; }
                    let target = target.clone();
                    let result = match command {
                        Command::Load { session: next, url, headers, start_position } => {
                            subtitle_delay = 0.0;
                            let _ = client.set_property("sub-delay", "0");
                            audio_delay = 0.0;
                            let _ = client.set_property("audio-delay", "0");
                            wake_file_open = false;
                            load_started = Some(Instant::now());
                            first_ready_logged = false;
                            log::debug!("playback load received");
                            desired = next.clone();
                            #[cfg(windows)]
                            glass_control.source(next.clone());
                            previews = None;
                            pending_preview = None;
                            // Each load gets a new random local source; credentials and bytes
                            // are never shared across titles/accounts or exposed to the page.
                            // Keep the previous reader alive until mpv has stopped that
                            // file; closing it before loadfile can truncate a packet.
                            if let Some(previous) = media_source.take() { retired_media.push(previous); }
                            media_source = crate::media_cache::MediaSource::for_playback(&url, &headers, source_mode);
                            let playback_url = media_source.as_ref().map_or_else(|| url.clone(), |source| source.playback_url());
                            let preview_url = media_source.as_ref().map_or_else(|| url.clone(), |source| source.preview_url());
                            let preview_headers = if media_source.is_some() { BTreeMap::new() } else { headers.clone() };
                            preview_source = Some((next.clone(), preview_url, preview_headers));
                            // mpv's %length% syntax quotes commas and arbitrary header values.
                            let fields = headers.iter().map(|(name, value)| {
                                let field = format!("{name}: {value}");
                                format!("%{}%{field}", field.len())
                            }).collect::<Vec<_>>().join(",");
                            // Per-file options are applied before the initial decode, not
                            // via a second seek after FILE_LOADED. The -1 index precedes
                            // options since mpv 0.38. `none` resets a fresh load without
                            // asking the demuxer for an unnecessary seek to zero.
                            let options = if start_position > 0.0 {
                                format!("start=+{start_position},hr-seek=yes")
                            } else {
                                "start=none".into()
                            };
                            direct_source = media_source.as_ref().map(|_| (url.clone(), fields.clone(), headers.clone(), start_position));
                            // Credentials/Origin belong on the upstream request, not the
                            // private loopback endpoint. The source already owns them.
                            let native_fields = if media_source.is_some() { "" } else { &fields };
                            let result = client.set_property("http-header-fields", native_fields)
                                .and_then(|_| client.set_property("pause", "no"))
                                .and_then(|_| client.set_property("sub-visibility", "no"))
                                .and_then(|_| client.set_property("sid", "no"))
                                .and_then(|_| client.command(&["loadfile", &playback_url, "replace", "-1", &options]));
                            if result.is_ok() {
                                if let Some(id) = client.get_property("playlist/0/id", Kind::Double).and_then(|v| v.as_f64()) {
                                    entries.insert(id as i64, next);
                                }
                            }
                            result
                        }
                        Command::Play { .. } => client.set_property("pause", "no"),
                        Command::Pause { .. } => client.set_property("pause", "yes"),
                        Command::Seek { position, .. } => client.command(&["seek", &position.to_string(), "absolute+exact"]),
                        Command::Volume { volume, .. } => client.set_property("volume", &(volume * 100.0).to_string()),
                        Command::Muted { muted, .. } => client.set_property("mute", if muted { "yes" } else { "no" }),
                        Command::Rate { rate, .. } => client.set_property("speed", &rate.to_string()),
                        Command::VideoFit { mode, .. } => {
                            use crate::protocol::VideoFitMode;
                            let result = client.set_property("keepaspect", if matches!(mode, VideoFitMode::Stretch) { "no" } else { "yes" })
                                .and_then(|_| client.set_property("panscan", if matches!(mode, VideoFitMode::Crop) { "1" } else { "0" }));
                            #[cfg(windows)]
                            glass_control.invalidate();
                            result
                        }
                        Command::Track { kind: TrackKind::Audio, id, .. } => client.set_property("aid", &id),
                        Command::Track { kind: TrackKind::Subtitle, id, .. } => client.set_property("sid", &id)
                            .and_then(|_| sync_subtitle_visibility(&client, subtitle_delay).map(|_| ())),
                        Command::Stop { .. } => {
                            wake_file_open = false;
                            #[cfg(windows)]
                            glass_control.source(String::new());
                            let result = client.command(&["stop"]);
                            desired.clear(); previews = None; preview_source = None; pending_preview = None;
                            if let Some(previous) = media_source.take() { retired_media.push(previous); }
                            direct_source = None; result },
                        Command::Glass { session, active } => {
                            #[cfg(windows)]
                            glass_control.demand(&session, active);
                            #[cfg(not(windows))]
                            let _ = (session, active);
                            Ok(())
                        }
                        Command::AudioDelay { seconds, .. } => {
                            audio_delay = seconds;
                            client.set_property("audio-delay", &audio_delay.to_string())
                        }
                        Command::SubtitleDelay { seconds, .. } => {
                            subtitle_delay = seconds;
                            sync_subtitle_visibility(&client, subtitle_delay).map(|_| ())
                        }
                        Command::Thumbnail { request, position, .. } => {
                            if let Some(previews) = &previews { previews.want(request, position); }
                            else { pending_preview = position.map(|at| (request, at)); }
                            Ok(())
                        },
                        Command::MediaMetadata { .. } | Command::UpdateStatus {} | Command::UpdateCheck { .. } | Command::UpdateAutomatic { .. } | Command::WindowControlsVisible { .. } | Command::Fullscreen { .. } | Command::WindowDrag { .. } | Command::WindowControl { .. } | Command::AppReady { .. } | Command::ClientStage { .. } | Command::GlassConsumed { .. } | Command::NativeHdrPeak { .. } | Command::NativeEngine { .. } => unreachable!(),
                    };
                    if let Err(message) = result { emit(json!({"type":"error","session":target,"message":message})); }
                }
                let awake = crate::wake_lock::playback_active(wake_file_open, !desired.is_empty() && session == desired, state["paused"].as_bool().unwrap_or(true));
                if let Err(message) = wake_lock.set_active(awake) { log::warn!("{message}"); }
                let wait = event_wait(dirty && !session.is_empty(), last.elapsed(), batch);
                let event = client.wait_event(wait, |id| PROPERTIES.get(id as usize).is_some_and(|(_, k)| *k == Kind::Json));
                #[cfg(test)]
                if event.is_none() { worker_idle_wakes.fetch_add(1, Ordering::Relaxed); }
                if matches!(&event, Some(Event::FileLoaded)) || matches!(&event, Some(Event::Property { name, .. }) if matches!(name.as_str(), "video-params/gamma" | "video-params/primaries")) {
                    // Read both together, including when a property becomes unavailable.
                    // Never synchronously query mpv from the main/render thread.
                    let now = video_colour(&client);
                    if now != last_colour {
                        last_colour = now.clone();
                        colour(now.0, now.1);
                    }
                }
                match event {
                    Some(Event::StartFile { playlist_id }) => {
                        playing_id = playlist_id;
                        session = entries.remove(&playlist_id).unwrap_or_default();
                        wake_file_open = session == desired;
                        if session == desired { retired_media.clear(); }
                        state["position"] = json!(0.0); state["duration"] = json!(0.0); state["buffered"] = json!(0.0);
                        state["bufferedRanges"] = json!([]);
                        emit(json!({"type":"subtitle","session":session,"text":""}));
                        emit(json!({"type":"chapters","session":session,"chapters":[]}));
                        emit(json!({"type":"loading","session":session}));
                    }
                    Some(Event::FileLoaded) => {
                        if session == desired {
                            let _ = client.set_property("audio-delay", &audio_delay.to_string());
                            if let Some(started) = load_started { log::debug!("playback metadata ready after {} ms", started.elapsed().as_millis()); }
                        }
                        // Publish the complete track snapshot before loadedmetadata so an
                        // external subtitle default cannot win a delayed embedded-track event.
                        if let Ok(tracks) = sync_subtitle_visibility(&client, subtitle_delay) {
                            emit(json!({"type":"tracks","session":session,"tracks":tracks}));
                        }
                        let chapters = client.get_property("chapter-list", Kind::Json).unwrap_or(json!([]));
                        emit(json!({"type":"chapters","session":session,"chapters":chapters}));
                        // Metadata must precede loadedmetadata: the React handler resumes here.
                        for (name, key, kind) in [("duration", "duration", Kind::Double), ("time-pos", "position", Kind::Double), ("video-params/w", "width", Kind::Double), ("video-params/h", "height", Kind::Double)] {
                            if let Some(value) = client.get_property(name, kind) { state[key] = value; }
                        }
                        emit(json!({"type":"state","session":session,"state":state}));
                        emit(json!({"type":"loaded","session":session}));
                    }
                    Some(Event::PlaybackRestart) => {
                        if session == desired && !first_ready_logged {
                            first_ready_logged = true;
                            if log::log_enabled!(log::Level::Debug) {
                                let hwdec = client.get_property("hwdec-current", Kind::String).unwrap_or(json!("unknown"));
                                let codec = client.get_property("video-codec", Kind::String).unwrap_or(json!("unknown"));
                                log::debug!("playback first-ready after {} ms; hwdec={hwdec}; codec={codec}", load_started.map_or(0, |started| started.elapsed().as_millis()));
                            }
                        }
                        #[cfg(windows)]
                        glass_control.invalidate();
                        state["seeking"] = json!(false);
                        emit(json!({"type":"state","session":session,"state":state}));
                        emit(json!({"type":"ready","session":session}));
                        // Indexing opens a second reader. Let the initial decoder finish
                        // before competing for network/CPU, and retain an early hover.
                        if session == desired {
                            if let Some((named, url, headers)) = preview_source.take() {
                                if named == session { previews = Some(crate::thumbnails::Previews::new(named, url, headers, emit.clone(), Some(client.library_path().to_path_buf()))); }
                            }
                            if let (Some(previews), Some((request, position))) = (&previews, pending_preview.take()) {
                                previews.want(request, Some(position));
                            }
                        }
                    }
                    Some(Event::Seek) => { state["seeking"] = json!(true); dirty = true; }
                    Some(Event::EndFile { playlist_id, reason, error }) => {
                        if playlist_id != playing_id { entries.remove(&playlist_id); continue; }
                        wake_file_open = false;
                        if desired.is_empty() { retired_media.clear(); }
                        // A provider/TLS/proxy incompatibility must not prevent playback.
                        // Retry once on the original source, retaining resume and pause.
                        if reason == "error" && session == desired && media_source.is_some() {
                            media_source = None;
                            if let Some((url, fields, headers, initial)) = direct_source.take() {
                                previews = None;
                                preview_source = Some((session.clone(), url.clone(), headers));
                                let at = state["position"].as_f64().filter(|at| at.is_finite() && *at > 0.0).unwrap_or(initial);
                                let options = if at > 0.0 { format!("start=+{at},hr-seek=yes") } else { "start=none".into() };
                                if client.set_property("http-header-fields", &fields).and_then(|_| client.command(&["loadfile", &url, "replace", "-1", &options])).is_ok() {
                                    if let Some(id) = client.get_property("playlist/0/id", Kind::Double).and_then(|v| v.as_f64()) { entries.insert(id as i64, session.clone()); }
                                    continue;
                                }
                            }
                        }
                        if session == desired { media_source = None; direct_source = None; }
                        #[cfg(windows)]
                        glass_control.demand(&session, false);
                        if previews.as_ref().is_some_and(|p| p.session() == session) { previews = None; }
                        if preview_source.as_ref().is_some_and(|(named, _, _)| named == &session) { preview_source = None; }
                        pending_preview = None;
                        last_colour = (None, None);
                        colour(None, None);
                        emit(json!({"type":"subtitle","session":session,"text":""}));
                        if let Some(message) = error { emit(json!({"type":"error","session":session,"message":message})); }
                        else if reason == "eof" { emit(json!({"type":"ended","session":session})); }
                    }
                    Some(Event::Property { name, value, .. }) if name == "chapter-list" => {
                        emit(json!({"type":"chapters","session":session,"chapters":if value.is_array() { value } else { json!([]) }}));
                    }
                    Some(Event::Property { name, value, .. }) if name == "demuxer-cache-state" => {
                        state["bufferedRanges"] = value.get("seekable-ranges").filter(|ranges| ranges.is_array()).cloned().unwrap_or(json!([]));
                        dirty = true;
                    }
                    Some(Event::Property { name, value, .. }) if name == "sub-text" => {
                        // An unavailable property also clears the previous cue.
                        emit(json!({"type":"subtitle","session":session,"text":value.as_str().unwrap_or("")}));
                    }
                    Some(Event::Property { name, value, .. }) if !value.is_null() => {
                        if name == "track-list" {
                            // Query current selection: queued observations can predate Off
                            // or a newer selection and must not re-enable a bitmap overlay.
                            if let Ok(tracks) = sync_subtitle_visibility(&client, subtitle_delay) {
                                emit(json!({"type":"tracks","session":session,"tracks":tracks}));
                            }
                            continue;
                        }
                        let key = match name.as_str() {
                            "time-pos" => "position", "duration" => "duration", "pause" => "paused", "volume" => "volume",
                            "mute" => "muted", "speed" => "rate", "paused-for-cache" => "buffering", "seeking" => "seeking",
                            "demuxer-cache-time" => "buffered", "video-params/w" => "width", "video-params/h" => "height",
                            "frame-drop-count" => "droppedFrames", "decoder-frame-drop-count" => "decoderDroppedFrames", _ => continue,
                        };
                        state[key] = if key == "volume" { json!(value.as_f64().unwrap_or(100.0) / 100.0) } else { value };
                        #[cfg(windows)]
                        if matches!(key,"width"|"height") {glass_control.invalidate();}
                        dirty = true;
                        if matches!(key, "paused" | "volume" | "muted" | "rate" | "buffering" | "seeking") && !session.is_empty() {
                            emit(json!({"type":"state","session":session,"state":state}));
                            last = Instant::now(); dirty = false;
                        }
                        if !matches!(key, "position" | "buffered") { last = Instant::now() - Duration::from_secs(1); }
                    }
                    Some(Event::Log { prefix, text, .. }) => log::warn!("mpv {prefix}: {}", text.trim()),
                    Some(Event::Shutdown) => break,
                    _ => {}
                }
                if dirty && last.elapsed() >= Duration::from_millis(250) && !session.is_empty() {
                    emit(json!({"type":"state","session":session,"state":state}));
                    last = Instant::now(); dirty = false;
                }
            }
            // The UI must keep pumping while mpv finishes a render-dependent stop.
            drop(wake_lock);
            let _ = client.command(&["stop"]);
            colour(None, None);
        }).map_err(|e| e.to_string())?;
        Ok(Self {
            mpv,
            requests,
            quit,
            worker: Some(worker),
            #[cfg(test)]
            idle_wakes,
            #[cfg(windows)]
            glass,
        })
    }

    pub fn send(&self, command: Command) {
        let _ = self.requests.send(command);
    }
    pub fn sender(&self) -> PlayerRequests {
        self.requests.clone()
    }
    pub fn begin_shutdown(&self) {
        self.quit.store(true, Ordering::Relaxed);
        #[cfg(windows)]
        self.glass.wake();
        self.mpv.wakeup();
    }
    #[cfg(windows)]
    pub fn glass_control(&self) -> crate::glass::Control { self.glass.control.clone() }
    #[cfg(windows)]
    pub fn glass_visible(&self, visible: bool) { self.glass.control.visible(visible); }
    #[cfg(windows)]
    pub fn glass_resized(&self) { self.glass.control.invalidate(); }
    pub fn finished(&self) -> bool {
        #[cfg(windows)]
        if !self.glass.finished() { return false; }
        self.worker.as_ref().is_none_or(|w| w.is_finished())
    }
    pub fn join(&mut self) {
        #[cfg(windows)]
        self.glass.join();
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
    }
}

#[cfg(test)]
#[path = "track_switch_probe.rs"]
mod track_switch_probe;

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn event_wait_preserves_flush_and_burst_deadlines() {
        assert_eq!(event_wait(false, Duration::ZERO, 0), -1.0);
        assert_eq!(event_wait(true, Duration::from_millis(50), 0), 0.201);
        assert_eq!(event_wait(true, Duration::from_secs(1), 0), 0.0);
        assert_eq!(event_wait(true, Duration::from_micros(249_900), 0), 0.002);
        assert_eq!(event_wait(false, Duration::ZERO, 32), 0.0);
    }

    #[test]
    #[ignore = "requires the pinned NAVIGATOR_TEST_LIBMPV library"]
    fn audio_delay_libmpv_property() {
        let library = std::path::absolute(std::env::var("NAVIGATOR_TEST_LIBMPV").unwrap()).unwrap();
        assert!(library.is_file(), "Missing pinned library: {}", library.display());
        #[cfg(windows)]
        crate::platform::prepare_library(&library);
        let mpv = Mpv::new(&library, &[
            ("config", "no"), ("vo", "null"), ("ao", "null"), ("idle", "yes"), ("terminal", "no"),
        ]).unwrap();
        for seconds in [-30.0_f64, -0.3, 0.0, 0.3, 30.0, 0.0] {
            mpv.set_property("audio-delay", &seconds.to_string()).unwrap();
            let actual = mpv.get_property("audio-delay", Kind::Double).unwrap().as_f64().unwrap();
            assert!((actual - seconds).abs() < 1e-6);
        }
    }

    #[test]
    #[ignore = "requires the pinned libmpv and bundled A/V fixture"]
    fn audio_delay_loaded_session_commands() {
        let library = std::path::absolute(std::env::var("NAVIGATOR_TEST_LIBMPV").unwrap()).unwrap();
        #[cfg(windows)]
        crate::platform::prepare_library(&library);
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../public/images/subtitle-timing-demo.mp4");
        assert!(fixture.is_file());
        let mpv = Arc::new(Mpv::new(&library, &[
            ("config", "no"), ("vo", "null"), ("ao", "null"), ("idle", "yes"), ("terminal", "no"),
        ]).unwrap());
        let (send, inbox) = mpsc::channel();
        let mut player = Player::start(mpv.clone(), move |value| { let _ = send.send(value); }, |_, _| {}).unwrap();
        let load = |session: &str| Command::Load {
            session: session.into(), url: fixture.to_string_lossy().into_owned(),
            headers: BTreeMap::new(), start_position: 0.0,
        };
        let property = |name, wanted: f64| {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                let actual = mpv.get_property(name, Kind::Double).and_then(|value| value.as_f64());
                if actual.is_some_and(|value| (value - wanted).abs() < 1e-6) { return; }
                assert!(Instant::now() < deadline, "Expected {name}={wanted}, got {actual:?}");
                std::thread::sleep(Duration::from_millis(10));
            }
        };
        player.send(load("first"));
        wait_for(&inbox, |v| v["type"] == "loaded" && v["session"] == "first");
        wait_for(&inbox, |v| v["type"] == "ready" && v["session"] == "first");
        let tracks = mpv.get_property("track-list", Kind::Json).unwrap();
        for kind in ["audio", "video"] {
            assert!(tracks.as_array().unwrap().iter().any(|t| t["type"] == kind && t["selected"] == true), "Missing active {kind} track");
        }
        wait_for(&inbox, |v| v["type"] == "state" && v["session"] == "first" && v["state"]["position"].as_f64().is_some_and(|position| position > 0.1));
        for seconds in [0.3_f64, -0.4, 0.0, 0.7] {
            player.send(crate::protocol::parse(&format!(r#"{{"type":"audio-delay","session":"first","seconds":{seconds}}}"#)).unwrap());
            property("audio-delay", seconds);
        }
        player.send(Command::AudioDelay { session: "stale".into(), seconds: -5.0 });
        player.send(Command::Volume { session: "first".into(), volume: 0.427 });
        property("volume", 42.7);
        property("audio-delay", 0.7);
        player.send(load("second"));
        wait_for(&inbox, |v| v["type"] == "loaded" && v["session"] == "second");
        property("audio-delay", 0.0);
        player.begin_shutdown(); player.join();
        println!("Actual native command dispatch, positive/negative adjustment, reset, stale-session rejection, and replacement reset passed with an A/V file loaded.");
    }

    fn wait_for(inbox: &mpsc::Receiver<Value>, predicate: impl Fn(&Value) -> bool) -> Value {
        let until = Instant::now() + Duration::from_secs(8);
        while Instant::now() < until {
            if let Ok(value) = inbox.recv_timeout(Duration::from_millis(100)) {
                if predicate(&value) {
                    return value;
                }
            }
        }
        panic!("Timed out waiting for an actual libmpv playback event");
    }

    #[test]
    #[ignore = "set NAVIGATOR_TEST_LIBMPV and run with --include-ignored"]
    fn headless_library_playback_and_session_replacement() {
        let library =
            std::env::var("NAVIGATOR_TEST_LIBMPV").expect("Provide an actual libmpv path");
        let file = std::env::temp_dir().join(format!("navigator-mpv-{}.wav", std::process::id()));
        // Four seconds of 8 kHz mono PCM: no network, browser, or additional server.
        let length: u32 = 4 * 8000 * 2;
        let mut wave = Vec::new();
        wave.extend(b"RIFF");
        wave.extend((36 + length).to_le_bytes());
        wave.extend(b"WAVEfmt ");
        wave.extend(16u32.to_le_bytes());
        wave.extend(1u16.to_le_bytes());
        wave.extend(1u16.to_le_bytes());
        wave.extend(8000u32.to_le_bytes());
        wave.extend(16000u32.to_le_bytes());
        wave.extend(2u16.to_le_bytes());
        wave.extend(16u16.to_le_bytes());
        wave.extend(b"data");
        wave.extend(length.to_le_bytes());
        wave.resize(44 + length as usize, 0);
        std::fs::write(&file, wave).unwrap();
        let mpv = Arc::new(
            Mpv::new(
                std::path::Path::new(&library),
                &[
                    ("config", "no"),
                    ("vo", "null"),
                    ("ao", "null"),
                    ("idle", "yes"),
                    ("terminal", "no"),
                ],
            )
            .unwrap(),
        );
        let (send, inbox) = mpsc::channel();
        let mut player = Player::start(
            mpv,
            move |value| {
                let _ = send.send(value);
            },
            |_, _| {},
        )
        .unwrap();
        let load = |session: &str, start_position: f64| Command::Load {
            session: session.into(),
            url: file.to_string_lossy().into_owned(),
            headers: BTreeMap::new(),
            start_position,
        };
        player.send(load("first", 2.0));
        wait_for(&inbox, |v| v["type"] == "loaded" && v["session"] == "first");
        let ready_position = std::cell::Cell::new(0.0);
        wait_for(&inbox, |v| {
            if v["type"] == "state" && v["session"] == "first" {
                ready_position.set(v["state"]["position"].as_f64().unwrap_or(0.0));
            }
            v["type"] == "ready" && v["session"] == "first"
        });
        assert!((1.99..2.2).contains(&ready_position.get()), "First ready must already be at the resume position, got {}", ready_position.get());
        player.send(Command::Pause {
            session: "first".into(),
        });
        let paused = wait_for(&inbox, |v| {
            v["type"] == "state" && v["session"] == "first" && v["state"]["paused"] == true
        });
        assert!(paused["state"]["duration"].as_f64().unwrap() > 3.9);
        player.send(Command::Seek {
            session: "first".into(),
            position: 1.0,
        });
        wait_for(&inbox, |v| {
            v["type"] == "state" && (v["state"]["position"].as_f64().unwrap_or(0.0) - 1.0).abs() < 0.1
        });
        // The position observation can precede the pending 250 ms state flush.
        // Require quiescence first; a continuously polling worker still fails.
        let settle_deadline = Instant::now() + Duration::from_secs(3);
        let mut quiet_since = Instant::now();
        let mut observed = player.idle_wakes.load(Ordering::Relaxed);
        let settling_started = observed;
        while quiet_since.elapsed() < Duration::from_millis(300) {
            std::thread::sleep(Duration::from_millis(20));
            let now = player.idle_wakes.load(Ordering::Relaxed);
            if now != observed { observed = now; quiet_since = Instant::now(); }
            assert!(Instant::now() < settle_deadline, "Paused worker never became idle after seek");
        }
        println!("Post-seek settling wakeups: {}", observed - settling_started);
        let before = player.idle_wakes.load(Ordering::Relaxed);
        std::thread::sleep(Duration::from_millis(220));
        let idle_wakes = player.idle_wakes.load(Ordering::Relaxed) - before;
        println!("Paused event-loop wakeups over 220 ms: {idle_wakes}");
        assert!(idle_wakes <= 1, "Paused worker woke {idle_wakes} times without an event or command");
        // Both loads can reach mpv before either START_FILE is drained.
        player.send(load("second", 1.5));
        player.send(load("third", 0.0));
        wait_for(&inbox, |v| v["type"] == "loaded" && v["session"] == "third");
        wait_for(&inbox, |v| {
            if v["type"] == "state" && v["session"] == "third" {
                ready_position.set(v["state"]["position"].as_f64().unwrap_or(0.0));
            }
            v["type"] == "ready" && v["session"] == "third"
        });
        assert!(ready_position.get() < 0.5, "A zero-start replacement must not inherit the previous file's start option");
        let requests = player.sender();
        for step in 0..80 {
            requests.send(Command::Volume { session: "third".into(), volume: step as f64 / 100.0 }).unwrap();
        }
        requests.send(Command::Volume {
            session: "third".into(),
            volume: 0.427,
        }).unwrap();
        wait_for(&inbox, |v| {
            v["type"] == "state"
                && v["session"] == "third"
                && (v["state"]["volume"].as_f64().unwrap_or(0.0) - 0.427).abs() < 0.001
        });
        player.send(Command::Stop {
            session: "third".into(),
        });
        player.begin_shutdown();
        player.join();
        std::fs::remove_file(file).unwrap();
    }

    #[test]
    #[ignore = "set NAVIGATOR_TEST_LIBMPV and NAVIGATOR_TEST_VIDEO to a seekable video"]
    fn headless_preview_waits_for_playback_and_preserves_position() {
        let library = std::path::PathBuf::from(std::env::var("NAVIGATOR_TEST_LIBMPV").unwrap());
        aiostreams_thumbs::library_dirs(vec![library.parent().unwrap().to_path_buf()]);
        let mpv = Arc::new(Mpv::new(&library, &[("config", "no"), ("vo", "null"), ("ao", "null"), ("idle", "yes"), ("terminal", "no")]).unwrap());
        let (send, inbox) = mpsc::channel();
        let mut player = Player::start(mpv.clone(), move |value| { let _ = send.send(value); }, |_, _| {}).unwrap();
        player.send(Command::Load { session: "preview".into(), url: std::env::var("NAVIGATOR_TEST_VIDEO").unwrap(), headers: BTreeMap::new(), start_position: 3.2 });
        player.send(Command::Pause { session: "preview".into() });
        player.send(Command::Thumbnail { session: "preview".into(), request: 1, position: Some(0.5) });
        let ready = std::cell::Cell::new(false);
        let first = wait_for(&inbox, |v| {
            if v["type"] == "ready" { ready.set(true); }
            if v["type"] == "thumbnail" { assert!(ready.get(), "Indexing must not precede the first ready frame"); }
            v["type"] == "thumbnail" && v["request"] == 1
        });
        assert!(first["src"].as_str().is_some_and(|src| src.starts_with("http://127.0.0.1:") || src.starts_with("data:image/jpeg;base64,")));
        assert_eq!(first["range"]["start"], first["position"]);
        assert!(first["range"]["end"].as_f64().unwrap() > 0.5);
        player.send(Command::Thumbnail { session: "preview".into(), request: 2, position: Some(0.7) });
        let cached = wait_for(&inbox, |v| v["type"] == "thumbnail" && v["request"] == 2);
        assert_eq!(cached["src"], first["src"]);
        assert!(mpv.get_property("time-pos", Kind::Double).unwrap().as_f64().unwrap() >= 3.19, "Preview decoding cannot seek the playing decoder");
        player.begin_shutdown();
        player.join();
    }

    #[test]
    #[ignore = "set NAVIGATOR_TEST_LIBMPV and NAVIGATOR_TEST_VIDEO to the benchmark HTTP fixture"]
    fn headless_thumbnail_speed_comparison() {
        use base64::Engine as _;
        let library = std::path::absolute(std::env::var("NAVIGATOR_TEST_LIBMPV").unwrap()).unwrap();
        aiostreams_thumbs::library_dirs(vec![library.parent().unwrap().to_path_buf()]);
        let mpv = Arc::new(Mpv::new(&library, &[("config", "no"), ("vo", "null"), ("ao", "null"), ("idle", "yes"), ("terminal", "no")]).unwrap());
        let (send, inbox) = mpsc::channel();
        let mut player = Player::start(mpv.clone(), move |value| { let _ = send.send(value); }, |_, _| {}).unwrap();
        player.send(Command::Load { session: "benchmark".into(), url: std::env::var("NAVIGATOR_TEST_VIDEO").unwrap(), headers: BTreeMap::new(), start_position: 2.0 });
        wait_for(&inbox, |v| v["type"] == "ready" && v["session"] == "benchmark");
        std::thread::sleep(Duration::from_secs(4));
        player.send(Command::Pause { session: "benchmark".into() });
        wait_for(&inbox, |v| v["type"] == "state" && v["state"]["paused"] == true);
        let clock = mpv.get_property("time-pos", Kind::Double).unwrap().as_f64().unwrap();
        // Same targets and order as the Aether Swift bridge benchmark.
        let targets = [("first-distant", 147.0), ("distant", 121.0), ("resident", 8.0), ("resident", 12.0), ("resident", 16.0), ("resident", 20.0), ("distant", 83.0), ("distant", 103.0), ("distant", 129.0), ("distant", 155.0), ("distant", 167.0)];
        for (index, (group, target)) in targets.into_iter().chain(targets.into_iter().map(|(_, target)| ("revisit", target))).enumerate() {
            let request = index as u64 + 1;
            let started = Instant::now();
            player.send(Command::Thumbnail { session: "benchmark".into(), request, position: Some(target) });
            let reply = wait_for(&inbox, |v| v["type"] == "thumbnail" && v["request"] == request);
            let src = reply["src"].as_str().expect("Preview must contain a JPEG");
            let bytes = if let Some(data) = src.strip_prefix("data:image/jpeg;base64,") {
                base64::engine::general_purpose::STANDARD.decode(data).unwrap()
            } else {
                ureq::get(src).call().unwrap().body_mut().read_to_vec().unwrap()
            };
            let elapsed = started.elapsed().as_secs_f64() * 1000.0;
            assert!(bytes.starts_with(&[0xff, 0xd8, 0xff]));
            println!("THUMBNAIL_BENCHMARK {}", json!({"engine":"libmpv", "group":group, "target":target, "ms":elapsed, "bytes":bytes.len(), "actual":reply["position"], "path":"indexed-keyframe"}));
        }
        assert!((mpv.get_property("time-pos", Kind::Double).unwrap().as_f64().unwrap() - clock).abs() < 0.5);
        player.begin_shutdown();
        player.join();
    }

    #[test]
    #[ignore = "generated synthetic MKV fixtures and pinned libmpv required"]
    fn headless_webdl_preview_formats() {
        use base64::Engine as _;
        use aiostreams_thumbs::{Source, Settings};
        use aiostreams_container::Options;
        let _ = env_logger::try_init();
        let library = std::path::PathBuf::from(std::env::var("NAVIGATOR_TEST_LIBMPV").unwrap());
        aiostreams_thumbs::library_dirs(vec![library.parent().unwrap().to_path_buf()]);
        let directory = std::path::PathBuf::from(std::env::var("NAVIGATOR_TEST_PREVIEW_DIR").unwrap());
        let selected = std::env::var("NAVIGATOR_TEST_PREVIEW_FILE").ok();
        let mut failures = Vec::new();
        for filename in ["avc-stereo.mkv", "avc-surround-open-gop.mkv", "avc-front-cues.mkv", "hevc-control.mkv", "avc-no-cues.mkv", "avc-bad-cue-offsets.mkv", "avc-long-webdl.mkv"] {
            if selected.as_deref().is_some_and(|name| name != filename) { continue; }
            let long = filename == "avc-long-webdl.mkv";
            if long && selected.is_none() { continue; }
            let fixture = directory.join(filename);
            println!("FORMAT {filename}: {} bytes", std::fs::metadata(&fixture).unwrap().len());
            // Production loads libmpv before opening the sparse decoder.
            // Keep it alive across both diagnostic and real playback reads.
            let mpv = Arc::new(Mpv::new(&library, &[("config", "no"), ("vo", "null"), ("ao", "null"), ("idle", "yes"), ("terminal", "no")]).unwrap());
            // Isolate the container parser and standalone keyframe decoder
            // from the native HTTP relay and video playback.
            match Source::open(fixture.to_str().unwrap(), Options::default()) {
                Ok(mut source) => {
                    println!("INDEX {filename}: {} entries", source.keyframes().entries.len());
                    let mut renderer = source.renderer(Settings { width: 448, quality: 72, ..Settings::default() });
                    let mut packet_errors = 0;
                    for second in [5_u64, 11, 18, 25] {
                        let index = source.keyframes().at(second * 1000);
                        let at = source.keyframes().entries[index].time_ms;
                        match source.packet(index).and_then(|packet| renderer.render(&packet)) {
                            Ok(jpeg) => println!("PACKET {filename} target={second} keyframe={at} jpeg={}", jpeg.len()),
                            Err(error) => { packet_errors += 1; println!("PACKET_ERROR {filename} target={second} keyframe={at}: {error}"); }
                        }
                    }
                    if filename == "avc-bad-cue-offsets.mkv" {
                        assert!(packet_errors > 0, "Damaged cue fixture must reproduce the sparse packet failure");
                    }
                }
                Err(error) => {
                    println!("INDEX_ERROR {filename}: {error}");
                    assert_ne!(filename, "avc-bad-cue-offsets.mkv", "The packet failure fixture must open its index successfully");
                }
            }
            // Use the actual Player, including its internal byte relay,
            // readiness gate, preview workers, and published JPEG delivery.
            let origin = (!long).then(|| crate::media_cache::tests::Origin::new(std::fs::read(&fixture).unwrap()));
            let url = origin.as_ref().map(|origin| origin.url.replace("/video.mp4", "/video.mkv"))
                .unwrap_or_else(|| std::env::var("NAVIGATOR_TEST_LONG_PREVIEW_URL").unwrap());
            let (send, inbox) = mpsc::channel();
            let mut player = Player::start(mpv.clone(), move |value| { let _ = send.send(value); }, |_, _| {}).unwrap();
            player.send(Command::Load { session: "webdl-preview".into(), url, headers: BTreeMap::new(), start_position: 0.0 });
            wait_for(&inbox, |v| v["type"] == "ready" && v["session"] == "webdl-preview");
            let ready_at = Instant::now();
            let targets = if long { [1158.0, 5.0, 600.0, 1200.0, 1158.0] } else { [18.0, 5.0, 11.0, 25.0, 18.0] };
            for (index, target) in targets.into_iter().enumerate() {
                let request = index as u64 + 1;
                let started = Instant::now();
                player.send(Command::Thumbnail { session: "webdl-preview".into(), request, position: Some(target) });
                let mut result = None;
                while started.elapsed() < Duration::from_secs(6) {
                    if let Ok(value) = inbox.recv_timeout(Duration::from_millis(100)) {
                        if value["type"] == "thumbnail" && value["request"] == request {
                            result = Some(value);
                            break;
                        }
                    }
                }
                let picture = result.as_ref().and_then(|value| value["src"].as_str());
                let bytes = picture.and_then(|src| {
                    if let Some(data) = src.strip_prefix("data:image/jpeg;base64,") {
                        base64::engine::general_purpose::STANDARD.decode(data).ok()
                    } else {
                        ureq::get(src).call().ok()?.body_mut().read_to_vec().ok()
                    }
                });
                let ok = bytes.as_ref().is_some_and(|bytes| bytes.starts_with(&[0xff, 0xd8, 0xff]));
                println!("PREVIEW {filename} target={target} ok={ok} elapsed_ms={} actual={:?} result={}",
                    started.elapsed().as_millis(), result.as_ref().and_then(|v| v["position"].as_f64()),
                    if result.is_none() { "timeout" } else if picture.is_none() { "unavailable" } else { "image" });
                if !ok {
                    failures.push(format!("{filename} at {target}s"));
                }
            }
            let position = mpv.get_property("time-pos", Kind::Double).and_then(|value| value.as_f64()).unwrap_or(0.0);
            assert!(position <= ready_at.elapsed().as_secs_f64() + 3.0, "Preview generation must not seek the main playback clock");
            player.begin_shutdown();
            player.join();
            if let Some(origin) = origin {
                println!("ORIGIN {filename}: {} requests, {} bytes", origin.requests.load(Ordering::SeqCst), origin.transferred.load(Ordering::SeqCst));
            }
        }
        assert!(failures.is_empty(), "Native indexed previews failed: {failures:?}");
    }

    #[test]
    #[ignore = "set NAVIGATOR_TEST_LIBMPV and NAVIGATOR_TEST_VIDEO; local HTTP fixture"]
    fn headless_shared_playback_bytes_generate_new_previews_without_refetch() {
        let library = std::path::PathBuf::from(std::env::var("NAVIGATOR_TEST_LIBMPV").unwrap());
        aiostreams_thumbs::library_dirs(vec![library.parent().unwrap().to_path_buf()]);
        let data = std::fs::read(std::env::var("NAVIGATOR_TEST_VIDEO").unwrap()).unwrap();
        let size = data.len();
        let origin = crate::media_cache::tests::Origin::new(data);
        origin.mode.store(5, Ordering::SeqCst);
        let mpv = Arc::new(Mpv::new(&library, &[("config", "no"), ("vo", "null"), ("ao", "null"), ("idle", "yes"), ("terminal", "no")]).unwrap());
        let (send, inbox) = mpsc::channel();
        let mut player = Player::start(mpv.clone(), move |value| { let _ = send.send(value); }, |_, _| {}).unwrap();
        player.send(Command::Load { session: "shared".into(), url: origin.url.clone(), headers: BTreeMap::from([("Authorization".into(), "Bearer private-fixture".into()), ("Origin".into(), "https://provider.example".into())]), start_position: 3.2 });
        player.send(Command::Pause { session: "shared".into() });
        wait_for(&inbox, |v| v["type"] == "ready" && v["session"] == "shared");
        player.send(Command::Thumbnail { session: "shared".into(), request: 1, position: Some(0.5) });
        let first = wait_for(&inbox, |v| v["type"] == "thumbnail" && v["request"] == 1);
        assert!(first["src"].as_str().is_some_and(|src| src.starts_with("http://127.0.0.1:") || src.starts_with("data:image/jpeg;base64,")));
        player.send(Command::Thumbnail { session: "shared".into(), request: 2, position: Some(4.5) });
        let second = wait_for(&inbox, |v| v["type"] == "thumbnail" && v["request"] == 2);
        assert!(second["src"].as_str().is_some_and(|src| src.starts_with("http://127.0.0.1:") || src.starts_with("data:image/jpeg;base64,")));
        assert_ne!(second["position"], first["position"], "Exercise a new keyframe, not JPEG reuse");
        println!("Shared cache: {} origin requests, {} bytes for {} byte video", origin.requests.load(Ordering::SeqCst), origin.transferred.load(Ordering::SeqCst), size);
        assert_eq!(origin.transferred.load(Ordering::SeqCst), size as u64, "Playback, indexing and two NEW preview frames must share a single download");
        assert!(mpv.get_property("time-pos", Kind::Double).unwrap().as_f64().unwrap() >= 3.19);
        player.begin_shutdown(); player.join();
    }

    #[test]
    #[ignore = "set NAVIGATOR_TEST_LIBMPV and NAVIGATOR_TEST_VIDEO; local HTTP fixture"]
    fn headless_shared_source_failure_falls_back_once_at_resume_position() {
        let library = std::path::PathBuf::from(std::env::var("NAVIGATOR_TEST_LIBMPV").unwrap());
        let origin = crate::media_cache::tests::Origin::new(std::fs::read(std::env::var("NAVIGATOR_TEST_VIDEO").unwrap()).unwrap());
        origin.mode.store(3, Ordering::SeqCst);
        let mpv = Arc::new(Mpv::new(&library, &[("config", "no"), ("vo", "null"), ("ao", "null"), ("idle", "yes"), ("terminal", "no")]).unwrap());
        let (send, inbox) = mpsc::channel();
        let mut player = Player::start(mpv.clone(), move |value| { let _ = send.send(value); }, |_, _| {}).unwrap();
        player.send(Command::Load { session: "fallback".into(), url: origin.url.clone(), headers: BTreeMap::new(), start_position: 3.2 });
        player.send(Command::Pause { session: "fallback".into() });
        wait_for(&inbox, |v| {
            assert_ne!(v["type"], "error", "A recoverable local-source failure must not escape to the UI: {v}");
            v["type"] == "ready" && v["session"] == "fallback"
        });
        assert!(mpv.get_property("time-pos", Kind::Double).unwrap().as_f64().unwrap() >= 3.19);
        assert_eq!(mpv.get_property("pause", Kind::Flag), Some(json!(true)));
        assert_eq!(mpv.get_property("path", Kind::String).and_then(|value| value.as_str().map(str::to_owned)), Some(origin.url.clone()));
        player.begin_shutdown(); player.join();
    }

    #[test]
    #[ignore = "set NAVIGATOR_TEST_LIBMPV and NAVIGATOR_TEST_HDR_DIR (pq.mkv, hlg.mkv, sdr.mkv)"]
    fn headless_hdr_metadata_and_sdr_transition() {
        let library = std::env::var("NAVIGATOR_TEST_LIBMPV").unwrap();
        let directory = std::path::PathBuf::from(std::env::var("NAVIGATOR_TEST_HDR_DIR").unwrap());
        let mpv = Arc::new(
            Mpv::new(
                std::path::Path::new(&library),
                &[
                    ("config", "no"),
                    ("vo", "null"),
                    ("ao", "null"),
                    ("idle", "yes"),
                    ("terminal", "no"),
                ],
            )
            .unwrap(),
        );
        let (send, inbox) = mpsc::channel();
        let events = send.clone();
        let mut player = Player::start(
            mpv.clone(),
            move |value| {
                let _ = events.send(value);
            },
            move |gamma, primaries| {
                let _ = send.send(json!({"type":"colour", "gamma":gamma, "primaries":primaries}));
            },
        )
        .unwrap();
        for (file, gamma, primaries) in [
            ("pq", "pq", "bt.2020"),
            ("hlg", "hlg", "bt.2020"),
            ("sdr", "bt.1886", "bt.709"),
        ] {
            player.send(Command::Load {
                session: file.into(),
                url: directory
                    .join(format!("{file}.mkv"))
                    .to_string_lossy()
                    .into_owned(),
                headers: BTreeMap::new(),
                start_position: 0.0,
            });
            wait_for(&inbox, |v| {
                v["type"] == "colour" && v["gamma"] == gamma && v["primaries"] == primaries
            });
        }
        // Exercise the same nonblocking writes used by the main/render thread.
        for (name, value) in [
            ("target-prim", "bt.2020"),
            ("target-trc", "pq"),
            ("target-peak", "812"),
            ("icc-profile", ""),
        ] {
            mpv.set_property_async(name, value).unwrap();
        }
        let until = Instant::now() + Duration::from_secs(3);
        while mpv
            .get_property("target-trc", Kind::String)
            .and_then(|v| v.as_str().map(str::to_owned))
            .as_deref()
            != Some("pq")
        {
            assert!(
                Instant::now() < until,
                "Asynchronous HDR output properties were not applied"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        for &(name, value) in crate::hdr::SDR_OUTPUT_OPTIONS {
            mpv.set_property_async(name, value).unwrap();
        }
        let until = Instant::now() + Duration::from_secs(3);
        while mpv
            .get_property("target-trc", Kind::String)
            .as_ref()
            .and_then(Value::as_str)
            != Some("srgb")
        {
            assert!(
                Instant::now() < until,
                "SDR transfer was not restored after HDR"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            mpv.get_property("target-prim", Kind::String)
                .as_ref()
                .and_then(Value::as_str),
            Some("bt.709")
        );
        player.send(Command::Stop {
            session: "sdr".into(),
        });
        wait_for(&inbox, |v| v["type"] == "colour" && v["gamma"].is_null());
        player.begin_shutdown();
        player.join();
    }

    #[test]
    fn bitmap_track_visibility_policy() {
        for codec in ["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle", "xsub"] {
            assert!(bitmap_subtitles_selected(&json!([{"type":"sub","selected":true,"codec":codec}])));
            assert!(!bitmap_subtitles_selected(&json!([{"type":"sub","selected":false,"codec":codec}])));
        }
        for codec in ["subrip", "ass", "webvtt", "mov_text", "unknown"] {
            assert!(!bitmap_subtitles_selected(&json!([{"type":"sub","selected":true,"codec":codec}])));
        }
        assert!(!bitmap_subtitles_selected(&json!([])));
        assert!(!bitmap_subtitles_selected(&json!([{"type":"audio","selected":true,"codec":"hdmv_pgs_subtitle"}])));
    }

    #[test]
    #[ignore = "set NAVIGATOR_TEST_LIBMPV and NAVIGATOR_TEST_HDR_DIR"]
    fn headless_bitmap_and_text_subtitle_routing() {
        let library = std::env::var("NAVIGATOR_TEST_LIBMPV").unwrap();
        let directory = std::path::PathBuf::from(std::env::var("NAVIGATOR_TEST_HDR_DIR").unwrap());
        let subtitle =
            std::env::temp_dir().join(format!("navigator-subtitles-{}.srt", std::process::id()));
        std::fs::write(
            &subtitle,
            "1\n00:00:00,000 --> 00:00:03,900\nOverlay first line\nOverlay second line\n",
        )
        .unwrap();
        let mpv = Arc::new(
            Mpv::new(
                std::path::Path::new(&library),
                &[
                    ("config", "no"),
                    ("vo", "null"),
                    ("ao", "null"),
                    ("idle", "yes"),
                    ("terminal", "no"),
                ],
            )
            .unwrap(),
        );
        let (send, inbox) = mpsc::channel();
        let mut player = Player::start(
            mpv.clone(),
            move |value| {
                let _ = send.send(value);
            },
            |_, _| {},
        )
        .unwrap();
        assert_eq!(
            mpv.get_property("sub-visibility", Kind::Flag),
            Some(json!(false))
        );
        player.send(Command::Load {
            session: "captions".into(),
            url: directory.join("sdr.mkv").to_string_lossy().into_owned(),
            headers: BTreeMap::new(),
            start_position: 0.0,
        });
        wait_for(&inbox, |v| {
            v["type"] == "loaded" && v["session"] == "captions"
        });
        // A tiny authored PGS display set: opaque white 40x10 bitmap at (20,20).
        // This exercises the actual bundled pgssub decoder without private media.
        let bitmap = std::env::temp_dir().join(format!("navigator-subtitles-{}.sup", std::process::id()));
        let mut sup = Vec::new();
        let mut segment = |kind: u8, data: &[u8]| {
            sup.extend_from_slice(b"PG");
            sup.extend_from_slice(&0u32.to_be_bytes()); // PTS
            sup.extend_from_slice(&0u32.to_be_bytes()); // DTS
            sup.push(kind);
            sup.extend_from_slice(&(data.len() as u16).to_be_bytes());
            sup.extend_from_slice(data);
        };
        segment(0x16, &[0x07,0x80,0x04,0x38,0x10,0,0,0x80,0,0,1,0,0,0,0,0,20,0,20]);
        segment(0x17, &[1,0,0,20,0,20,0,40,0,10]);
        segment(0x14, &[0,0,0,16,128,128,0,1,235,128,128,255]);
        let mut object = vec![0,0,0,0xc0,0,1,0xa8,0,40,0,10]; // 424 bytes: dimensions + RLE
        for _ in 0..10 { object.extend_from_slice(&[1;40]); object.extend_from_slice(&[0,0]); }
        segment(0x15, &object);
        segment(0x80, &[]);
        std::fs::write(&bitmap, sup).unwrap();
        mpv.command(&["sub-add", &bitmap.to_string_lossy(), "select"]).unwrap();
        wait_for(&inbox, |v| v["type"] == "tracks" && bitmap_subtitles_selected(&v["tracks"]));
        assert_eq!(mpv.get_property("sub-visibility", Kind::Flag), Some(json!(true)));
        assert_eq!(mpv.get_property("sub-text", Kind::String).and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_default(), "");
        mpv.command(&["sub-add", &subtitle.to_string_lossy(), "select"])
            .unwrap();
        wait_for(&inbox, |v| v["type"] == "tracks" && v["tracks"].as_array().is_some_and(|tracks| tracks.iter().any(|t| t["selected"] == true && t["codec"] == "subrip")));
        assert_eq!(mpv.get_property("sub-visibility", Kind::Flag), Some(json!(false)));
        wait_for(&inbox, |v| {
            v["type"] == "subtitle"
                && v["text"].as_str().is_some_and(|text| {
                    text.contains("Overlay first line") && text.contains("Overlay second line")
                })
        });
        mpv.set_property("sid", "no").unwrap();
        wait_for(&inbox, |v| v["type"] == "subtitle" && v["text"] == "");
        player.begin_shutdown();
        player.join();
        std::fs::remove_file(subtitle).unwrap();
        std::fs::remove_file(bitmap).unwrap();
    }
}
