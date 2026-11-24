use crate::{
    App, desktop_media, platform, protocol, receive,
    window_state::{Display, Placement},
};
use serde_json::{Value, json};
use std::rc::Rc;
use std::time::{Duration, Instant};
use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::{Fullscreen, Window, WindowBuilder};
#[cfg(target_os = "macos")]
use tao::{dpi::LogicalPosition, platform::macos::WindowBuilderExtMacOS};
use wry::{NewWindowResponse, WebContext, WebViewBuilder};

enum UserEvent {
    Emit(Value),
    Update(crate::macos_updater::Event),
    UpdateCommand(protocol::Command),
    Fullscreen(bool),
    WindowControlsVisible(bool),
    #[cfg(target_os = "macos")]
    NativeHdrPeak(Option<u32>),
    TitlebarPress { double_click: bool },
    Close,
    OpenSettings,
    PlaybackCommand(protocol::Command),
    SystemMedia(desktop_media::Action),
    SystemArtwork(String, Vec<u8>),
    SyncFullscreen,
}

fn placement(window: &Window) -> Option<Placement> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().to_logical::<f64>(window.scale_factor());
    Some(Placement { x: position.x, y: position.y, width: size.width, height: size.height, maximized: false })
}

fn defer_window_action(window: &Rc<Window>, action: impl FnOnce(&Window) + Send + 'static) {
    use dispatch2::{DispatchQueue, MainThreadBound};
    use objc2::MainThreadMarker;
    let mtm = MainThreadMarker::new().expect("window events run on the AppKit thread");
    let window = MainThreadBound::new(Rc::downgrade(window), mtm);
    // Showing or hiding a window can synchronously redraw while Tao holds its callback lock.
    DispatchQueue::main().exec_async(move || {
        let mtm = MainThreadMarker::new().expect("the main queue runs on the AppKit thread");
        if let Some(window) = window.into_inner(mtm).upgrade() { action(&window); }
    });
}

fn reveal_window(window: &Window) {
    window.set_minimized(false);
    // Tao's set_focus does nothing after AppKit has ordered the window out.
    if !window.is_visible() {
        window.set_visible(true);
    }
    window.set_focus();
}

pub fn run(mut app: App) -> Result<(), String> {
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    #[cfg(target_os = "macos")]
    let menu = platform::install_menu({
        let proxy = proxy.clone();
        move |action| {
            let _ = proxy.send_event(match action {
                platform::MenuAction::Settings => UserEvent::OpenSettings,
                platform::MenuAction::Quit => UserEvent::Close,
            });
        }
    })?;
    let settings_shortcut = (!app.smoke).then(|| crate::desktop_shortcut::settings({
        let proxy = proxy.clone();
        move || { let _ = proxy.send_event(UserEvent::OpenSettings); }
    })).flatten();
    let state_path = app.data.join("window.json");
    let displays: Vec<_> = event_loop.available_monitors().map(|monitor| Display {
        x: monitor.position().x, y: monitor.position().y,
        width: monitor.size().width, height: monitor.size().height, scale: monitor.scale_factor(),
    }).collect();
    let saved = (!app.smoke).then(|| std::fs::read(&state_path).ok())
        .flatten().and_then(|bytes| serde_json::from_slice::<Placement>(&bytes).ok())
        .and_then(|placement| placement.restore(&displays));
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
    let builder = if let Some(saved) = saved {
        builder.with_position(PhysicalPosition::new(saved.x, saved.y))
            .with_inner_size(LogicalSize::new(saved.width.max(720.0), saved.height.max(480.0)))
    } else { builder };
    let window = Rc::new(builder.build(&event_loop).map_err(|e| e.to_string())?);
    let mut normal = placement(&window);
    let mut media_session = desktop_media::Session::default();
    let mut media_controls = (!app.smoke).then(|| desktop_media::Controls::new({
        let proxy = proxy.clone();
        move |action| { let _ = proxy.send_event(UserEvent::SystemMedia(action)); }
    }, {
        let proxy = proxy.clone();
        move |url, bytes| { let _ = proxy.send_event(UserEvent::SystemArtwork(url, bytes)); }
    }));
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
                #[cfg(target_os = "macos")]
                Ok(protocol::Command::NativeHdrPeak { nits }) => {
                    let _ = ipc_proxy.send_event(UserEvent::NativeHdrPeak(nits));
                }
                Ok(protocol::Command::WindowDrag { double_click }) => {
                    let _ = ipc_proxy.send_event(UserEvent::TitlebarPress { double_click });
                }
                Ok(
                    command @ (protocol::Command::UpdateStatus {}
                    | protocol::Command::UpdateCheck { .. }
                    | protocol::Command::UpdateAutomatic { .. }),
                ) => {
                    let _ = ipc_proxy.send_event(UserEvent::UpdateCommand(command));
                }
                Ok(command) => {
                    let _ = ipc_proxy.send_event(UserEvent::PlaybackCommand(command));
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
                let allowed = (smoke && url == "about:blank")
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
            move |event, _| {
                if let wry::PageLoadEvent::Finished = event {
                    let _ = proxy.send_event(UserEvent::SyncFullscreen);
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
    } else {
        builder.with_url(&app.url)
    };
    let webview = platform::webview::build_window_webview(builder, &window)
        .map_err(|error| error.to_string())?;
    surface.resize(window.inner_size().width, window.inner_size().height);
    let update_settings = app.data.join("update-checks.json");
    let mut automatic_updates = std::fs::read(&update_settings)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<bool>(&bytes).ok())
        .unwrap_or(true);
    let update_proxy = proxy.clone();
    let updater_result = if !app.smoke && app._server.is_some() {
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
    let mut next_update_version = None;
    let mut installing = false;
    let mut closing = false;
    let mut fullscreen = false;
    let mut hide_after_fullscreen = false;
    let mut loaded = false;
    let mut settings_pending = false;
    let mut window_controls_visible = true;
    let titlebar_action = Rc::new(platform::TitlebarAction::default());
    let mut next_update_probe = Instant::now();
    event_loop.run(move |event, _, flow| {
        let _settings_shortcut = &settings_shortcut;
        let save_window = |normal: &Option<Placement>| {
            if !app.smoke && let Some(normal) = normal { normal.save(&state_path); }
        };
        // AppKit/Dock quit can destroy the loop without a CloseRequested event.
        // Stop the owned backend here rather than relying on process-exit drops.
        if matches!(&event, Event::LoopDestroyed) {
            save_window(&normal);
            media_controls.take();
            if !installing { if let Some(updater) = &updater { updater.cancel_pending_install(); } }
            drop(app._server.take());
            return;
        }
        // Sparkle now owns termination. Do not resize or refresh a video
        // surface that was released before the installation handoff.
        if installing {
            // The installer is ready before it asks AppKit to quit. Our custom
            // Cmd-Q menu sends Close, so it must remain live after the handoff.
            let update = match &event {
                Event::UserEvent(UserEvent::Update(event)) => Some(event.clone()),
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
        if !closing && automatic_updates && updater.is_some() && Instant::now() >= next_update_probe {
            let started = update_state != "checking" && updater.as_ref().unwrap().probe();
            next_update_probe = Instant::now() + crate::update_feed::next_probe_delay(started);
        }
        *flow = if closing && !installing {
            ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(16))
        } else if automatic_updates && updater.is_some() {
            ControlFlow::WaitUntil(next_update_probe)
        } else {
            ControlFlow::Wait
        };
        if closing && !installing && player.finished() && updater.as_ref().is_none_or(|updater| updater.can_close()) {
            media_controls.take();
            surface.shutdown();
            player.join();
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
            Event::UserEvent(UserEvent::Update(event)) => {
                use crate::macos_updater::Event as UpdateEvent;
                match event {
                    UpdateEvent::Available(version) => { update_state = "available"; update_message = None; next_update_version = version; }
                    UpdateEvent::Downloading(version) => { update_state = "downloading"; update_message = None; next_update_version = version; }
                    UpdateEvent::Ready(version) => { update_state = "ready"; update_message = None; next_update_version = version; }
                    UpdateEvent::Current => { update_state = "current"; update_message = None; next_update_version = None; }
                    UpdateEvent::Error => { update_state = "error"; update_message = Some("Couldn’t check or download the update. Try again later.".into()); }
                    UpdateEvent::Finished => { if update_state == "checking" { update_state = "idle"; next_update_version = None; } }
                    UpdateEvent::Install => { update_state = "installing"; closing = true; player.begin_shutdown(); }
                    UpdateEvent::Relaunch => { closing = true; player.begin_shutdown(); }
                }
                let _ = webview.evaluate_script(&receive(&json!({"type":"update-status", "version":env!("CARGO_PKG_VERSION"), "nextVersion":next_update_version, "available":updater.is_some(), "automatic":automatic_updates, "state":update_state, "message":update_message})));
            }
            Event::UserEvent(UserEvent::UpdateCommand(command)) if !closing => {
                if let Some(updater) = &updater {
                    match command {
                        protocol::Command::UpdateCheck { intent } => {
                            use protocol::UpdateIntent;
                            match UpdateIntent::for_state(intent, update_state) {
                                Some(UpdateIntent::Prepare) => {
                                    update_state = "checking";
                                    update_message = None;
                                    updater.check();
                                }
                                Some(UpdateIntent::Install) => {
                                    if updater.install() { update_state = "installing"; }
                                    else {
                                        update_state = "error";
                                        update_message = Some("The update is no longer ready. Check for updates again.".into());
                                    }
                                }
                                None => {}
                            }
                        }
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
                let _ = webview.evaluate_script(&receive(&json!({"type":"update-status", "version":env!("CARGO_PKG_VERSION"), "nextVersion":next_update_version, "available":updater.is_some(), "automatic":automatic_updates, "state":update_state, "message":update_message})));
            }
            Event::UserEvent(UserEvent::Emit(value)) => {
                media_session.observe_event(&value);
                if let Some(controls) = &mut media_controls { controls.sync(media_session.now_playing()); }
                let _ = webview.evaluate_script(&receive(&value));
            }
            Event::UserEvent(UserEvent::PlaybackCommand(command)) if !closing => {
                media_session.observe_command(&command);
                if let Some(controls) = &mut media_controls { controls.sync(media_session.now_playing()); }
                if !matches!(command, protocol::Command::MediaMetadata { .. }) { player.send(command); }
            }
            Event::UserEvent(UserEvent::SystemMedia(action)) if !closing => {
                if let Some(command) = media_session.command(action) { player.send(command); }
            }
            Event::UserEvent(UserEvent::SystemArtwork(url, bytes)) if !closing => {
                if let Some(controls) = &mut media_controls { controls.receive_artwork(url, bytes); }
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
            #[cfg(target_os = "macos")]
            Event::UserEvent(UserEvent::NativeHdrPeak(nits)) => platform::set_hdr_peak(nits),
            Event::UserEvent(UserEvent::TitlebarPress { double_click }) if !closing => {
                if window.fullscreen().is_none() {
                    if double_click {
                        titlebar_action.double_click(&window);
                    } else {
                        let _ = window.drag_window();
                    }
                }
            }
            Event::UserEvent(UserEvent::SyncFullscreen) => {
                loaded = true;
                if std::mem::take(&mut settings_pending) {
                    let _ = webview.evaluate_script(&receive(&json!({"type":"open-settings"})));
                }
                // A document reload must not leave playback-only chrome hidden.
                window_controls_visible = true;
                #[cfg(target_os = "macos")]
                platform::set_window_controls_visible(&window, true);
                let _ = webview.evaluate_script(&receive(
                    &json!({"type":"fullscreen","value":window.fullscreen().is_some()}),
                ));
            }
            Event::UserEvent(UserEvent::Close) => {
                save_window(&normal);
                if let Some(updater) = &updater { updater.cancel_pending_install(); }
                closing = true;
                player.begin_shutdown();
            }
            Event::UserEvent(UserEvent::OpenSettings) if !closing => {
                hide_after_fullscreen = false;
                defer_window_action(&window, reveal_window);
                if loaded { let _ = webview.evaluate_script(&receive(&json!({"type":"open-settings"}))); }
                else { settings_pending = true; }
            }
            // AppKit can count another window, such as About, as visible.
            Event::Reopen { has_visible_windows, .. }
                if !closing
                    && (!has_visible_windows
                        || hide_after_fullscreen
                        || !window.is_visible()
                        || window.is_minimized()) =>
            {
                hide_after_fullscreen = false;
                defer_window_action(&window, reveal_window);
            }
            Event::WindowEvent {
                event: WindowEvent::Resized(size),
                ..
            } => {
                surface.resize(size.width, size.height);
                #[cfg(target_os = "macos")]
                surface.refresh_hdr();
                if !fullscreen && window.fullscreen().is_none() && window.is_visible() { normal = placement(&window); }
            }
            Event::WindowEvent {
                event: WindowEvent::ScaleFactorChanged { new_inner_size, .. },
                ..
            } => {
                surface.resize(new_inner_size.width, new_inner_size.height);
                #[cfg(target_os = "macos")]
                surface.refresh_hdr();
                if !fullscreen && window.fullscreen().is_none() && window.is_visible() { normal = placement(&window); }
            }
            Event::WindowEvent {
                event: WindowEvent::Moved(_) | WindowEvent::Focused(true),
                ..
            } => {
                #[cfg(target_os = "macos")]
                surface.refresh_hdr();
                if !fullscreen && window.fullscreen().is_none() && window.is_visible() && !window.is_minimized() {
                    normal = placement(&window);
                }
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                save_window(&normal);
                if app.smoke {
                    closing = true;
                    player.begin_shutdown();
                } else if !closing {
                    let _ = webview.evaluate_script(&receive(&json!({"type":"close-player"})));
                    if let Some(command) = media_session.pause_for_close() { player.send(command); }
                    media_session.clear();
                    if let Some(controls) = &mut media_controls { controls.sync(None); }
                    if fullscreen || window.fullscreen().is_some() {
                        hide_after_fullscreen = true;
                        defer_window_action(&window, |window| window.set_fullscreen(None));
                    } else {
                        defer_window_action(&window, |window| window.set_visible(false));
                    }
                }
            }
            _ => {}
        }
        let actual = window.fullscreen().is_some();
        if fullscreen != actual {
            fullscreen = actual;
            if !actual && std::mem::take(&mut hide_after_fullscreen) {
                defer_window_action(&window, |window| window.set_visible(false));
            }
            #[cfg(target_os = "macos")]
            platform::set_window_controls_visible(&window, actual || window_controls_visible);
            #[cfg(target_os = "macos")]
            surface.refresh_hdr();
            let _ = webview.evaluate_script(&receive(&json!({"type":"fullscreen","value":actual})));
        }
    });
}
