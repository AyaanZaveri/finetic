//! Optional in-process Swift adapter. All calls are made on AppKit's main
//! thread; the callback only queues JSON to the native event loop.
use crate::{player::Player, protocol::{Command, NativeEngine}, wake_lock::WakeLock};
use libloading::Library;
use serde_json::{Value, json};
use std::{collections::BTreeMap, ffi::c_void, path::PathBuf};
use tao::{platform::macos::WindowExtMacOS, window::Window};

type Event = Box<dyn Fn(Value)>;
type Callback = unsafe extern "C" fn(*mut c_void, *const u8, usize);
type Create = unsafe extern "C" fn(*mut c_void, Callback, *mut c_void) -> *mut c_void;
type Send = unsafe extern "C" fn(*mut c_void, *const u8, usize);
type Destroy = unsafe extern "C" fn(*mut c_void);

unsafe extern "C" fn event(context: *mut c_void, bytes: *const u8, len: usize) {
    if context.is_null() || bytes.is_null() || len == 0 || len > 4 * 1024 * 1024 { return; }
    // The bridge owns these bytes for the duration of the synchronous callback.
    let data = unsafe { std::slice::from_raw_parts(bytes, len) };
    if let Ok(value) = serde_json::from_slice::<Value>(data) {
        let emit = unsafe { &*context.cast::<Event>() };
        emit(value);
    }
}

struct Bridge {
    handle: *mut c_void,
    send: Send,
    destroy: Destroy,
    _callback: Box<Event>,
    // Swift metadata and Objective-C classes cannot safely be unloaded.
    _resident: std::mem::ManuallyDrop<Library>,
}

impl Bridge {
    fn open(window: &Window, emit: impl Fn(Value) + 'static) -> Option<Self> {
        // Never attempt to load a macOS 15 Swift binary on an older system.
        let os = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
        if os.majorVersion < 15 { return None; }
        let path = std::env::var_os("NAVIGATOR_AETHER_BRIDGE").map(PathBuf::from)
            .or_else(|| std::env::current_exe().ok()?.parent()?.parent()
                .map(|contents| contents.join("Frameworks/libNavigatorAetherBridge.dylib")))?;
        if !path.is_file() { return None; }
        let library = match unsafe { Library::new(&path) } {
            Ok(library) => library,
            Err(error) => { log::warn!("AetherEngine unavailable: {error}"); return None; }
        };
        let create = *unsafe { library.get::<Create>(b"navigator_aether_create") }.ok()?;
        let send = *unsafe { library.get::<Send>(b"navigator_aether_command") }.ok()?;
        let destroy = *unsafe { library.get::<Destroy>(b"navigator_aether_destroy") }.ok()?;
        let mut callback: Box<Event> = Box::new(Box::new(emit));
        let handle = unsafe { create(window.ns_view().cast(), event, (&mut *callback as *mut Event).cast()) };
        let resident = std::mem::ManuallyDrop::new(library);
        if handle.is_null() { log::warn!("AetherEngine initialization failed"); return None; }
        Some(Self { handle, send, destroy, _callback: callback, _resident: resident })
    }
    fn send(&self, value: Value) {
        let data = value.to_string();
        unsafe { (self.send)(self.handle, data.as_ptr(), data.len()) };
    }
}

impl Drop for Bridge {
    fn drop(&mut self) { unsafe { (self.destroy)(self.handle) }; }
}

struct Active {
    session: String,
    url: String,
    headers: BTreeMap<String, String>,
    position: f64,
    automatic: bool,
    paused: bool,
    volume: f64,
    muted: bool,
    rate: f64,
    subtitle_delay: f64,
    audio_delay: f64,
    fit: Value,
}

pub struct Router {
    bridge: Option<Bridge>,
    preference: NativeEngine,
    audio_language: Option<String>,
    manual_hdr: bool,
    active: Option<Active>,
    mpv_session: Option<String>,
    wake_lock: WakeLock,
}

impl Router {
    pub fn new(window: &Window, smoke: bool, emit: impl Fn(Value) + 'static) -> Self {
        Self { bridge: if smoke { None } else { Bridge::open(window, emit) },
            preference: NativeEngine::Mpv, audio_language: None, manual_hdr: false,
            active: None, mpv_session: None, wake_lock: WakeLock::default() }
    }
    pub fn available(&self) -> bool { self.bridge.is_some() }
    pub fn set_peak(&mut self, nits: Option<u32>) { self.manual_hdr = nits.is_some(); }

    pub fn send(&mut self, command: Command, mpv: &Player) {
        if let Command::NativeEngine { engine, audio_language } = command {
            self.preference = engine;
            self.audio_language = audio_language;
            return;
        }
        if let Command::Load { session, url, headers, start_position } = command {
            self.stop();
            // Manual HDR peak is an existing mpv feature. Do not silently
            // move a user with this setting to a limited tone-map route.
            // AVPlayer's remote-HLS bypass can forward arbitrary headers to
            // other hosts. Do not give it authenticated or custom-header sources.
            if let Some(bridge) = &self.bridge && self.preference != NativeEngine::Mpv
                && (self.preference == NativeEngine::Aether || !self.manual_hdr)
                && headers.is_empty() {
                if let Some(previous) = self.mpv_session.take() {
                    mpv.send(Command::Stop { session: previous });
                }
                let automatic = self.preference == NativeEngine::Automatic;
                bridge.send(json!({"type":"load","session":session,"url":url,"headers":headers,
                    "startPosition":start_position,"audioLanguage":self.audio_language}));
                self.active = Some(Active { session, url, headers, position: start_position, automatic,
                    paused: false, volume: 1.0, muted: false, rate: 1.0, subtitle_delay: 0.0,
                    audio_delay: 0.0, fit: json!("fit") });
                return;
            }
            self.mpv_session = Some(session.clone());
            mpv.send(Command::Load { session, url, headers, start_position });
            return;
        }

        let Some(active) = &mut self.active else { mpv.send(command); return; };
        let Ok(value) = serde_json::to_value(&command) else { return; };
        if value["session"].as_str() != Some(&active.session) { return; }
        match &command {
            Command::Stop { .. } => { self.stop(); return; }
            Command::Play { .. } => active.paused = false,
            Command::Pause { .. } => active.paused = true,
            Command::Seek { position, .. } => active.position = *position,
            Command::Volume { volume, .. } => active.volume = *volume,
            Command::Muted { muted, .. } => active.muted = *muted,
            Command::Rate { rate, .. } => active.rate = *rate,
            Command::AudioDelay { seconds, .. } => active.audio_delay = *seconds,
            Command::SubtitleDelay { seconds, .. } => active.subtitle_delay = *seconds,
            Command::VideoFit { .. } => active.fit = value["mode"].clone(),
            _ => {}
        }
        if let Some(bridge) = &self.bridge { bridge.send(value); }
    }

    pub fn stop(&mut self) {
        if let Some(active) = self.active.take() {
            if let Some(bridge) = &self.bridge { bridge.send(json!({"type":"stop","session":active.session})); }
        }
        let _ = self.wake_lock.set_active(false);
    }

    pub fn accept_mpv(&self, value: &mut Value) -> bool {
        if self.active.is_some() && value.get("session").is_some() { return false; }
        if value["type"] == "state" { value["state"]["engine"] = json!("mpv"); }
        true
    }

    /// Returns the events which should reach the frontend. Automatic only
    /// retries once; explicit selection reports the engine error.
    pub fn accept_aether(&mut self, value: Value, mpv: &Player) -> Vec<Value> {
        let Some(active) = &mut self.active else { return vec![]; };
        if value["session"].as_str() != Some(&active.session) { return vec![]; }
        if value["type"] == "state" {
            if let Some(position) = value["state"]["position"].as_f64() { active.position = position; }
            let _ = self.wake_lock.set_active(!active.paused);
        }
        if value["type"] == "ended" { let _ = self.wake_lock.set_active(false); }
        if value["type"] != "error" { return vec![value]; }
        let active = self.active.take().expect("active session");
        let _ = self.wake_lock.set_active(false);
        if !active.automatic { return vec![value]; }
        let session = active.session;
        let position = value["position"].as_f64().unwrap_or(active.position).max(0.0);
        log::info!("AetherEngine failed; retrying with libmpv at the current position");
        self.mpv_session = Some(session.clone());
        mpv.send(Command::Load { session: session.clone(), url: active.url, headers: active.headers, start_position: position });
        mpv.send(Command::Volume { session: session.clone(), volume: active.volume });
        mpv.send(Command::Muted { session: session.clone(), muted: active.muted });
        mpv.send(Command::Rate { session: session.clone(), rate: active.rate });
        mpv.send(Command::AudioDelay { session: session.clone(), seconds: active.audio_delay });
        mpv.send(Command::SubtitleDelay { session: session.clone(), seconds: active.subtitle_delay });
        if let Ok(mode) = serde_json::from_value(active.fit) {
            mpv.send(Command::VideoFit { session: session.clone(), mode });
        }
        if active.paused { mpv.send(Command::Pause { session: session.clone() }); }
        vec![json!({"type":"engine-fallback","session":session,"reason":"AetherEngine playback failed"})]
    }
}
