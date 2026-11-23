// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from Viren070/AIOStreams, commit c358754b0ae4758d034badf8618de6fdb7fa9333.
// See desktop/THIRD-PARTY.md for provenance and modifications.
#![allow(deprecated)]
mod hdr;
mod titlebar;
use crate::mpv::Mpv;
use crate::frame_schedule::{Draw, FrameSchedule, UpdateGate};
use crate::render::RenderContext;
use dispatch2::{DispatchQueue, DispatchTime};
pub use hdr::{set_peak as set_hdr_peak, update as update_hdr};
pub use titlebar::TitlebarAction;
use objc2::rc::Retained;
use objc2::{
    AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send,
};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindow, NSWindowOrderingMode};
use objc2_core_foundation::CFTimeInterval;
use objc2_core_video::CVTimeStamp;
use objc2_foundation::NSObject;
use objc2_open_gl::{
    CGLChoosePixelFormat, CGLContextObj, CGLContextParameter, CGLCreateContext, CGLError,
    CGLLockContext, CGLOpenGLProfile, CGLPixelFormatAttribute, CGLPixelFormatObj,
    CGLReleaseContext, CGLReleasePixelFormat, CGLRetainContext, CGLRetainPixelFormat,
    CGLSetCurrentContext, CGLSetParameter, CGLUnlockContext,
};
use objc2_quartz_core::{
    CAAutoresizingMask, CALayer, CAOpenGLLayer, CATransaction, kCAContentsFormatRGBA16Float,
};
use std::cell::{Cell, RefCell};
use std::ffi::{c_char, c_int, c_void};
use std::ptr::{self, NonNull};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tao::platform::macos::WindowExtMacOS;
use tao::window::Window;

/// Called only on Tao's AppKit event-loop thread. Fullscreen callers restore the
/// buttons so AppKit's native titlebar container owns the top-edge reveal.
pub fn set_window_controls_visible(window: &Window, visible: bool) {
    use objc2_app_kit::NSWindowButton;
    // SAFETY: Tao owns this live NSWindow and this function runs on its main thread.
    let native = unsafe { &*window.ns_window().cast::<NSWindow>() };
    for kind in [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton] {
        if let Some(button) = native.standardWindowButton(kind) {
            button.setHidden(!visible);
        }
    }
}

/// WKWebView uses AppKit's Edit menu to implement standard clipboard shortcuts.
pub fn install_menu(on_quit: impl Fn() + Send + Sync + 'static) -> Result<muda::Menu, String> {
    use muda::{AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
    let about = PredefinedMenuItem::about(Some("About Navigator"), Some(AboutMetadata {
        name: Some("Navigator".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        ..Default::default()
    }));
    let quit = MenuItem::with_id(
        "navigator-quit",
        "Quit Navigator",
        true,
        "CmdOrCtrl+Q".parse().ok(),
    );
    let app = Submenu::with_items(
        "Navigator",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(),
            &PredefinedMenuItem::services(None),
            &PredefinedMenuItem::separator(),
            &PredefinedMenuItem::hide(None),
            &PredefinedMenuItem::hide_others(None),
            &PredefinedMenuItem::show_all(None),
            &PredefinedMenuItem::separator(),
            &quit,
        ],
    )
    .map_err(|e| e.to_string())?;
    let edit = Submenu::with_items(
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(None),
            &PredefinedMenuItem::redo(None),
            &PredefinedMenuItem::separator(),
            &PredefinedMenuItem::cut(None),
            &PredefinedMenuItem::copy(None),
            &PredefinedMenuItem::paste(None),
            &PredefinedMenuItem::select_all(None),
        ],
    )
    .map_err(|e| e.to_string())?;
    let file = Submenu::with_items("File", true, &[&PredefinedMenuItem::close_window(Some("Close Window"))]).map_err(|e| e.to_string())?;
    let view = Submenu::with_items("View", true, &[&PredefinedMenuItem::fullscreen(Some("Enter Full Screen"))]).map_err(|e| e.to_string())?;
    let window = Submenu::with_items("Window", true, &[
        &PredefinedMenuItem::minimize(None),
        &PredefinedMenuItem::maximize(Some("Zoom")),
        &PredefinedMenuItem::separator(),
        &PredefinedMenuItem::bring_all_to_front(None),
    ]).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&[&app, &file, &edit, &view, &window]).map_err(|e| e.to_string())?;
    menu.init_for_nsapp();
    window.set_as_windows_menu_for_nsapp();
    MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
        if event.id == "navigator-quit" {
            on_quit();
        }
    }));
    Ok(menu)
}
/// OpenGL.framework is linked through the CGL calls, so its symbols are all in reach.
unsafe extern "C" fn get_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    // SAFETY: a plain lookup with the name mpv passed.
    unsafe { libc::dlsym(libc::RTLD_DEFAULT, name) }
}

/// The framebuffer and viewport the layer bound for this frame; it draws into its own.
fn frame_target() -> (c_int, c_int, c_int) {
    const DRAW_FRAMEBUFFER_BINDING: u32 = 0x8CA6;
    const VIEWPORT: u32 = 0x0BA2;
    type GetIntegerv = unsafe extern "C" fn(u32, *mut c_int);
    // SAFETY: looked up for the current context, with glGetIntegerv's type.
    unsafe {
        let f = get_proc_address(ptr::null_mut(), c"glGetIntegerv".as_ptr());
        if f.is_null() {
            return (0, 0, 0);
        }
        let get: GetIntegerv = std::mem::transmute(f);
        let mut fbo: c_int = 0;
        let mut viewport: [c_int; 4] = [0; 4];
        get(DRAW_FRAMEBUFFER_BINDING, &mut fbo);
        get(VIEWPORT, viewport.as_mut_ptr());
        (fbo, viewport[2], viewport[3])
    }
}

/// A 3.2 core profile, 16 float bits a channel where it can, on the discrete
/// GPU only when the system switches to it. HDR needs the float format: an
/// 8-bit drawable clips the extended range.
fn pixel_format() -> Option<(CGLPixelFormatObj, c_int)> {
    let a = |v: CGLPixelFormatAttribute| v;
    let core = CGLPixelFormatAttribute(CGLOpenGLProfile::CGLOGLPVersion_3_2_Core.0);
    let base = [
        a(CGLPixelFormatAttribute::CGLPFAOpenGLProfile),
        core,
        a(CGLPixelFormatAttribute::CGLPFAAccelerated),
        a(CGLPixelFormatAttribute::CGLPFADoubleBuffer),
        a(CGLPixelFormatAttribute::CGLPFAAllowOfflineRenderers),
        a(CGLPixelFormatAttribute::CGLPFASupportsAutomaticGraphicsSwitching),
    ];
    let float = [
        a(CGLPixelFormatAttribute::CGLPFAColorSize),
        CGLPixelFormatAttribute(64),
        a(CGLPixelFormatAttribute::CGLPFAColorFloat),
    ];
    let attempts: [(Vec<CGLPixelFormatAttribute>, c_int); 3] = [
        ([&base[..], &float[..]].concat(), 16),
        (base.to_vec(), 8),
        (
            vec![
                a(CGLPixelFormatAttribute::CGLPFAOpenGLProfile),
                core,
                a(CGLPixelFormatAttribute::CGLPFADoubleBuffer),
            ],
            8,
        ),
    ];
    attempts.into_iter().find_map(|(mut attribs, depth)| {
        attribs.push(CGLPixelFormatAttribute(0));
        let mut format: CGLPixelFormatObj = ptr::null_mut();
        let mut count = 0;
        // SAFETY: a zero-terminated list, and out-pointers to locals.
        let error = unsafe {
            CGLChoosePixelFormat(
                NonNull::new_unchecked(attribs.as_mut_ptr()),
                NonNull::from(&mut format),
                NonNull::from(&mut count),
            )
        };
        (error == CGLError::NoError && !format.is_null()).then_some((format, depth))
    })
}

pub struct LayerIvars {
    format: CGLPixelFormatObj,
    context: CGLContextObj,
    /// The framebuffer's bits a channel: 16 float where the pixel format allows, else 8.
    depth: c_int,
    render: RefCell<Option<RenderContext>>,
    mpv: RefCell<Option<Arc<Mpv>>>,
    started: Cell<bool>,
    drawn: Cell<bool>,
    skipped: Cell<u32>,
    held: Cell<Held>,
    updates: Arc<UpdateGate>,
    schedule: RefCell<FrameSchedule>,
}

/// How long video draws held the main thread, over a window of time.
#[derive(Clone, Copy)]
struct Held {
    since: Instant,
    total: Duration,
    longest: Duration,
}

impl Held {
    const WINDOW: Duration = Duration::from_secs(10);

    fn new() -> Self {
        Self {
            since: Instant::now(),
            total: Duration::ZERO,
            longest: Duration::ZERO,
        }
    }

    /// Warns when draws took more than a tenth of the window, which the web view feels.
    fn add(self, took: Duration) -> Self {
        let held = Self {
            total: self.total + took,
            longest: self.longest.max(took),
            ..self
        };
        let elapsed = held.since.elapsed();
        if elapsed < Self::WINDOW {
            return held;
        }
        if held.total > elapsed / 10 {
            log::warn!(
                "video draws held the main thread {} ms/s over {} s, longest {} ms",
                held.total.as_millis() * 1000 / elapsed.as_millis().max(1),
                elapsed.as_secs(),
                held.longest.as_millis()
            );
        }
        Self::new()
    }
}

define_class!(
    /// Draws mpv's frames when mpv says one is ready, on the main thread.
    #[unsafe(super(CAOpenGLLayer, CALayer, NSObject))]
    #[name = "NavigatorVideoLayer"]
    #[ivars = LayerIvars]
    pub struct VideoLayer;

    impl VideoLayer {
        #[unsafe(method(copyCGLPixelFormatForDisplayMask:))]
        fn copy_pixel_format(&self, _mask: u32) -> CGLPixelFormatObj {
            // SAFETY: a format this layer owns; the caller releases the copy.
            unsafe { CGLRetainPixelFormat(self.ivars().format) }
        }

        #[unsafe(method(copyCGLContextForPixelFormat:))]
        fn copy_context(&self, _format: CGLPixelFormatObj) -> CGLContextObj {
            // SAFETY: a context this layer owns; the caller releases the copy.
            unsafe { CGLRetainContext(self.ivars().context) }
        }

        #[unsafe(method(drawInCGLContext:pixelFormat:forLayerTime:displayTime:))]
        unsafe fn draw(
            &self,
            context: CGLContextObj,
            format: CGLPixelFormatObj,
            time: CFTimeInterval,
            display: *const CVTimeStamp,
        ) {
            // SAFETY: the context the layer made current for this call.
            unsafe { CGLSetCurrentContext(context) };
            self.ivars().drawn.set(true);
            let skipped = self.ivars().skipped.replace(0);
            if skipped > 0 {
                log::info!("video shown again after {skipped} frames skipped while hidden");
            }
            if let Some(render) = self.ivars().render.borrow().as_ref() {
                let (fbo, width, height) = frame_target();
                if width > 0 && height > 0 {
                    let start = Instant::now();
                    render.render(fbo, width, height, true);
                    let held = &self.ivars().held;
                    held.set(held.get().add(start.elapsed()));
                }
            }
            // SAFETY: the superclass flushes the context.
            unsafe {
                let _: () = msg_send![
                    super(self),
                    drawInCGLContext: context,
                    pixelFormat: format,
                    forLayerTime: time,
                    displayTime: display
                ];
            }
        }
    }
);

thread_local! {
    static LAYER: RefCell<Option<Retained<VideoLayer>>> = const { RefCell::new(None) };
}

impl VideoLayer {
    fn create() -> Result<Retained<Self>, String> {
        let (format, depth) = pixel_format().ok_or("no OpenGL pixel format")?;
        let mut context: CGLContextObj = ptr::null_mut();
        // SAFETY: a format CGL just chose, and an out-pointer to a local.
        let error =
            unsafe { CGLCreateContext(format, ptr::null_mut(), NonNull::from(&mut context)) };
        if error != CGLError::NoError || context.is_null() {
            return Err(format!("no OpenGL context ({})", error.0));
        }
        let swap_interval: c_int = 1;
        // SAFETY: a context just created, and a pointer to a local.
        unsafe {
            CGLSetParameter(
                context,
                CGLContextParameter::CGLCPSwapInterval,
                NonNull::from(&swap_interval),
            )
        };
        let this = Self::alloc().set_ivars(LayerIvars {
            format,
            context,
            depth,
            render: RefCell::default(),
            mpv: RefCell::default(),
            started: Cell::new(false),
            drawn: Cell::new(false),
            skipped: Cell::new(0),
            held: Cell::new(Held::new()),
            updates: Arc::default(),
            schedule: RefCell::default(),
        });
        // SAFETY: NSObject's init, on a freshly allocated instance.
        let layer: Retained<Self> = unsafe { msg_send![super(this), init] };
        if depth == 16 {
            // SAFETY: the static is a valid, constant string.
            layer.setContentsFormat(unsafe { kCAContentsFormatRGBA16Float });
        }
        Ok(layer)
    }

    fn start(&self) {
        let ivars = self.ivars();
        let Some(mpv) = ivars.mpv.borrow().clone() else {
            return;
        };
        if ivars.started.replace(true) {
            return;
        }
        let _lock = ContextLock::new(ivars.context);
        // Advanced control: mpv waits on the main thread, where nothing may block on mpv.
        match RenderContext::new(
            mpv,
            get_proc_address,
            ptr::null_mut(),
            None,
            true,
            ivars.depth,
        ) {
            Ok(mut render) => {
                let updates = ivars.updates.clone();
                render.on_update(move || {
                    if !updates.queue() { return; }
                    let updates = updates.clone();
                    DispatchQueue::main().exec_async(move || {
                        updates.begin();
                        if let Some(layer) = LAYER.with(|l| l.borrow().clone()) {
                            if Arc::ptr_eq(&updates, &layer.ivars().updates) { layer.update_video(); }
                        }
                    });
                });
                *ivars.render.borrow_mut() = Some(render);
                log::info!("mpv render context ready");
                self.setNeedsDisplay();
            }
            Err(e) => log::error!("{e}"),
        }
    }

    /// Takes each frame mpv readies, drawn or skipped, so mpv never waits on a hidden window.
    fn update_video(&self) {
        let ivars = self.ivars();
        {
            let render = ivars.render.borrow();
            let Some(r) = render.as_ref() else {
                return;
            };
            let _lock = ContextLock::new(ivars.context);
            if !r.update() {
                return;
            }
            // The render API leaves this frame pending until it is rendered.
            // Dispatch its future deadline rather than waiting on the UI thread;
            // render() still retains mpv's timing guard when the deadline arrives.
            match ivars.schedule.borrow_mut().request(Instant::now(), r.next_frame_in()) {
                Draw::Now => {}
                Draw::Pending => return,
                Draw::Later { ticket, wait } => {
                    let updates = ivars.updates.clone();
                    let _ = DispatchQueue::main().after(DispatchTime::try_from(wait).expect("Wait capped to one second"), move || {
                        if let Some(layer) = LAYER.with(|l| l.borrow().clone()) {
                            if !Arc::ptr_eq(&updates, &layer.ivars().updates) { return; }
                            let due = layer.ivars().schedule.borrow_mut().take(ticket);
                            if due { layer.update_video(); }
                        }
                    });
                    return;
                }
            }
        }
        ivars.drawn.set(false);
        self.display();
        CATransaction::flush();
        if ivars.drawn.get() {
            return;
        }
        // Core Animation does not draw a minimised, covered or hidden window, or one on another Space.
        let render = ivars.render.borrow();
        if let Some(r) = render.as_ref() {
            let _lock = ContextLock::new(ivars.context);
            if r.update() {
                r.skip();
                ivars.skipped.set(ivars.skipped.get() + 1);
            }
        }
    }

    fn stop(&self) {
        let ivars = self.ivars();
        ivars.schedule.borrow_mut().cancel();
        let _lock = ContextLock::new(ivars.context);
        ivars.render.borrow_mut().take();
    }
}

/// Holds the OpenGL context locked and current, as mpv's render calls need.
struct ContextLock(CGLContextObj);

impl ContextLock {
    fn new(context: CGLContextObj) -> Self {
        // SAFETY: a live context this layer owns.
        unsafe {
            CGLLockContext(context);
            CGLSetCurrentContext(context);
        }
        Self(context)
    }
}

impl Drop for ContextLock {
    fn drop(&mut self) {
        // SAFETY: the context locked in `new`.
        unsafe { CGLUnlockContext(self.0) };
    }
}

/// The native video view is a sibling below the transparent WKWebView.
pub struct VideoSurface {
    view: Retained<NSView>,
    layer: Retained<VideoLayer>,
}
impl VideoSurface {
    pub fn new(window: &Window) -> Result<Self, String> {
        let mtm = MainThreadMarker::new().ok_or("window must be on the main thread")?;
        // SAFETY: tao owns this content view for the window's lifetime.
        let content = unsafe { &*window.ns_view().cast::<NSView>() };
        let view = NSView::initWithFrame(NSView::alloc(mtm), content.bounds());
        view.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        let layer = VideoLayer::create()?;
        layer.setAsynchronous(false);
        layer.setNeedsDisplayOnBoundsChange(true);
        layer.setAutoresizingMask(
            CAAutoresizingMask::LayerWidthSizable | CAAutoresizingMask::LayerHeightSizable,
        );
        layer.setContentsScale(window.scale_factor());
        view.setLayer(Some(&layer));
        view.setWantsLayer(true);
        content.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, None);
        LAYER.with(|l| *l.borrow_mut() = Some(layer.clone()));
        Ok(Self { view, layer })
    }
    pub fn attach(&self, mpv: Arc<Mpv>) {
        *self.layer.ivars().mpv.borrow_mut() = Some(mpv.clone());
        hdr::attach(
            self.layer.clone().into_super(),
            self.view.clone(),
            mpv,
            self.layer.ivars().depth == 16,
        );
        self.layer.start();
    }
    pub fn resize(&self, width: u32, _height: u32) {
        let bounds = self.view.bounds();
        self.layer.setFrame(bounds);
        if bounds.size.width > 0.0 {
            self.layer
                .setContentsScale(f64::from(width) / bounds.size.width);
        }
        self.layer.setNeedsDisplay();
    }
    pub fn shutdown(&self) {
        hdr::shutdown();
        self.layer.stop();
        LAYER.with(|l| l.borrow_mut().take());
        self.layer.ivars().mpv.borrow_mut().take();
    }
    pub fn refresh_hdr(&self) {
        hdr::refresh();
    }
    pub fn hdr_diagnostics(&self) -> (bool, f64, bool, bool) {
        hdr::diagnostics()
    }
    pub fn output_colorspace(&self) -> Option<String> {
        objc2_core_graphics::CGColorSpace::name(self.layer.colorspace().as_deref())
            .map(|name| name.to_string())
    }
}
pub fn mpv_options(_: &VideoSurface) -> Vec<(&'static str, String)> {
    let mut options = vec![
        ("vo", "libmpv".into()),
        ("hwdec", "auto-safe".into()),
        ("video-timing-offset", "0".into()),
        ("vd-lavc-dr", "no".into()),
    ];
    options.extend(
        crate::hdr::SDR_OUTPUT_OPTIONS
            .iter()
            .map(|&(name, value)| (name, value.into())),
    );
    options
}

impl Drop for LayerIvars {
    fn drop(&mut self) {
        // Render contexts and mpv references must disappear before releasing CGL.
        let _lock = ContextLock::new(self.context);
        self.render.get_mut().take();
        self.mpv.get_mut().take();
        drop(_lock);
        // SAFETY: these are the retained resources created for this layer.
        unsafe {
            CGLReleaseContext(self.context);
            CGLReleasePixelFormat(self.format);
        }
    }
}
