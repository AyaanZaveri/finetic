// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Viren070/AIOStreams, commit c358754b0ae4758d034badf8618de6fdb7fa9333.
// See desktop/THIRD-PARTY.md for provenance and modifications.
use crate::mpv::Mpv;
use std::sync::Arc;
use tao::{platform::windows::WindowExtWindows, window::Window};
use windows_sys::Win32::{
    Foundation::*, Graphics::Gdi::*, System::LibraryLoader::GetModuleHandleW,
    UI::WindowsAndMessaging::*,
};

pub fn prepare_library(library: &std::path::Path) {
    use windows_sys::Win32::System::LibraryLoader::LoadLibraryW;
    // Prefer the driver's system loader. Retain the handle for libmpv's lifetime.
    if !unsafe { LoadLibraryW(wide("vulkan-1.dll").as_ptr()) }.is_null() {
        return;
    }
    let fallback = library.with_file_name("vulkan").join("vulkan-1.dll");
    if unsafe { LoadLibraryW(wide(&fallback.to_string_lossy()).as_ptr()) }.is_null() {
        log::warn!(
            "Could not load the Vulkan fallback: {}",
            std::io::Error::last_os_error()
        );
    }
}
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

pub const WINDOW_CLASS: &str = "NavigatorDesktop";
pub fn window_class(smoke: bool) -> &'static str {
    if smoke {
        "NavigatorDesktopSmoke"
    } else {
        WINDOW_CLASS
    }
}
pub const APP_ID: &str = "app.navigator.desktop";
pub const STARTUP_BACKGROUND: (u8, u8, u8, u8) = (0x04, 0x2f, 0x2e, 255);

pub fn claim_app_id() {
    unsafe {
        windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(
            wide(APP_ID).as_ptr(),
        );
    }
}

pub fn activate_existing(smoke: bool) -> bool {
    // Another launch may arrive between profile locking and window creation.
    for _ in 0..40 {
        unsafe {
            let hwnd = FindWindowW(wide(window_class(smoke)).as_ptr(), std::ptr::null());
            if !hwnd.is_null() {
                if IsIconic(hwnd) != 0 {
                    ShowWindow(hwnd, SW_RESTORE);
                }
                SetForegroundWindow(hwnd);
                return true;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    false
}

pub fn show_error(message: &str) {
    let text = format!(
        "Navigator could not start.\n\n{message}\n\nClose any other Navigator window and try again. If files are missing, reinstall the private build. For a WebView2 error, repair Microsoft Edge WebView2 Runtime."
    );
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            wide(&text).as_ptr(),
            wide("Navigator").as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

unsafe extern "system" fn loading_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // WebView2 paints the branded splash. The earlier GDI label used the
    // system's tiny default font and flashed as a separate loading screen.
    if msg == WM_ERASEBKGND { return 1; }
    if msg == WM_PAINT {
        unsafe {
            let mut paint = std::mem::zeroed();
            let dc = BeginPaint(hwnd, &mut paint);
            let mut rect = std::mem::zeroed();
            GetClientRect(hwnd, &mut rect);
            let (r, g, b, _) = STARTUP_BACKGROUND;
            let brush = CreateSolidBrush(r as u32 | (g as u32) << 8 | (b as u32) << 16);
            FillRect(dc, &rect, brush);
            DeleteObject(brush);
            EndPaint(hwnd, &paint);
        }
        return 0;
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// A lightweight native first frame; no browser startup is required to paint it.
pub struct LoadingView(HWND);
impl LoadingView {
    pub fn new(window: &Window) -> Result<Self, String> {
        unsafe {
            let class = wide("NavigatorLoading");
            let instance = GetModuleHandleW(std::ptr::null());
            let wc = WNDCLASSW {
                lpfnWndProc: Some(loading_proc),
                hInstance: instance,
                lpszClassName: class.as_ptr(),
                ..std::mem::zeroed()
            };
            RegisterClassW(&wc);
            let size = window.inner_size();
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_VISIBLE,
                0,
                0,
                size.width as i32,
                size.height as i32,
                window.hwnd() as HWND,
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return Err("Could not create startup view".into());
            }
            UpdateWindow(hwnd);
            Ok(Self(hwnd))
        }
    }
    pub fn resize(&self, width: u32, height: u32) {
        unsafe {
            SetWindowPos(
                self.0,
                std::ptr::null_mut(),
                0,
                0,
                width as i32,
                height as i32,
                SWP_NOACTIVATE | SWP_NOZORDER,
            );
        }
    }
}
impl Drop for LoadingView {
    fn drop(&mut self) {
        unsafe {
            DestroyWindow(self.0);
        }
    }
}
unsafe extern "system" fn video_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}
/// The child window mpv draws into, kept beneath the web view.
pub struct VideoSurface {
    hwnd: HWND,
    renderer: Arc<super::windows_video::Host>,
}

impl VideoSurface {
    pub fn new(window: &Window) -> Result<Self, String> {
        let (parent, size) = (window.hwnd(), window.inner_size());
        let (width, height) = (size.width, size.height);
        let class = wide("NavigatorVideo");
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let wc = WNDCLASSW {
                lpfnWndProc: Some(video_proc),
                hInstance: instance,
                lpszClassName: class.as_ptr(),
                hbrBackground: GetStockObject(BLACK_BRUSH),
                ..std::mem::zeroed()
            };
            RegisterClassW(&wc);
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_VISIBLE,
                0,
                0,
                width as i32,
                height as i32,
                parent as HWND,
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return Err("could not create the video window".into());
            }
            Ok(Self { hwnd, renderer: super::windows_video::Host::new(hwnd as usize,size.width,size.height) })
        }
    }

    /// mpv draws into the window itself, so it needs no render context.
    pub fn attach(&self, _mpv: Arc<Mpv>) {}

    pub fn renderer(&self) -> Arc<super::windows_video::Host> { self.renderer.clone() }
    pub fn visible(&self, visible: bool) { self.renderer.visible(visible); }
    pub fn refresh_display(&self) { self.renderer.refresh_display(); }

    pub fn shutdown(&self) { self.renderer.shutdown(); }
    pub fn begin_shutdown(&self) { self.renderer.begin_shutdown(); }
    pub fn finished(&self) -> bool { self.renderer.finished() }

    pub fn resize(&self, width: u32, height: u32) {
        self.renderer.resize(width,height);
        unsafe {
            SetWindowPos(
                self.hwnd,
                HWND_BOTTOM,
                0,
                0,
                width as i32,
                height as i32,
                SWP_NOACTIVATE,
            );
        }
    }
}
pub fn mpv_options(_video: &VideoSurface) -> Vec<(&'static str, String)> {
    vec![
        ("vo", "libmpv".into()),
        ("video-timing-offset", "0".into()),
        ("hwdec", "auto-safe".into()),
        ("tone-mapping", "bt.2390".into()),
        ("target-prim", "bt.709".into()),
        ("target-trc", "srgb".into()),
        ("target-peak", "auto".into()),
        ("icc-profile", "".into()),
        ("video-output-levels", "full".into()),
    ]
}

thread_local! {
    static DISPLAY_CHANGED: std::cell::RefCell<Option<Box<dyn Fn()>>> = const { std::cell::RefCell::new(None) };
    static CHROME_FULLSCREEN_ACTION: std::cell::RefCell<Option<Box<dyn Fn()>>> = const { std::cell::RefCell::new(None) };
    static CHROME_CONTROLS_VISIBLE: std::cell::Cell<bool> = const { std::cell::Cell::new(true) };
    static CHROME_FULLSCREEN: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static CHROME_HOVER: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
    static CHROME_LISTENER: std::cell::RefCell<Option<Box<dyn Fn(u32)>>> = const { std::cell::RefCell::new(None) };
    static CHROME_ACTIVATION: std::cell::RefCell<Option<Box<dyn Fn(bool)>>> = const { std::cell::RefCell::new(None) };
}
pub fn on_display_change(listener: impl Fn() + 'static) {
    DISPLAY_CHANGED.with(|value| *value.borrow_mut() = Some(Box::new(listener)));
}
pub fn on_chrome_fullscreen(listener: impl Fn() + 'static) {
    CHROME_FULLSCREEN_ACTION.with(|value| *value.borrow_mut() = Some(Box::new(listener)));
}
pub fn on_chrome_hover(listener: impl Fn(u32) + 'static) {
    CHROME_LISTENER.with(|value| *value.borrow_mut() = Some(Box::new(listener)));
}
pub fn on_chrome_activation(listener: impl Fn(bool) + 'static) {
    CHROME_ACTIVATION.with(|value| *value.borrow_mut() = Some(Box::new(listener)));
}
fn chrome_hover(hit: u32) {
    let hit = if [HTMINBUTTON, HTMAXBUTTON, HTCLOSE].contains(&hit) {
        hit
    } else {
        0
    };
    if CHROME_HOVER.replace(hit) != hit {
        CHROME_LISTENER.with(|value| {
            if let Some(listener) = &*value.borrow() {
                listener(hit);
            }
        });
    }
}
pub fn set_window_controls_visible(value: bool) {
    CHROME_CONTROLS_VISIBLE.set(value);
    if !value { chrome_hover(0); }
}

pub fn set_chrome_fullscreen(value: bool) {
    CHROME_FULLSCREEN.set(value);
}

const CAPTION_BUTTON_WIDTH: f64 = 32.0;
const CAPTION_HEIGHT: f64 = 24.0;

fn caption_button_hit(x: f64, y: f64, right: f64) -> Option<u32> {
    if !(3.0..CAPTION_HEIGHT).contains(&y)
        || !(right - 3.0 * CAPTION_BUTTON_WIDTH..right).contains(&x)
    {
        return None;
    }
    Some(if x >= right - CAPTION_BUTTON_WIDTH {
        HTCLOSE
    } else if x >= right - 2.0 * CAPTION_BUTTON_WIDTH {
        HTMAXBUTTON
    } else {
        HTMINBUTTON
    })
}

fn chrome_region_hit(x: f64, y: f64, right: f64, fullscreen: bool) -> Option<u32> {
    if y < 3.0 || !(0.0..right).contains(&x) {
        return None;
    }
    if let Some(button) = caption_button_hit(x, y, right) {
        return Some(button);
    }
    if !fullscreen && y < 16.0 {
        return Some(HTCAPTION);
    }
    None
}

#[cfg(test)]
#[test]
fn fullscreen_keeps_caption_actions_without_dragging_the_window() {
    for fullscreen in [false, true] {
        assert_eq!(chrome_region_hit(1200.0, 12.0, 1280.0, fullscreen), Some(HTMINBUTTON));
        assert_eq!(chrome_region_hit(1232.0, 12.0, 1280.0, fullscreen), Some(HTMAXBUTTON));
        assert_eq!(chrome_region_hit(1264.0, 12.0, 1280.0, fullscreen), Some(HTCLOSE));
        assert_eq!(chrome_region_hit(1264.0, 26.0, 1280.0, fullscreen), None);
    }
    assert_eq!(chrome_region_hit(100.0, 12.0, 1280.0, false), Some(HTCAPTION));
    assert_eq!(chrome_region_hit(100.0, 12.0, 1280.0, true), None);
}

#[cfg(test)]
#[test]
fn compact_caption_buttons_keep_distinct_hit_regions() {
    for right in [480.0, 1280.0] {
        assert_eq!(caption_button_hit(right - 80.0, 12.0, right), Some(HTMINBUTTON));
        assert_eq!(caption_button_hit(right - 48.0, 12.0, right), Some(HTMAXBUTTON));
        assert_eq!(caption_button_hit(right - 16.0, 12.0, right), Some(HTCLOSE));
        assert_eq!(caption_button_hit(right - 112.0, 22.0, right), None);
        assert_eq!(caption_button_hit(right - 16.0, 24.0, right), None);
        assert_eq!(caption_button_hit(right - 16.0, 2.0, right), None);
        assert_eq!(caption_button_hit(right, 12.0, right), None);
    }
}

fn chrome_hit(root: HWND, lparam: LPARAM) -> Option<u32> {
    if !CHROME_CONTROLS_VISIBLE.get() { return None; }
    unsafe {
        let mut point = POINT {
            x: (lparam as u16 as i16) as i32,
            y: ((lparam >> 16) as u16 as i16) as i32,
        };
        ScreenToClient(root, &mut point);
        let mut rect: RECT = std::mem::zeroed();
        GetClientRect(root, &mut rect);
        let scale = windows_sys::Win32::UI::HiDpi::GetDpiForWindow(root) as f64 / 96.0;
        let x = point.x as f64 / scale;
        let y = point.y as f64 / scale;
        let right = rect.right as f64 / scale;
        chrome_region_hit(x, y, right, CHROME_FULLSCREEN.get())
    }
}
unsafe extern "system" fn chrome_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    id: usize,
    root: usize,
) -> LRESULT {
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass};
    unsafe {
        if msg == WM_NCDESTROY {
            RemoveWindowSubclass(hwnd, Some(chrome_proc), id);
        }
        if hwnd == root as HWND {
            if msg == WM_NCACTIVATE {
                CHROME_ACTIVATION.with(|value| {
                    if let Some(listener) = &*value.borrow() { listener(wparam != 0); }
                });
            }
            if matches!(msg, WM_DISPLAYCHANGE | WM_SETTINGCHANGE) {
                DISPLAY_CHANGED.with(|value| { if let Some(listener) = &*value.borrow() { listener(); } });
            }
            // Let Windows track the native button press/release, then redirect
            // only a mouse action on this caption button to app fullscreen.
            // System-menu, Snap-layout and titlebar maximize actions stay native.
            if msg == WM_SYSCOMMAND
                && matches!(wparam as u32 & 0xfff0, SC_MAXIMIZE | SC_RESTORE)
                && lparam != 0 && chrome_hit(hwnd, lparam) == Some(HTMAXBUTTON) {
                CHROME_FULLSCREEN_ACTION.with(|value| {
                    if let Some(listener) = &*value.borrow() { listener(); }
                });
                return 0;
            }
            if msg == WM_NCMOUSEMOVE {
                use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
                let mut track = TRACKMOUSEEVENT {
                    cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE | TME_NONCLIENT,
                    hwndTrack: hwnd,
                    dwHoverTime: 0,
                };
                TrackMouseEvent(&mut track);
                chrome_hover(wparam as u32);
            }
            if msg == WM_NCMOUSELEAVE || (msg == WM_NCACTIVATE && wparam == 0) {
                chrome_hover(0);
            }
        }
        if msg == WM_NCHITTEST {
            let default = DefSubclassProc(hwnd, msg, wparam, lparam);
            // Preserve the system's resize borders before adding caption regions.
            if hwnd == root as HWND && (HTLEFT as isize..=HTBOTTOMRIGHT as isize).contains(&default)
            {
                return default;
            }
            if let Some(hit) = chrome_hit(root as HWND, lparam) {
                // Transparent hit testing forwards from WebView2's child HWNDs to
                // the top-level frame, where Windows provides Snap and system actions.
                return if hwnd == root as HWND {
                    hit as isize
                } else {
                    HTTRANSPARENT as isize
                };
            }
            if hwnd == root as HWND {
                chrome_hover(0);
            }
            return default;
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }
}
unsafe extern "system" fn hook_chrome_child(hwnd: HWND, root: LPARAM) -> i32 {
    unsafe {
        windows_sys::Win32::UI::Shell::SetWindowSubclass(
            hwnd,
            Some(chrome_proc),
            0x4e4156,
            root as usize,
        );
    }
    1
}
pub fn install_chrome(window: &Window) {
    unsafe {
        let hwnd = window.hwnd() as HWND;
        windows_sys::Win32::UI::Shell::SetWindowSubclass(
            hwnd,
            Some(chrome_proc),
            0x4e4156,
            hwnd as usize,
        );
        EnumChildWindows(hwnd, Some(hook_chrome_child), hwnd as isize);
    }
}
pub fn request_close(window: &Window) {
    unsafe {
        PostMessageW(window.hwnd() as HWND, WM_CLOSE, 0, 0);
    }
}
