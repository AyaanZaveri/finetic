use dispatch2::{DispatchQueue, MainThreadBound};
use objc2::MainThreadMarker;
use objc2_app_kit::NSWindow;
use objc2_foundation::{NSRect, NSUserDefaults, ns_string};
use std::cell::Cell;
use std::rc::Rc;
use tao::platform::macos::WindowExtMacOS;
use tao::window::Window;

#[derive(Default)]
pub struct TitlebarAction {
    fill_frames: Cell<Option<(NSRect, NSRect)>>,
}

impl TitlebarAction {
    pub fn double_click(self: &Rc<Self>, window: &Rc<Window>) {
        let mtm = MainThreadMarker::new().expect("title-bar actions run on the main thread");
        let pending = MainThreadBound::new((Rc::downgrade(self), Rc::downgrade(window)), mtm);
        // AppKit can redraw synchronously during a resize. Tao's drawRect handler
        // takes the event callback lock, which Tao is still holding here.
        DispatchQueue::main().exec_async(move || {
            let mtm =
                MainThreadMarker::new().expect("the dispatch main queue runs on the main thread");
            let (action, window) = pending.into_inner(mtm);
            if let (Some(action), Some(window)) = (action.upgrade(), window.upgrade())
                && window.fullscreen().is_none()
            {
                action.apply(&window);
            }
        });
    }

    fn apply(&self, window: &Window) {
        // SAFETY: Tao owns the live window and this runs on the AppKit thread.
        let native = unsafe { &*window.ns_window().cast::<NSWindow>() };
        let preference = NSUserDefaults::standardUserDefaults()
            .stringForKey(ns_string!("AppleActionOnDoubleClick"))
            .map(|value| value.to_string());
        match preference.as_deref() {
            Some("Fill") => {
                let Some(screen) = native.screen() else {
                    return;
                };
                let current = native.frame();
                let target = screen.visibleFrame();
                // Restore only while the window is still in the frame we set.
                if let Some((filled, previous)) = self.fill_frames.take()
                    && current == filled
                {
                    native.setFrame_display_animate(previous, true, true);
                } else if current != target {
                    native.setFrame_display_animate(target, true, true);
                    self.fill_frames.set(Some((native.frame(), current)));
                }
            }
            Some("Minimize") => native.performMiniaturize(None),
            None | Some("Maximize") => {
                self.fill_frames.set(None);
                native.performZoom(None);
            }
            _ => {}
        }
    }
}
