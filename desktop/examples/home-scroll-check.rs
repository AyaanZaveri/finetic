//! Runs the isolated Home fixture in the same webview engines as Navigator.
#[cfg(target_os = "macos")]
#[path = "../src/platform/macos/webview.rs"]
mod macos_webview;

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn main() {
    use tao::dpi::LogicalSize;
    use tao::event::Event;
    use tao::event_loop::{ControlFlow, EventLoopBuilder};
    use tao::window::WindowBuilder;
    use wry::WebViewBuilder;

    let url = std::env::args()
        .nth(1)
        .expect("provide the local fixture URL");
    let event_loop = EventLoopBuilder::<String>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title("Navigator Home scroll check")
        .with_inner_size(LogicalSize::new(1024.0, 820.0))
        .build(&event_loop)
        .expect("create a fixture window");
    let builder = WebViewBuilder::new()
        .with_url(&url)
        .with_ipc_handler(move |request| {
            let _ = proxy.send_event(request.into_body());
        });
    #[cfg(target_os = "macos")]
    let webview = macos_webview::build_window_webview(builder, &window).expect("start WKWebView");
    #[cfg(target_os = "windows")]
    let webview = builder.build(&window).expect("start WebView2");

    event_loop.run(move |event, _, flow| {
        let _keep_alive = (&window, &webview);
        *flow = ControlFlow::Wait;
        if let Event::UserEvent(report) = event {
            println!("{report}");
            *flow = ControlFlow::Exit;
        }
    });
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn main() {}
