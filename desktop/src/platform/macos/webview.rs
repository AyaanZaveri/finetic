use objc2_app_kit::NSAutoresizingMaskOptions;
use tao::window::Window;
use wry::{WebView, WebViewBuilder, WebViewExtMacOS};

pub fn build_window_webview(builder: WebViewBuilder<'_>, window: &Window) -> wry::Result<WebView> {
    // Keep Tao's content view and the native video view beneath WebKit. Wry's
    // child mode defaults to a fixed size, so opt into AppKit's resize pass.
    let webview = builder.build_as_child(window)?;
    let view = webview.webview();
    // SAFETY: The live window owns this content view and Wry just attached
    // the web view to it on the AppKit thread.
    let content = unsafe { view.superview() }.expect("Wry attached the child web view");
    view.setFrame(content.bounds());
    view.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    Ok(webview)
}
