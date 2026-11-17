//! Sparkle owns HTTPS, archive verification, native update UI and replacement.
//! All calls and delegate callbacks run on AppKit's main thread.
use block2::{Block, RcBlock};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};
use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_foundation::{NSBundle, NSError, NSObject, NSString};
use std::{cell::RefCell, path::Path, ptr};

pub const FEED: &str =
    "https://raw.githubusercontent.com/AyaanZaveri/navigator/main/updates/macos.xml";
pub const PUBLIC_KEY: &str = include_str!("../macos/update-public-key.txt");
mod status;
pub use status::{Event, install_should_exit};

struct DelegateIvars {
    notify: Box<dyn Fn(Event)>,
    install: RefCell<Option<RcBlock<dyn Fn()>>>,
}
define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "NavigatorSparkleDelegate"]
    #[ivars = DelegateIvars]
    struct Delegate;
    impl Delegate {
        #[unsafe(method(updater:didFindValidUpdate:))]
        fn found(&self, _updater: &AnyObject, _item: &AnyObject) { (self.ivars().notify)(Event::Available); }
        #[unsafe(method(updaterDidNotFindUpdate:error:))]
        fn current(&self, _updater: &AnyObject, _error: &NSError) { (self.ivars().notify)(Event::Current); }
        #[unsafe(method(updater:didAbortWithError:))]
        fn failed(&self, _updater: &AnyObject, error: &NSError) { (self.ivars().notify)(status::error_event(&error.domain().to_string(), error.code())); }
        #[unsafe(method(userDidCancelDownload:))]
        fn cancelled(&self, _updater: &AnyObject) { (self.ivars().notify)(Event::Finished); }
        #[unsafe(method(updater:didFinishUpdateCycleForUpdateCheck:error:))]
        fn finished(&self, _updater: &AnyObject, _check: isize, _error: Option<&NSError>) { (self.ivars().notify)(Event::Finished); }
        #[unsafe(method(updaterWillRelaunchApplication:))]
        fn will_relaunch(&self, _updater: &AnyObject) {
            (self.ivars().notify)(Event::Relaunch);
        }
        #[unsafe(method(updater:shouldPostponeRelaunchForUpdate:untilInvokingBlock:))]
        fn postpone(&self, _updater: &AnyObject, _item: &AnyObject, handler: &Block<dyn Fn()>) -> bool {
            // Copy the block before returning. Resume only after mpv and the
            // owned server stop, so Sparkle can safely replace and relaunch us.
            *self.ivars().install.borrow_mut() = Some(handler.copy());
            (self.ivars().notify)(Event::Install);
            true
        }
    }
);
pub struct Updater {
    controller: Retained<AnyObject>,
    updater: Retained<AnyObject>,
    delegate: Retained<Delegate>,
    _framework: Retained<NSBundle>,
}
impl Updater {
    pub fn start(notify: impl Fn(Event) + 'static) -> Result<Self, String> {
        let mtm = MainThreadMarker::new().ok_or("Updates require AppKit's main thread")?;
        let bundle = NSBundle::mainBundle();
        let info = bundle
            .infoDictionary()
            .ok_or("Updates require the packaged Navigator app")?;
        for (key, expected) in [("SUFeedURL", FEED), ("SUPublicEDKey", PUBLIC_KEY.trim())] {
            let value = info
                .objectForKey(&NSString::from_str(key))
                .ok_or("Update configuration is missing")?;
            let value = value
                .downcast::<NSString>()
                .map_err(|_| "Invalid update configuration")?;
            if value.to_string() != expected {
                return Err("Update configuration does not match Navigator".into());
            }
        }
        let path = Path::new(&bundle.bundlePath().to_string())
            .join("Contents/Frameworks/Sparkle.framework");
        let framework = NSBundle::bundleWithPath(&NSString::from_str(&path.to_string_lossy()))
            .ok_or("Sparkle is missing from this app")?;
        // SAFETY: load only our embedded, packaged framework. Never search PATH.
        unsafe { framework.loadAndReturnError() }
            .map_err(|e| e.localizedDescription().to_string())?;
        let class =
            AnyClass::get(c"SPUStandardUpdaterController").ok_or("Sparkle could not be loaded")?;
        let delegate = Delegate::alloc(mtm).set_ivars(DelegateIvars {
            notify: Box::new(notify),
            install: RefCell::new(None),
        });
        // SAFETY: NSObject initialization and documented Sparkle 2.10 APIs.
        unsafe {
            let delegate: Retained<Delegate> = msg_send![super(delegate), init];
            let allocated: *mut AnyObject = msg_send![class, alloc];
            let controller: *mut AnyObject = msg_send![allocated,
                initWithStartingUpdater: false, updaterDelegate: &*delegate, userDriverDelegate: ptr::null::<AnyObject>()];
            let controller =
                Retained::from_raw(controller).ok_or("Could not create the update controller")?;
            let updater: Retained<AnyObject> = msg_send![&*controller, updater];
            // The shell owns silent launch/hourly probes. Sparkle's scheduled
            // checks can offer an update window, which is reserved for a click.
            let _: () = msg_send![&*updater, setAutomaticallyChecksForUpdates: false];
            let _: () = msg_send![&*updater, setAutomaticallyDownloadsUpdates: false];
            let mut error: *mut NSError = ptr::null_mut();
            let started: bool = msg_send![&*updater, startUpdater: &mut error];
            if !started {
                return Err(if error.is_null() {
                    "Could not start updates".into()
                } else {
                    (&*error).localizedDescription().to_string()
                });
            }
            Ok(Self {
                controller,
                updater,
                delegate,
                _framework: framework,
            })
        }
    }
    pub fn check(&self) {
        // Sparkle brings an existing update window forward instead of opening
        // another cycle. Installation still requires explicit user acceptance.
        unsafe {
            let _: () = msg_send![&*self.controller, checkForUpdates: ptr::null::<AnyObject>()];
        }
    }
    pub fn probe(&self) -> bool {
        // The documented information-only API calls our delegate without any UI
        // or download, and honors Sparkle's OS/skip/version eligibility checks.
        unsafe {
            let busy: bool = msg_send![&*self.updater, sessionInProgress];
            if !busy {
                let _: () = msg_send![&*self.updater, checkForUpdateInformation];
            }
            !busy
        }
    }
    pub fn finish_install(&self) -> bool {
        let handler = self.delegate.ivars().install.borrow_mut().take();
        if let Some(handler) = handler {
            handler.call(());
            true
        } else {
            false
        }
    }
}
