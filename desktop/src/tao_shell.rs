use crate::{App, platform, protocol, receive, server::Server, startup_log::record};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tao::dpi::{LogicalSize, PhysicalPosition, PhysicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::{Fullscreen, WindowBuilder};
#[cfg(target_os = "macos")]
use tao::{dpi::LogicalPosition, platform::macos::WindowBuilderExtMacOS};
use wry::{NewWindowResponse, Rect, WebContext, WebViewBuilder};

enum UserEvent {
    Emit(Value),
    Update(crate::macos_updater::Event),
    UpdateCommand(protocol::Command),
    Fullscreen(bool),
    WindowControlsVisible(bool),
    DragWindow,
    Close,
    SyncFullscreen,
    BackendReady,
    InterfaceLoaded,
}

const STARTUP_PAGE: &str = r#"<!doctype html><meta charset="utf-8"><title>Navigator</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px system-ui;background:Canvas;color:CanvasText}</style>
<main>Starting Navigator…</main>"#;
const STARTUP_ERROR_PAGE: &str = r#"<!doctype html><meta charset="utf-8"><title>Navigator</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px system-ui;background:Canvas;color:CanvasText}main{padding:2rem}</style>
<main>Navigator couldn’t start. Quit the app and try again.</main>"#;

struct PendingBackend {
    cancelled: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    result: mpsc::Receiver<Result<Server, String>>,
}

impl PendingBackend {
    fn start(
        resources: PathBuf,
        port: u16,
        proxy: EventLoopProxy<UserEvent>,
        log: PathBuf,
        started: Instant,
    ) -> Result<Self, String> {
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancel = Arc::clone(&cancelled);
        let (sender, result) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("navigator-startup".into())
            .spawn(move || {
                record(&log, started, "backend-starting");
                let server = Server::start_cancellable(&resources, port, &cancel);
                let stage = if server.is_ok() { "backend-ready" } else { "backend-error" };
                record(&log, started, stage);
                if sender.send(server).is_ok() {
                    let _ = proxy.send_event(UserEvent::BackendReady);
                }
            })
            .map_err(|error| format!("Could not start the backend worker: {error}"))?;
        Ok(Self { cancelled, worker: Some(worker), result })
    }
}

impl Drop for PendingBackend {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        // Any ready server left in the channel is dropped with the receiver.
    }
}

fn bounds(size: PhysicalSize<u32>) -> Rect {
    Rect {
        position: PhysicalPosition::new(0, 0).into(),
        size: size.into(),
    }
}

pub fn run(mut app: App) -> Result<(), String> {
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let started = app.started;
    let startup_log = app.data.join("startup.jsonl");
    if std::fs::metadata(&startup_log).is_ok_and(|metadata| metadata.len() > 1024 * 1024) {
        let _ = std::fs::rename(&startup_log, app.data.join("startup.previous.jsonl"));
    }
    #[cfg(target_os = "macos")]
    let menu = platform::install_menu({
        let proxy = proxy.clone();
        move || {
            let _ = proxy.send_event(UserEvent::Close);
        }
    })?;
    let builder = WindowBuilder::new()
        .with_title("Navigator")
        .with_inner_size(LogicalSize::new(1280.0, 800.0))
        .with_min_inner_size(LogicalSize::new(720.0, 480.0));
    // Keep AppKit's real window buttons/fullscreen behavior, with the WebView
    // extending behind the transparent titlebar instead of a separate strip.
    #[cfg(target_os = "macos")]
    let builder = builder
        .with_titlebar_transparent(true)
        .with_title_hidden(true)
        .with_fullsize_content_view(true)
        // Eight points higher, matching the player Back button's center.
        .with_traffic_light_inset(LogicalPosition::new(16.0, 30.0));
    let window = builder.build(&event_loop).map_err(|e| e.to_string())?;
    record(&startup_log, started, "window-created");
    let mut backend = app.backend.take()
        .map(|(resources, port)| PendingBackend::start(resources, port, proxy.clone(), startup_log.clone(), started))
        .transpose()?;
    let packaged = backend.is_some();
    let surface = platform::VideoSurface::new(&window)?;
    let mut player = app.start_player(&surface, {
        let proxy = proxy.clone();
        move |value| {
            let _ = proxy.send_event(UserEvent::Emit(value));
        }
    })?;
    surface.attach(player.mpv.clone());
    let mut context = WebContext::new(Some(app.data.join("webview")));
    let app_origin = app.origin.clone();
    let requests = player.sender();
    let ipc_proxy = proxy.clone();
    let smoke = app.smoke;
    let smoke_requests = player.sender();
    let smoke_path = if smoke {
        Some(crate::smoke_file()?)
    } else {
        None
    };
    let load_path = smoke_path.clone();
    let builder = WebViewBuilder::new_with_web_context(&mut context)
        .with_bounds(bounds(window.inner_size()))
        .with_transparent(true)
        .with_devtools(app.devtools)
        .with_initialization_script(&app.bridge)
        .with_ipc_handler(move |request| {
            if !(smoke && request.uri().to_string() == "about:blank")
                && protocol::origin(&request.uri().to_string()).as_deref() != Some(&app_origin)
            {
                return;
            }
            match protocol::parse(request.body()) {
                Ok(protocol::Command::ClientStage { stage }) => {
                    log::debug!("playback client stage {}", stage.label());
                }
                Ok(protocol::Command::Fullscreen { value }) => {
                    let _ = ipc_proxy.send_event(UserEvent::Fullscreen(value));
                }
                Ok(protocol::Command::WindowControlsVisible { visible }) => {
                    let _ = ipc_proxy.send_event(UserEvent::WindowControlsVisible(visible));
                }
                Ok(protocol::Command::WindowDrag {}) => {
                    let _ = ipc_proxy.send_event(UserEvent::DragWindow);
                }
                Ok(
                    command @ (protocol::Command::UpdateStatus {}
                    | protocol::Command::UpdateCheck {}
                    | protocol::Command::UpdateAutomatic { .. }),
                ) => {
                    let _ = ipc_proxy.send_event(UserEvent::UpdateCommand(command));
                }
                Ok(command) => {
                    let _ = requests.send(command);
                }
                Err(message) => {
                    let session = serde_json::from_str::<Value>(request.body())
                        .ok()
                        .and_then(|v| v.get("session").cloned());
                    let _ = ipc_proxy.send_event(UserEvent::Emit(
                        json!({"type":"error","session":session,"message":message}),
                    ));
                }
            }
        })
        .with_navigation_handler({
            let origin = app.origin.clone();
            move |url| {
                let allowed = ((smoke || packaged) && url == "about:blank")
                    || protocol::origin(&url).as_deref() == Some(&origin);
                if !allowed && protocol::media_url(&url).is_ok() {
                    let _ = open::that_detached(url);
                }
                allowed
            }
        })
        .with_new_window_req_handler(|url, _| {
            if protocol::media_url(&url).is_ok() {
                let _ = open::that_detached(url);
            }
            NewWindowResponse::Deny
        })
        .with_on_page_load_handler({
            let proxy = proxy.clone();
            let origin = app.origin.clone();
            move |event, url| {
                if let wry::PageLoadEvent::Finished = event {
                    let _ = proxy.send_event(UserEvent::SyncFullscreen);
                    if protocol::origin(&url).as_deref() == Some(origin.as_str()) {
                        let _ = proxy.send_event(UserEvent::InterfaceLoaded);
                    }
                    if let Some(path) = &load_path {
                        let _ = smoke_requests.send(protocol::Command::Load {
                            session: "native-smoke".into(),
                            url: path.to_string_lossy().into_owned(),
                            headers: Default::default(),
                            start_position: 0.0,
                        });
                    }
                }
            }
        });
    let builder = if smoke {
        builder.with_html(include_str!("smoke.html"))
    } else if packaged {
        builder.with_html(STARTUP_PAGE)
    } else {
        builder.with_url(&app.url)
    };
    let webview = builder.build_as_child(&window).map_err(|e| e.to_string())?;
    surface.resize(window.inner_size().width, window.inner_size().height);
    record(&startup_log, started, "webview-created");
    let update_settings = app.data.join("update-checks.json");
    let mut automatic_updates = std::fs::read(&update_settings)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<bool>(&bytes).ok())
        .unwrap_or(true);
    let update_proxy = proxy.clone();
    let updater_result = if !app.smoke && packaged {
        Some(crate::macos_updater::Updater::start(
            move |event| {
                let _ = update_proxy.send_event(UserEvent::Update(event));
            },
        ))
    } else {
        None
    };
    let mut update_message = updater_result
        .as_ref()
        .and_then(|result| result.as_ref().err())
        .cloned();
    let updater = updater_result.and_then(Result::ok);
    let mut update_state = if update_message.is_some() {
        "error"
    } else {
        "idle"
    };
    let mut installing = false;
    let mut closing = false;
    let mut fullscreen = false;
    let mut window_controls_visible = true;
    let mut next_update_probe = Instant::now();
    let mut interface_loaded = false;
    event_loop.run(move |event, _, flow| {
        // AppKit/Dock quit can destroy the loop without a CloseRequested event.
        // Stop the owned backend here rather than relying on process-exit drops.
        if matches!(&event, Event::LoopDestroyed) {
            if !installing { if let Some(updater) = &updater { updater.cancel_pending_install(); } }
            drop(backend.take());
            drop(app._server.take());
            return;
        }
        // Sparkle now owns termination. Do not resize or refresh a video
        // surface that was released before the installation handoff.
        if installing {
            // The installer is ready before it asks AppKit to quit. Our custom
            // Cmd-Q menu sends Close, so it must remain live after the handoff.
            let update = match &event {
                Event::UserEvent(UserEvent::Update(event)) => Some(*event),
                _ => None,
            };
            let quit = matches!(&event, Event::UserEvent(UserEvent::Close)
                | Event::WindowEvent { event: WindowEvent::CloseRequested, .. });
            *flow = if crate::macos_updater::install_should_exit(update, quit) {
                ControlFlow::Exit
            } else { ControlFlow::Wait };
            return;
        }
        // Own the backend for exactly as long as the native event loop.
        let _server = &app._server;
        let _instance = &app._instance;
        #[cfg(target_os = "macos")]
        let _menu = &menu;
        if !closing && interface_loaded && automatic_updates && updater.is_some() && Instant::now() >= next_update_probe {
            let started = update_state != "checking" && updater.as_ref().unwrap().probe();
            next_update_probe = Instant::now() + crate::update_feed::next_probe_delay(started);
        }
        *flow = if closing && !installing {
            ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(16))
        } else if interface_loaded && automatic_updates && updater.is_some() {
            ControlFlow::WaitUntil(next_update_probe)
        } else {
            ControlFlow::Wait
        };
        if closing && !installing && player.finished() && updater.as_ref().is_none_or(|updater| updater.can_close()) {
            surface.shutdown();
            player.join();
            drop(backend.take());
            drop(app._server.take());
            if let Some(path) = &smoke_path {
                let _ = std::fs::remove_file(path);
            }
            if updater.as_ref().is_some_and(|updater| updater.finish_install()) {
                installing = true;
                *flow = ControlFlow::Wait;
                return;
            }
            *flow = ControlFlow::Exit;
            return;
        }
        match event {
            Event::UserEvent(UserEvent::BackendReady) if !closing => {
                if let Some(pending) = backend.take() {
                    let result = pending.result.try_recv()
                        .map_err(|error| error.to_string())
                        .and_then(|result| result);
                    match result {
                        Ok(server) => {
                            app._server = Some(server);
                            if let Err(error) = webview.load_url(&app.url) {
                                log::error!("Could not load Navigator: {error}");
                                let _ = webview.load_html(STARTUP_ERROR_PAGE);
                            }
                        }
                        Err(error) => {
                            log::error!("Could not start Navigator: {error}");
                            let _ = webview.load_html(STARTUP_ERROR_PAGE);
                        }
                    }
                }
            }
            Event::UserEvent(UserEvent::InterfaceLoaded) if !interface_loaded => {
                interface_loaded = true;
                record(&startup_log, started, "interface-loaded");
            }
            Event::UserEvent(UserEvent::Update(event)) => {
                use crate::macos_updater::Event as UpdateEvent;
                match event {
                    UpdateEvent::Available => { update_state = "available"; update_message = None; }
                    UpdateEvent::Downloading => { update_state = "downloading"; update_message = None; }
                    UpdateEvent::Ready => { update_state = "ready"; update_message = None; }
                    UpdateEvent::Current => { update_state = "current"; update_message = None; }
                    UpdateEvent::Error => { update_state = "error"; update_message = Some("Couldn’t check or download the update. Try again later.".into()); }
                    UpdateEvent::Finished => { if update_state == "checking" { update_state = "idle"; } }
                    UpdateEvent::Install => { update_state = "idle"; closing = true; player.begin_shutdown(); }
                    UpdateEvent::Relaunch => { closing = true; player.begin_shutdown(); }
                }
                let _ = webview.evaluate_script(&receive(&json!({"type":"update-status", "version":env!("CARGO_PKG_VERSION"), "available":updater.is_some(), "automatic":automatic_updates, "state":update_state, "message":update_message})));
            }
            Event::UserEvent(UserEvent::UpdateCommand(command)) if !closing => {
                if let Some(updater) = &updater {
                    match command {
                        protocol::Command::UpdateCheck {} => { update_state = "checking"; update_message = None; updater.check(); }
                        protocol::Command::UpdateAutomatic { enabled } => {
                            match std::fs::write(&update_settings, if enabled { "true" } else { "false" }) {
                                Ok(()) => {
                                    automatic_updates = enabled;
                                    let started = enabled && update_state != "checking" && updater.probe();
                                    next_update_probe = Instant::now() + crate::update_feed::next_probe_delay(started);
                                }
                                Err(_) => { update_state = "error"; update_message = Some("Couldn’t save update preferences.".into()); }
                            }
                        }
                        _ => {}
                    }
                }
                let _ = webview.evaluate_script(&receive(&json!({"type":"update-status", "version":env!("CARGO_PKG_VERSION"), "available":updater.is_some(), "automatic":automatic_updates, "state":update_state, "message":update_message})));
            }
            Event::UserEvent(UserEvent::Emit(value)) => {
                let _ = webview.evaluate_script(&receive(&value));
            }
            Event::UserEvent(UserEvent::Fullscreen(value)) => {
                #[cfg(target_os = "macos")]
                platform::set_window_controls_visible(&window, value || window_controls_visible);
                window.set_fullscreen(value.then_some(Fullscreen::Borderless(None)));
            }
            Event::UserEvent(UserEvent::WindowControlsVisible(visible)) => {
                window_controls_visible = visible;
                #[cfg(target_os = "macos")]
                platform::set_window_controls_visible(&window, visible || window.fullscreen().is_some());
            }
            Event::UserEvent(UserEvent::DragWindow) => {
                if window.fullscreen().is_none() {
                    let _ = window.drag_window();
                }
            }
            Event::UserEvent(UserEvent::SyncFullscreen) => {
                // A document reload must not leave playback-only chrome hidden.
                window_controls_visible = true;
                #[cfg(target_os = "macos")]
                platform::set_window_controls_visible(&window, true);
                let _ = webview.evaluate_script(&receive(
                    &json!({"type":"fullscreen","value":window.fullscreen().is_some()}),
                ));
            }
            Event::UserEvent(UserEvent::Close) => {
                if let Some(updater) = &updater { updater.cancel_pending_install(); }
                closing = true;
                player.begin_shutdown();
            }
            Event::WindowEvent {
                event: WindowEvent::Resized(size),
                ..
            } => {
                surface.resize(size.width, size.height);
                #[cfg(target_os = "macos")]
                surface.refresh_hdr();
                let _ = webview.set_bounds(bounds(size));
            }
            Event::WindowEvent {
                event: WindowEvent::ScaleFactorChanged { new_inner_size, .. },
                ..
            } => {
                surface.resize(new_inner_size.width, new_inner_size.height);
                #[cfg(target_os = "macos")]
                surface.refresh_hdr();
                let _ = webview.set_bounds(bounds(*new_inner_size));
            }
            Event::WindowEvent {
                event: WindowEvent::Moved(_) | WindowEvent::Focused(true),
                ..
            } => {
                #[cfg(target_os = "macos")]
                surface.refresh_hdr();
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                if let Some(updater) = &updater { updater.cancel_pending_install(); }
                closing = true;
                player.begin_shutdown();
            }
            _ => {}
        }
        let actual = window.fullscreen().is_some();
        if fullscreen != actual {
            fullscreen = actual;
            #[cfg(target_os = "macos")]
            platform::set_window_controls_visible(&window, actual || window_controls_visible);
            #[cfg(target_os = "macos")]
            surface.refresh_hdr();
            let _ = webview.evaluate_script(&receive(&json!({"type":"fullscreen","value":actual})));
        }
    });
}
