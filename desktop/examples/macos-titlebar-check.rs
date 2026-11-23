//! Exercises the production title-bar action from a running Tao event loop.

#[cfg(target_os = "macos")]
#[path = "../src/platform/macos/titlebar.rs"]
mod titlebar;

#[cfg(target_os = "macos")]
#[path = "../src/platform/macos/webview.rs"]
mod webview;

#[cfg(target_os = "macos")]
fn main() {
    use block2::RcBlock;
    use objc2_app_kit::{NSWindow, NSWindowDidResizeNotification, NSWindowStyleMask};
    use objc2_foundation::{NSNotificationCenter, NSUserDefaults, ns_string};
    use std::rc::Rc;
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    use std::time::{Duration, Instant};
    use tao::dpi::{LogicalPosition, LogicalSize};
    use tao::event::{Event, StartCause};
    use tao::event_loop::{ControlFlow, EventLoopBuilder};
    use tao::platform::macos::{WindowBuilderExtMacOS, WindowExtMacOS};
    use tao::window::WindowBuilder;
    use titlebar::TitlebarAction;
    use wry::{WebViewBuilder, WebViewExtMacOS};

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
    let window = Rc::new(window);

    // Tao holds the NSWindow for the lifetime of the test.
    let native = unsafe { &*window.ns_window().cast::<NSWindow>() };
    let initial = native.frame();
    let work_area = native
        .screen()
        .expect("test runner has a screen")
        .visibleFrame();
    assert_ne!(initial, work_area);
    let webview = webview::build_window_webview(WebViewBuilder::new(), &window)
        .expect("create a WebKit view in the test window");
    let view = webview.webview();
    let content = native.contentView().unwrap();
    let action = Rc::new(TitlebarAction::default());
    let mut restoring = false;
    let inside_callback = Arc::new(AtomicBool::new(false));
    let resized = Arc::new(AtomicBool::new(false));
    let check_resize = RcBlock::new({
        let inside_callback = inside_callback.clone();
        let resized = resized.clone();
        move |_| {
            // AppKit can redraw during a resize. A resize notification here can
            // precede a redraw that tries to reenter Tao's locked event handler.
            if inside_callback.load(Ordering::Relaxed) {
                eprintln!("AppKit resized the window inside Tao's title-bar callback");
                std::process::exit(1);
            }
            if view.frame() != content.bounds() {
                eprintln!("The WebKit view did not resize with the AppKit content view");
                std::process::exit(1);
            }
            resized.store(true, Ordering::Relaxed);
        }
    });
    // SAFETY: The name is AppKit's resize notification, the object is the live
    // test window, and AppKit posts the notification on the main thread.
    let _observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(NSWindowDidResizeNotification),
            Some(native),
            None,
            &check_resize,
        )
    };

    // A timer on the event loop cannot fail the test if AppKit deadlocks it.
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(20));
        eprintln!("The macOS event loop did not complete the title-bar resize and restore");
        std::process::exit(1);
    });

    event_loop.run(move |event, _, flow| {
        let _webview = &webview;
        *flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(25));
        match event {
            Event::NewEvents(StartCause::Init) => proxy.send_event(()).unwrap(),
            Event::UserEvent(()) => {
                eprintln!("Running {preference} title-bar action (restoring: {restoring})");
                resized.store(false, Ordering::Relaxed);
                inside_callback.store(true, Ordering::Relaxed);
                action.double_click(&window);
                inside_callback.store(false, Ordering::Relaxed);
            }
            Event::MainEventsCleared if resized.load(Ordering::Relaxed) => {
                let frame = native.frame();
                if restoring && frame == initial {
                    println!("PASS: {preference} restored the original window frame");
                    *flow = ControlFlow::Exit;
                } else if !restoring
                    && frame != initial
                    && (preference != "Fill" || frame == work_area)
                {
                    assert!(!native.styleMask().contains(NSWindowStyleMask::FullScreen));
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
