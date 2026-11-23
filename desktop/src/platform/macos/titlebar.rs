use objc2_app_kit::NSWindow;
use objc2_foundation::{NSRect, NSUserDefaults, ns_string};
use tao::platform::macos::WindowExtMacOS;
use tao::window::Window;

#[derive(Default)]
pub struct TitlebarAction {
    fill_frames: Option<(NSRect, NSRect)>,
}

impl TitlebarAction {
    pub fn double_click(&mut self, window: &Window) {
        // SAFETY: Tao owns the live window and delivers this action on its main thread.
        let native = unsafe { &*window.ns_window().cast::<NSWindow>() };
        let preference = NSUserDefaults::standardUserDefaults()
            .stringForKey(ns_string!("AppleActionOnDoubleClick"))
            .map(|value| value.to_string());
        match preference.as_deref() {
            Some("Fill") => {
                let Some(screen) = native.screen() else { return };
                let current = native.frame();
                let target = screen.visibleFrame();
                // Restore only while the window is still in the frame we set.
                if let Some((filled, previous)) = self.fill_frames.take()
                    && current == filled
                {
                    native.setFrame_display_animate(previous, true, true);
                } else if current != target {
                    native.setFrame_display_animate(target, true, true);
                    self.fill_frames = Some((native.frame(), current));
                }
            }
            Some("Minimize") => native.performMiniaturize(None),
            None | Some("Maximize") => {
                self.fill_frames = None;
                native.performZoom(None);
            }
            _ => {}
        }
    }
}
