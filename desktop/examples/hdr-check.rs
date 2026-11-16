//! Native HDR integration check with local pq.mkv/hlg.mkv/sdr.mkv fixtures.
//! No backend, WebView, account, or saved Navigator profile is used.
#![allow(dead_code)]
#[cfg(target_os = "macos")]
#[path = "../src/media_cache.rs"]
mod media_cache;
#[cfg(target_os = "macos")]
#[path = "../src/frame_schedule.rs"]
mod frame_schedule;
#[cfg(target_os = "macos")]
#[path = "../src/hdr.rs"]
mod hdr;
#[cfg(target_os = "macos")]
#[path = "../src/mpv.rs"]
mod mpv;
#[cfg(target_os = "macos")]
#[path = "../src/platform/mod.rs"]
mod platform;
#[cfg(target_os = "macos")]
#[path = "../src/player.rs"]
mod player;
#[cfg(target_os = "macos")]
#[path = "../src/protocol.rs"]
mod protocol;
#[cfg(target_os = "macos")]
#[path = "../src/render.rs"]
mod render;

#[cfg(target_os = "macos")]
#[path = "../src/thumbnails.rs"]
mod thumbnails;
#[cfg(target_os = "macos")]
#[path = "../src/thumbnail_images.rs"]
mod thumbnail_images;

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("The native HDR check requires macOS.");
}

#[cfg(target_os = "macos")]
fn main() {
    use std::{
        path::PathBuf,
        sync::Arc,
        time::{Duration, Instant},
    };
    use tao::{
        event::{Event, WindowEvent},
        event_loop::{ControlFlow, EventLoopBuilder},
        window::{Fullscreen, WindowBuilder},
    };
    let _ = env_logger::try_init();
    let args: Vec<_> = std::env::args_os().collect();
    assert_eq!(
        args.len(),
        3,
        "Usage: hdr-check /path/libmpv.2.dylib /path/fixture-directory"
    );
    let directory = PathBuf::from(&args[2]);
    let events = EventLoopBuilder::<()>::with_user_event().build();
    let window = WindowBuilder::new()
        .with_title("Navigator HDR integration check")
        .build(&events)
        .unwrap();
    let surface = platform::VideoSurface::new(&window).unwrap();
    let options = platform::mpv_options(&surface);
    let mut options: Vec<_> = options.iter().map(|(k, v)| (*k, v.as_str())).collect();
    options.extend([
        ("config", "no"),
        ("idle", "yes"),
        ("ao", "null"),
        ("terminal", "no"),
        ("loop-file", "inf"),
    ]);
    let mpv = Arc::new(mpv::Mpv::new(std::path::Path::new(&args[1]), &options).unwrap());
    let mut player = player::Player::start(mpv.clone(), |_| {}, platform::update_hdr).unwrap();
    surface.attach(mpv);
    assert_eq!(
        surface.output_colorspace().as_deref(),
        Some("kCGColorSpaceSRGB"),
        "Startup SDR must have an explicit, matching color space"
    );
    surface.resize(window.inner_size().width, window.inner_size().height);
    let stages = [
        ("sdr", false),
        ("pq", true),
        ("sdr", false),
        ("hlg", true),
        ("sdr", false),
        ("pq", true),
        ("sdr", false),
    ];
    let mut stage = 0;
    let mut started = Instant::now();
    let mut closing = false;
    let mut fullscreen = false;
    let load = move |index: usize, player: &player::Player| {
        player.send(protocol::Command::Load {
            session: stages[index].0.into(),
            url: directory
                .join(format!("{}.mkv", stages[index].0))
                .to_string_lossy()
                .into_owned(),
            headers: Default::default(),
            start_position: 0.0,
        });
    };
    load(0, &player);
    events.run(move |event, _, flow| {
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(50));
        if let Event::WindowEvent {
            event: WindowEvent::Resized(size),
            ..
        } = event
        {
            surface.resize(size.width, size.height);
            surface.refresh_hdr();
        }
        if matches!(&event, Event::WindowEvent { event: WindowEvent::Moved(_) | WindowEvent::Focused(true) | WindowEvent::ScaleFactorChanged { .. }, .. }) {
            surface.refresh_hdr();
        }
        let actual = window.fullscreen().is_some();
        if actual != fullscreen { fullscreen = actual; surface.refresh_hdr(); }
        if closing {
            if player.finished() {
                surface.shutdown();
                player.join();
                *flow = ControlFlow::Exit;
            }
            return;
        }
        if started.elapsed() > Duration::from_secs(2) {
            let (float, potential, active, configured) = surface.hdr_diagnostics();
            println!("CHECK: {} float={float} display-headroom={potential:.2} hdr={active} configured={configured}", stages[stage].0);
            let expected = stages[stage].1 && float && potential > 1.0;
            assert_eq!(
                active, expected,
                "{}: native EDR flag mismatch",
                stages[stage].0
            );
            assert_eq!(
                configured, expected,
                "{}: PQ colorspace/target mismatch",
                stages[stage].0
            );
            if !expected {
                assert_eq!(surface.output_colorspace().as_deref(), Some("kCGColorSpaceSRGB"), "SDR must restore an explicit sRGB layer after HDR");
            }
            println!(
                "PASS: {} float={float} display-headroom={potential:.2} hdr={active}",
                stages[stage].0
            );
            stage += 1;
            if stage == stages.len() {
                closing = true;
                player.begin_shutdown();
            } else {
                // Exercise the same layer across HDR/SDR changes and fullscreen.
                window.set_fullscreen((stage == 2).then_some(Fullscreen::Borderless(None)));
                surface.refresh_hdr();
                load(stage, &player);
                started = Instant::now();
            }
        }
    });
}
