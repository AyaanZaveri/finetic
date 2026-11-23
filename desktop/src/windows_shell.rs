//! Windows has a native first frame and cancellable backend initialization.
//! The macOS renderer and its render-thread lifecycle remain in tao_shell.
use crate::{
    App, desktop_media, platform,
    player::Player,
    protocol, receive,
    startup_log::record,
    window_state::{Display, Placement},
};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tao::{
    dpi::{LogicalSize, PhysicalPosition, PhysicalSize},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    platform::windows::{IconExtWindows, WindowBuilderExtWindows, WindowExtWindows},
    window::{Fullscreen, Icon, Theme, Window, WindowBuilder},
};
use wry::{NewWindowResponse, Rect, WebContext, WebView, WebViewBuilder};

fn startup_document() -> &'static str {
    include_str!("startup.html")
}

// NavigateToString still exposes about:blank to script/IPC, but recent
// Evergreen versions report its encoded HTML in NavigationStarting.
fn smoke_navigation_allowed(url: &str) -> bool {
    bundled_navigation_allowed(url, include_bytes!("smoke.html"))
}

fn bundled_navigation_allowed(url: &str, html: &[u8]) -> bool {
    use base64::Engine;
    url == "about:blank"
        || url
            == format!(
                "data:text/html;charset=utf-8;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(html)
            )
}

#[cfg(test)]
#[test]
fn smoke_navigation_is_exact() {
    use base64::Engine;
    let trusted = format!(
        "data:text/html;charset=utf-8;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(include_bytes!("smoke.html"))
    );
    assert!(smoke_navigation_allowed(&trusted));
    assert!(smoke_navigation_allowed("about:blank"));
    assert!(!smoke_navigation_allowed(
        "data:text/html;base64,PHNjcmlwdD4="
    ));
    assert!(!smoke_navigation_allowed(&(trusted + "AA")));
}

#[cfg(test)]
#[test]
fn startup_navigation_has_no_privileged_origin() {
    use base64::Engine;
    let html = startup_document().as_bytes();
    assert!(startup_document().contains("default-src 'none'"));
    assert!(!startup_document().contains("<script"));
    assert!(!startup_document().contains("data-details"));
    let trusted = format!(
        "data:text/html;charset=utf-8;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(html)
    );
    assert!(bundled_navigation_allowed(&trusted, html));
    assert_eq!(protocol::origin(&trusted), None);
    assert_eq!(protocol::origin("about:blank"), None);
    assert!(!bundled_navigation_allowed(&(trusted + "AA"), html));
    assert!(!bundled_navigation_allowed(
        "data:text/html;base64,PHNjcmlwdD4=",
        html
    ));
    assert!(!bundled_navigation_allowed("https://example.com", html));
}

type Boot = Result<(App, Player, Option<PathBuf>), String>;
enum UserEvent {
    RenderError(String),
    Update(crate::windows_updater::Event),
    ClientStage(protocol::ClientStage),
    Boot(Box<Boot>),
    BackendReady,
    Command(protocol::Command, Option<Value>),
    Emit(Value),
    GlassFrame,
    GlassConsumed(u32, u64),
    Fullscreen(bool),
    TitlebarPress { double_click: bool },
    ChromeHover(u32),
    ChromeActivation(bool),
    OpenSettings,
    SystemMedia(desktop_media::Action),
    ToggleFullscreen,
    WindowControl(protocol::WindowAction),
    Ready(bool),
    StartupLoaded,
    PageLoaded,
}

struct Frontend {
    url: String,
    origin: String,
    bridge: String,
    devtools: bool,
    smoke: bool,
}
impl From<&App> for Frontend {
    fn from(app: &App) -> Self {
        Self {
            url: app.url.clone(),
            origin: app.origin.clone(),
            bridge: app.bridge.clone(),
            devtools: app.devtools,
            smoke: app.smoke,
        }
    }
}

fn bounds(size: PhysicalSize<u32>) -> Rect {
    Rect {
        position: PhysicalPosition::new(0, 0).into(),
        size: size.into(),
    }
}

fn placement(window: &Window) -> Option<Placement> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().to_logical::<f64>(window.scale_factor());
    Some(Placement {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: false,
    })
}

fn remember_placement(window: &Window, normal: &mut Option<Placement>) {
    if window.fullscreen().is_none() && !window.is_minimized() {
        if window.is_maximized() {
            if let Some(normal) = normal {
                normal.maximized = true;
            }
        } else {
            *normal = placement(window);
        }
    }
}

fn resize_views(
    surface: &platform::VideoSurface,
    view: Option<&WebView>,
    loading: Option<&platform::LoadingView>,
    size: PhysicalSize<u32>,
) {
    if size.width == 0 || size.height == 0 {
        return;
    }
    surface.resize(size.width, size.height);
    if let Some(view) = view {
        let _ = view.set_bounds(bounds(size));
    }
    if let Some(loading) = loading {
        loading.resize(size.width, size.height);
    }
}

fn make_view(
    context: &mut WebContext,
    app: &Frontend,
    window: &Window,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
) -> Result<WebView, String> {
    let origin = app.origin.clone();
    let smoke = app.smoke;
    let ipc = proxy.clone();
    let nav_origin = origin.clone();
    let page_origin = origin.clone();
    let page = proxy.clone();
    let builder = WebViewBuilder::new_with_web_context(context)
        .with_bounds(bounds(window.inner_size()))
        .with_transparent(true)
        .with_devtools(app.devtools)
        .with_initialization_script(&app.bridge)
        .with_ipc_handler(move |request| {
            if !(smoke && request.uri().to_string() == "about:blank")
                && protocol::origin(&request.uri().to_string()).as_deref() != Some(&origin)
            {
                return;
            }
            match protocol::parse(request.body()) {
                Ok(protocol::Command::ClientStage { stage }) => {
                    let _ = ipc.send_event(UserEvent::ClientStage(stage));
                }
                Ok(protocol::Command::AppReady { dark }) => {
                    let _ = ipc.send_event(UserEvent::Ready(dark));
                }
                Ok(protocol::Command::Fullscreen { value }) => {
                    let _ = ipc.send_event(UserEvent::Fullscreen(value));
                }
                Ok(protocol::Command::WindowControl { action }) => {
                    let _ = ipc.send_event(UserEvent::WindowControl(action));
                }
                Ok(protocol::Command::GlassConsumed { slot, sequence }) => {
                    let _ = ipc.send_event(UserEvent::GlassConsumed(slot, sequence));
                }
                Ok(protocol::Command::WindowDrag { double_click }) => {
                    let _ = ipc.send_event(UserEvent::TitlebarPress { double_click });
                }
                Ok(command) => {
                    let session = serde_json::from_str::<Value>(request.body())
                        .ok()
                        .and_then(|v| v.get("session").cloned());
                    let _ = ipc.send_event(UserEvent::Command(command, session));
                }
                Err(message) => {
                    let session = serde_json::from_str::<Value>(request.body())
                        .ok()
                        .and_then(|v| v.get("session").cloned());
                    let _ = ipc.send_event(UserEvent::Emit(
                        json!({"type":"error","session":session,"message":message}),
                    ));
                }
            }
        })
        .with_navigation_handler(move |url| {
            let allowed = (smoke && smoke_navigation_allowed(&url))
                || (!smoke && bundled_navigation_allowed(&url, startup_document().as_bytes()))
                || protocol::origin(&url).as_deref() == Some(&nav_origin);
            if !allowed && protocol::media_url(&url).is_ok() {
                let _ = open::that_detached(url);
            }
            allowed
        })
        .with_new_window_req_handler(|url, _| {
            if protocol::media_url(&url).is_ok() {
                let _ = open::that_detached(url);
            }
            NewWindowResponse::Deny
        })
        .with_on_page_load_handler(move |event, url| {
            if matches!(event, wry::PageLoadEvent::Finished) {
                let _ = page.send_event(
                    if smoke || protocol::origin(&url).as_deref() == Some(&page_origin) {
                        UserEvent::PageLoaded
                    } else {
                        UserEvent::StartupLoaded
                    },
                );
            }
        });
    let builder = if smoke {
        builder.with_html(include_str!("smoke.html"))
    } else {
        builder.with_html(startup_document())
    };
    builder
        .build_as_child(window)
        .map_err(|error| error.to_string())
}

// Frameless maximized windows can retain the work-area inset during the
// fullscreen transition. Restore first, then return to maximized on exit.
// Adapted from AIOStreams 259e769 (app/src/shell/tao_shell.rs).
fn set_fullscreen(window: &Window, on: bool, remaximize: &mut bool) {
    if on == window.fullscreen().is_some() { return; }
    if on {
        *remaximize = window.is_maximized();
        if *remaximize { window.set_maximized(false); }
        window.set_fullscreen(Some(Fullscreen::Borderless(None)));
    } else {
        window.set_fullscreen(None);
        if std::mem::take(remaximize) { window.set_maximized(true); }
    }
}

pub fn run(app: App) -> Result<(), String> {
    platform::claim_app_id();
    let started = app.started;
    let log = app.data.join("startup.jsonl");
    if std::fs::metadata(&log).is_ok_and(|m| m.len() > 1024 * 1024) {
        let previous = app.data.join("startup.previous.jsonl");
        let _ = std::fs::remove_file(&previous);
        let _ = std::fs::rename(&log, previous);
    }
    let state_path = app.data.join("window.json");
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let saved = std::fs::read(&state_path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Placement>(&b).ok());
    let displays: Vec<_> = event_loop
        .available_monitors()
        .map(|m| Display {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
            scale: m.scale_factor(),
        })
        .collect();
    let restored = saved.and_then(|s| s.restore(&displays));
    let icon = Icon::from_resource(1, None).ok();
    let mut builder = WindowBuilder::new()
        .with_title("Navigator")
        .with_decorations(false)
        .with_undecorated_shadow(true)
        .with_window_classname(platform::window_class(app.smoke))
        .with_window_icon(icon.clone())
        .with_taskbar_icon(icon)
        .with_background_color(platform::STARTUP_BACKGROUND)
        .with_visible(false)
        .with_inner_size(if app.smoke {
            LogicalSize::new(960.0, 640.0)
        } else {
            LogicalSize::new(1280.0, 800.0)
        })
        .with_min_inner_size(LogicalSize::new(480.0, 360.0));
    if let Some(saved) = &restored {
        builder = builder
            .with_position(PhysicalPosition::new(saved.x, saved.y))
            .with_inner_size(LogicalSize::new(saved.width, saved.height));
    }
    let window = builder.build(&event_loop).map_err(|e| e.to_string())?;
    let mut normal = restored.or_else(|| placement(&window));
    let settings_shortcut = (!app.smoke).then(|| crate::desktop_shortcut::settings({
        let proxy = proxy.clone();
        move || { let _ = proxy.send_event(UserEvent::OpenSettings); }
    })).flatten();
    let mut media_session = desktop_media::Session::default();
    let mut media_controls = if app.smoke { None } else {
        let proxy = proxy.clone();
        desktop_media::Controls::new(windows::Win32::Foundation::HWND(window.hwnd() as _), move |action| {
            let _ = proxy.send_event(UserEvent::SystemMedia(action));
        }).inspect_err(|error| log::debug!("System media controls unavailable: {error}")).ok()
    };
    let chrome_proxy = proxy.clone();
    platform::on_chrome_hover(move |hit| {
        let _ = chrome_proxy.send_event(UserEvent::ChromeHover(hit));
    });
    let activation_proxy = proxy.clone();
    platform::on_chrome_activation(move |active| {
        let _ = activation_proxy.send_event(UserEvent::ChromeActivation(active));
    });
    let fullscreen_proxy = proxy.clone();
    platform::on_chrome_fullscreen(move || { let _ = fullscreen_proxy.send_event(UserEvent::ToggleFullscreen); });
    platform::install_chrome(&window);
    let surface = platform::VideoSurface::new(&window)?;
    let mut loading = Some(platform::LoadingView::new(&window)?);
    window.set_visible(true);
    if normal.as_ref().is_some_and(|p| p.maximized) {
        window.set_maximized(true);
    }
    record(&log, started, "window-visible");
    let frontend = Frontend::from(&app);
    let update_settings = app.data.join("update-checks.json");
    let mut automatic_updates = std::fs::read(&update_settings).ok()
        .and_then(|bytes| serde_json::from_slice::<bool>(&bytes).ok()).unwrap_or(true);
    let installed_directory = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from));
    let update_proxy = proxy.clone();
    let updater_result = if !app.smoke && app.backend.is_some()
        && installed_directory.as_ref().is_some_and(|p| p.join("Uninstall.exe").is_file()) {
        Some(crate::windows_updater::Updater::start(installed_directory.as_ref().unwrap(),
            move |event| { let _ = update_proxy.send_event(UserEvent::Update(event)); }))
    } else { None };
    let update_error = updater_result.as_ref().and_then(|r|r.as_ref().err()).cloned();
    let mut updater = updater_result.and_then(Result::ok);
    let mut update_state = if update_error.is_some() { "error" } else { "idle" };
    let mut update_message = update_error;

    let webview_data = app.data.join("webview");

    let cancelled = Arc::new(AtomicBool::new(false));
    let cancel = cancelled.clone();
    let boot_proxy = proxy.clone();
    let emit_proxy = proxy.clone();
    // One pending notification and one latest bitmap: a blocked UI must never
    // build a queue of obsolete video samples alongside playback commands.
    let latest_glass = Arc::new(std::sync::Mutex::new(None::<Value>));
    let glass_output = latest_glass.clone();
    let options = platform::mpv_options(&surface);
    let renderer = surface.renderer();
    let display_renderer = renderer.clone();
    platform::on_display_change(move || display_renderer.refresh_display());
    let render_error = proxy.clone();
    let boot_log = log.clone();
    let backend_proxy = proxy.clone();
    let worker = std::thread::Builder::new()
        .name("navigator-startup".into())
        .spawn(move || {
            let result = (|| {
                let mut app = app;
                if let Some((resources, port)) = app.backend.take() {
                    record(&boot_log, started, "backend-starting");
                    app._server = Some(crate::server::Server::start_cancellable(
                        &resources, port, &cancel,
                    )?);
                }
                record(&boot_log, started, "backend-ready");
                if cancel.load(Ordering::Relaxed) {
                    return Err("Startup cancelled".into());
                }
                let _ = backend_proxy.send_event(UserEvent::BackendReady);
                let smoke = if app.smoke {
                    Some(crate::smoke_file()?)
                } else {
                    None
                };
                record(&boot_log, started, "player-starting");
                let color_renderer = renderer.clone();
                let mut player = match app.start_player_options(options, move |value| {
                    if value["type"] == "glass-frame" {
                        let notify = glass_output.lock().unwrap().replace(value).is_none();
                        if notify { let _ = emit_proxy.send_event(UserEvent::GlassFrame); }
                    } else {
                        let _ = emit_proxy.send_event(UserEvent::Emit(value));
                    }
                }, move |gamma, primaries| color_renderer.source_color(gamma, primaries)) {
                    Ok(player) => player,
                    Err(error) => {
                        if let Some(path) = &smoke {
                            let _ = std::fs::remove_file(path);
                        }
                        return Err(error);
                    }
                };
                if let Err(error) = renderer.start(player.mpv.clone(),player.glass_control(),move |message|{let _=render_error.send_event(UserEvent::RenderError(message));}) {player.begin_shutdown();player.join();return Err(error);}
                record(&boot_log, started, "player-ready");
                Ok((app, player, smoke))
            })();
            let _ = boot_proxy.send_event(UserEvent::Boot(Box::new(result)));
        })
        .map_err(|e| e.to_string())?;

    let mut context = None;
    let mut view: Option<WebView> = None;
    let mut running: Option<(App, Player, Option<PathBuf>)> = None;
    let mut closing = false;
    let mut glass_shared = crate::windows_glass::SharedGlass::new(frontend.origin.clone());
    let mut fullscreen = false;
    let mut remaximize = false;
    let mut ready = false;
    let mut loaded = false;
    let mut settings_pending = false;
    let mut ready_deadline = None;
    let mut navigating = false;
    let mut exit_code = 0;
    let mut smoke_playing = false;
    let mut playback_session = String::new();
    let mut playback_ready = false;
    let mut glass_ready = false;
    let mut pending = VecDeque::new();
    // Start Chromium while Node is starting, and paint bundled HTML that needs
    // neither the local server nor external data. Keep this WebView for the app.
    if !frontend.smoke {
        record(&log, started, "webview-starting");
        context = Some(WebContext::new(Some(webview_data)));
        match make_view(context.as_mut().unwrap(), &frontend, &window, &proxy) {
            Ok(webview) => {
                view = Some(webview);
                record(&log, started, "startup-view-created");
            }
            Err(error) => {
                exit_code = 1;
                closing = true;
                cancelled.store(true, Ordering::Relaxed);
                platform::show_error(&format!("WebView2 could not initialize: {error}"));
            }
        }
    }
    let last_update_error = update_settings.with_file_name("updates").join("last-error.txt");
    let failed_update = updater.is_some()
        && std::fs::read_to_string(&last_update_error).ok()
            .is_some_and(|error| error.lines().next() == Some(env!("CARGO_PKG_VERSION")));
    let install_error = "Couldn’t install the update. Try again from Settings.";
    if failed_update {
        update_state = "error";
        update_message = Some(install_error.into());
    }
    let mut next_update_probe = Instant::now();
    if failed_update {
        next_update_probe += crate::update_feed::next_probe_delay(true);
    }
    event_loop.run(move |event, _, flow| {
        let _settings_shortcut = &settings_shortcut;
        if !closing && automatic_updates && updater.is_some() && Instant::now() >= next_update_probe {
            let started = update_state != "checking" && updater.as_ref().unwrap().probe();
            next_update_probe = Instant::now() + crate::update_feed::next_probe_delay(started);
        }
        *flow = if closing || ready_deadline.is_some() { ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(16)) }
            else if automatic_updates && updater.is_some() { ControlFlow::WaitUntil(next_update_probe) }
            else { ControlFlow::Wait };
        match event {
            Event::UserEvent(UserEvent::RenderError(message)) => {
                if !closing {record(&log,started,"video-output-error");platform::show_error(&format!("The video device stopped responding: {message}. Restart Navigator."));}
                closing=true;cancelled.store(true,Ordering::Relaxed);
                if let Some((_,player,_))=&running {player.begin_shutdown();}
            }
            Event::UserEvent(UserEvent::Update(event)) => {
                use crate::windows_updater::Event as UpdateEvent;
                match event {
                    UpdateEvent::Shutdown => platform::request_close(&window),
                    UpdateEvent::ProbeAvailable if automatic_updates && update_state != "checking" => { update_state = "available"; update_message = None; }
                    UpdateEvent::ProbeCurrent if automatic_updates && update_state != "checking" => { update_state = "current"; update_message = None; }
                    UpdateEvent::ProbeAvailable | UpdateEvent::ProbeCurrent | UpdateEvent::ProbeError => {}
                    UpdateEvent::Available => { update_state = "available"; update_message = None; }
                    UpdateEvent::Downloading => { update_state = "downloading"; update_message = None; }
                    UpdateEvent::Ready => { update_state = "ready"; update_message = None; }
                    UpdateEvent::Current => { update_state = "current"; update_message = None; }
                    UpdateEvent::Error => { update_state = "error"; update_message = Some("Couldn’t check or download the update. Try again later.".into()); }
                    UpdateEvent::InstallError => { update_state = "error"; update_message = Some(install_error.into()); }
                    UpdateEvent::Dismissed => { if update_state == "checking" { update_state = "idle"; } }
                }
                if let Some(view) = &view { let _ = view.evaluate_script(&receive(&json!({"type":"update-status", "version":env!("CARGO_PKG_VERSION"), "available":updater.is_some(), "automatic":automatic_updates, "state":update_state, "message":update_message}))); }
            }
            Event::UserEvent(UserEvent::ClientStage(stage)) => record(&log, started, stage.label()),
            Event::UserEvent(UserEvent::BackendReady) => {
                if !closing && !frontend.smoke {
                    if let Some(view) = &view {
                        navigating = true;
                        record(&log, started, "navigation-starting");
                        if let Err(error) = view.load_url(&frontend.url) {
                            exit_code = 1; closing = true; cancelled.store(true, Ordering::Relaxed);
                            platform::show_error(&format!("The interface could not open: {error}"));
                        }
                        ready_deadline = Some(Instant::now() + Duration::from_secs(30));
                    }
                }
            }
            Event::UserEvent(UserEvent::Command(command, session)) => {
                if !closing {
                    media_session.observe_command(&command);
                    if let Some(controls) = &mut media_controls { controls.sync(media_session.now_playing()); }
                    if matches!(command, protocol::Command::MediaMetadata { .. }) { return; }
                    if matches!(&command, protocol::Command::UpdateStatus {} | protocol::Command::UpdateCheck {} | protocol::Command::UpdateAutomatic { .. }) {
                        if let Some(updater) = &updater {
                            match command {
                                protocol::Command::UpdateCheck {} => { if update_state != "checking" { update_state = "checking"; update_message = None; updater.check(); } }
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
                        if let Some(view) = &view { let _ = view.evaluate_script(&receive(&json!({"type":"update-status", "version":env!("CARGO_PKG_VERSION"), "available":updater.is_some(), "automatic":automatic_updates, "state":update_state, "message":update_message}))); }
                    } else if let protocol::Command::WindowControlsVisible { visible } = &command {
                        platform::set_window_controls_visible(*visible);
                    } else if let protocol::Command::NativeHdrPeak { nits } = &command {
                        surface.renderer().set_hdr_peak(*nits);
                    } else {
                    if let protocol::Command::Load { session, .. } = &command {
                        playback_session = session.clone();
                        playback_ready = false;
                        glass_ready = false;
                        record(&log, started, "playback-load-received");
                    } else if matches!(&command, protocol::Command::Seek { .. }) {
                        record(&log, started, "playback-seek-requested");
                    }
                    if let Some((_, player, _)) = &running { player.send(command); }
                    else if pending.len() < 64 { pending.push_back(command); }
                    else {
                        if let Some(view) = &view { let _ = view.evaluate_script(&receive(&json!({"type":"error","session":session,"message":"The video player is still starting. Try playback again in a moment."}))); }
                    }
                    }
                }
            }
            Event::UserEvent(UserEvent::Boot(result)) => match *result {
                Ok((app, player, smoke_path)) => {
                    if closing { player.begin_shutdown(); }
                    running = Some((app, player, smoke_path));
                    if !closing {
                        let (app, player, _) = running.as_ref().unwrap();
                        surface.attach(player.mpv.clone());
                        let size = window.inner_size();
                        surface.resize(size.width, size.height);
                        for command in pending.drain(..) { player.send(command); }
                        if app.smoke {
                        context = Some(WebContext::new(Some(app.data.join("webview"))));
                        match make_view(context.as_mut().unwrap(), &frontend, &window, &proxy) {
                            Ok(webview) => {
                                view = Some(webview);
                                if let Some(loading) = &loading { let size = window.inner_size(); loading.resize(size.width, size.height); }
                                record(&log, started, "webview-created");
                                ready_deadline = Some(Instant::now() + Duration::from_secs(30));
                            }
                            Err(error) => {
                                exit_code = 1;
                                platform::show_error(&format!("WebView2 could not initialize: {error}"));
                                closing = true; player.begin_shutdown();
                            }
                        }
                        }
                    }
                }
                Err(message) => {
                    exit_code = 1;
                    if !closing { record(&log, started, "startup-error"); platform::show_error(&message); }
                    closing = true;
                }
            },
            Event::UserEvent(UserEvent::Ready(dark)) => {
                window.set_theme(Some(if dark { Theme::Dark } else { Theme::Light }));
                if let Some(view) = &view { let _ = view.evaluate_script(&receive(&json!({"type":"window-state","maximized":window.is_maximized()}))); }
                if !ready { ready = true; ready_deadline = None; loading.take(); record(&log, started, "app-ready"); }
            }
            Event::UserEvent(UserEvent::StartupLoaded) => {
                platform::install_chrome(&window);
                record(&log, started, "startup-page-loaded");
            }
            Event::UserEvent(UserEvent::PageLoaded) => {
                glass_shared = crate::windows_glass::SharedGlass::new(frontend.origin.clone());
                loaded = true;
                platform::install_chrome(&window);
                record(&log, started, "page-loaded");
                if let Some((app, player, smoke)) = &running {
                    if app.smoke {

                        loading.take(); ready_deadline = None;
                        if let Some(path) = smoke { player.send(protocol::Command::Load { session:"native-smoke".into(), url:path.to_string_lossy().into_owned(), headers:Default::default(), start_position: 0.0 }); }
                    }
                }
                if let Some(view) = &view {
                    let _ = view.evaluate_script(&receive(&json!({"type":"fullscreen","value":fullscreen})));
                    let _ = view.evaluate_script(&receive(&json!({"type":"window-active","value":window.is_focused()})));
                    if std::mem::take(&mut settings_pending) {
                        let _ = view.evaluate_script(&receive(&json!({"type":"open-settings"})));
                    }
                }
            }
            Event::UserEvent(UserEvent::GlassConsumed(slot, sequence)) => {
                glass_shared.consumed(slot, sequence);
                if !closing { if let (Some(view),Some((_,player,_))) = (&view,&running) {
                    if let Err(error)=glass_shared.flush(view,&player.glass_control()) {log::warn!("Shared glass: {error}");}
                }}
            }
            Event::UserEvent(UserEvent::GlassFrame) => {
                latest_glass.lock().unwrap().take();
                if !closing { if let (Some(view), Some((_,player,_)))=(&view,&running) {
                    if let Some(frame)=player.glass_control().take() {
                        if !glass_ready {glass_ready=true;record(&log,started,"glass-sample-ready");}
                        glass_shared.offer(frame);
                        if let Err(error)=glass_shared.flush(view,&player.glass_control()) {log::warn!("Shared glass: {error}");}
                    }
                }}
            }
            Event::UserEvent(UserEvent::Emit(value)) => {
                media_session.observe_event(&value);
                if let Some(controls) = &mut media_controls { controls.sync(media_session.now_playing()); }
                if !playback_session.is_empty() && value["session"].as_str() == Some(playback_session.as_str()) {
                    match value["type"].as_str() {
                        Some("loading") => record(&log, started, "playback-open-started"),
                        Some("loaded") => record(&log, started, "playback-file-loaded"),
                        Some("ready") if !playback_ready => {
                            playback_ready = true;
                            record(&log, started, "playback-ready");
                        }
                        Some("glass-frame") if !glass_ready => { glass_ready = true; record(&log, started, "glass-sample-ready"); }
                        Some("error") => record(&log, started, "playback-error"),
                        _ => {}
                    }
                }
                if !smoke_playing && running.as_ref().is_some_and(|(app, _, _)| app.smoke)
                    && value["type"] == "state" && value["state"]["width"].as_f64().unwrap_or(0.0) > 0.0
                    && value["state"]["position"].as_f64().unwrap_or(0.0) > 0.2 {
                    smoke_playing = true; record(&log, started, "smoke-playing");
                }
                if let Some(view) = &view { let _ = view.evaluate_script(&receive(&value)); }
            }
            Event::UserEvent(UserEvent::Fullscreen(value)) => {
                set_fullscreen(&window, value, &mut remaximize);
                record(&log, started, if value { "fullscreen-entered" } else { "fullscreen-exited" });
            }
            Event::UserEvent(UserEvent::ToggleFullscreen) => {
                set_fullscreen(&window, window.fullscreen().is_none(), &mut remaximize);
            }
            Event::UserEvent(UserEvent::ChromeHover(hit)) => {
                let name = match hit { 8 => "minimize", 9 => "maximize", 20 => "close", _ => "" };
                if let Some(view) = &view { let _ = view.evaluate_script(&format!("document.documentElement.dataset.windowControlHover={}", json!(name))); }
            }
            Event::UserEvent(UserEvent::ChromeActivation(active)) => {
                if let Some(view) = &view { let _ = view.evaluate_script(&receive(&json!({"type":"window-active","value":active}))); }
            }
            Event::UserEvent(UserEvent::OpenSettings) if !closing => {
                window.set_minimized(false);
                window.set_focus();
                if let Some(view) = view.as_ref().filter(|_| loaded) {
                    let _ = view.evaluate_script(&receive(&json!({"type":"open-settings"})));
                } else { settings_pending = true; }
            }
            Event::UserEvent(UserEvent::SystemMedia(action)) if !closing => {
                if let (Some((_, player, _)), Some(command)) = (&running, media_session.command(action)) {
                    player.send(command);
                }
            }
            Event::UserEvent(UserEvent::WindowControl(action)) => match action {
                protocol::WindowAction::Minimize => window.set_minimized(true),
                protocol::WindowAction::ToggleMaximize => set_fullscreen(&window, window.fullscreen().is_none(), &mut remaximize),
                protocol::WindowAction::Close => platform::request_close(&window),
            },
            Event::UserEvent(UserEvent::TitlebarPress { double_click }) if !fullscreen => {
                if double_click {
                    window.set_maximized(!window.is_maximized());
                } else {
                    let _ = window.drag_window();
                }
            }
            Event::WindowEvent { event: WindowEvent::KeyboardInput { event: key, is_synthetic: false, .. }, .. }
                if key.state == tao::event::ElementState::Pressed && !key.repeat
                    && (key.physical_key == tao::keyboard::KeyCode::F11
                        || (key.physical_key == tao::keyboard::KeyCode::Escape && fullscreen)) => {
                set_fullscreen(&window, window.fullscreen().is_none(), &mut remaximize);
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                if let Some(normal) = &mut normal {
                    if window.fullscreen().is_none() { normal.maximized = window.is_maximized(); }
                    normal.save(&state_path);
                }
                media_controls.take();
                closing = true; cancelled.store(true, Ordering::Relaxed); window.set_visible(false);
                if let Some((_, player, _)) = &running { player.begin_shutdown(); }
            }
            Event::WindowEvent { event: WindowEvent::Resized(size), .. } => {
                resize_views(&surface, view.as_ref(), loading.as_ref(), size);
                if let Some((_, player, _)) = &running { player.glass_resized(); }
                if let Some(view) = &view { let _ = view.evaluate_script(&receive(&json!({"type":"window-state","maximized":window.is_maximized()}))); }
                remember_placement(&window, &mut normal);
            }
            Event::WindowEvent { event: WindowEvent::ScaleFactorChanged { new_inner_size, .. }, .. } => {
                resize_views(&surface, view.as_ref(), loading.as_ref(), *new_inner_size);
            }
            Event::WindowEvent { event: WindowEvent::Moved(_), .. } => {
                // Moving a window doesn't resize either GPU surface.
                surface.refresh_display();
                remember_placement(&window, &mut normal);
            }
            _ => {}
        }
        if let Some((_, player, _)) = &running { player.glass_visible(!window.is_minimized()); }
        surface.visible(!window.is_minimized());
        let actual = window.fullscreen().is_some();
        platform::set_chrome_fullscreen(actual);
        if actual != fullscreen {
            fullscreen = actual;
            if let Some(view) = &view { let _ = view.evaluate_script(&receive(&json!({"type":"fullscreen","value":actual}))); }
        }
        // Chromium can pause requestAnimationFrame while minimized. Give a
        // restored window a fresh paint deadline instead of reporting a false
        // startup failure, and leave the event loop asleep while minimized.
        if !ready && !closing && navigating && !frontend.smoke {
            if window.is_minimized() { ready_deadline = None; }
            else if ready_deadline.is_none() { ready_deadline = Some(Instant::now() + Duration::from_secs(30)); }
        }
        if ready_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            exit_code = 1;
            ready_deadline = None; loading.take(); record(&log, started, "app-ready-timeout");
            platform::show_error(if loaded { "The interface loaded but did not become interactive. Restart Navigator." } else { "The local interface did not finish loading. Restart Navigator and check startup.jsonl in your local Navigator Desktop data folder." });
            closing = true;
            if let Some((_, player, _)) = &running { player.begin_shutdown(); }
        }
        if closing && worker.is_finished() && running.as_ref().is_none_or(|(_, p, _)| p.finished()) {
            // DXGI destroys window-associated resources on the render thread.
            // Keep pumping HWND messages until that thread has actually exited.
            surface.begin_shutdown();
            if !surface.finished() {*flow=ControlFlow::WaitUntil(Instant::now()+Duration::from_millis(16));return;}
            // Dispose the WebView before its context/profile and backend.
            drop(updater.take());
            view.take(); context.take();
            if let Some((mut app, mut player, smoke)) = running.take() {
                surface.shutdown(); player.join(); drop(app._server.take());
                if let Some(path) = smoke { let _ = std::fs::remove_file(path); }
            }
            record(&log, started, "closed");
            *flow = ControlFlow::ExitWithCode(exit_code);
        } else if closing || ready_deadline.is_some() {
            // A transition above may have started shutdown or a deadline while
            // this iteration began in Wait. Keep pumping without another input.
            *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(16));
        }
    });
}
