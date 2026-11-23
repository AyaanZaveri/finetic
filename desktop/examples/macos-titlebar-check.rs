//! Exercises the production title-bar action from a running Tao event loop.

#[cfg(target_os = "macos")]
#[path = "../src/platform/macos/titlebar.rs"]
mod titlebar;

#[cfg(target_os = "macos")]
fn main() {
    use objc2_app_kit::{NSWindow, NSWindowStyleMask};
    use objc2_foundation::{NSUserDefaults, ns_string};
    use std::time::{Duration, Instant};
    use tao::dpi::{LogicalPosition, LogicalSize};
    use tao::event::{Event, StartCause};
    use tao::event_loop::{ControlFlow, EventLoopBuilder};
    use tao::platform::macos::{WindowBuilderExtMacOS, WindowExtMacOS};
    use tao::window::WindowBuilder;
    use titlebar::TitlebarAction;

    let preference = NSUserDefaults::standardUserDefaults()
        .stringForKey(ns_string!("AppleActionOnDoubleClick"))
        .expect("pass -AppleActionOnDoubleClick Fill or Maximize")
        .to_string();
    assert!(matches!(preference.as_str(), "Fill" | "Maximize"));

    let event_loop = EventLoopBuilder::<()>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title("Navigator title-bar regression test")
        .with_inner_size(LogicalSize::new(520.0, 360.0))
        .with_titlebar_transparent(true)
        .with_title_hidden(true)
        .with_fullsize_content_view(true)
        .with_traffic_light_inset(LogicalPosition::new(16.0, 30.0))
        .build(&event_loop)
        .expect("create a visible test window");

    // Tao holds the NSWindow for the lifetime of the test.
    let native = unsafe { &*window.ns_window().cast::<NSWindow>() };
    let initial = native.frame();
    let work_area = native.screen().expect("test runner has a screen").visibleFrame();
    assert_ne!(initial, work_area);
    let mut action = TitlebarAction::default();
    let mut restoring = false;

    // A timer on the event loop cannot fail the test if AppKit deadlocks it.
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(20));
        eprintln!("The macOS event loop did not complete the title-bar resize and restore");
        std::process::exit(1);
    });

    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(25));
        match event {
            Event::NewEvents(StartCause::Init) => proxy.send_event(()).unwrap(),
            Event::UserEvent(()) => {
                eprintln!("Running {preference} title-bar action (restoring: {restoring})");
                action.double_click(&window);
            }
            Event::MainEventsCleared => {
                let frame = native.frame();
                if restoring && frame == initial {
                    println!("PASS: {preference} restored the original window frame");
                    *flow = ControlFlow::Exit;
                } else if !restoring && frame != initial {
                    assert!(!native.styleMask().contains(NSWindowStyleMask::FullScreen));
                    if preference == "Fill" {
                        assert_eq!(frame, work_area);
                    }
                    println!("PASS: {preference} resized the window and the event loop responded");
                    restoring = true;
                    proxy.send_event(()).unwrap();
                }
            }
            _ => {}
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn main() {}
