//! Sparkle owns HTTPS, archive verification, delta extraction and replacement.
//! The app's user driver reports progress and waits for an explicit restart.
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
mod driver;
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
    updater: Retained<AnyObject>,
    driver: Retained<driver::Driver>,
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
        let class = AnyClass::get(c"SPUUpdater").ok_or("Sparkle could not be loaded")?;
        let notify = std::rc::Rc::new(notify);
        let driver_notify = notify.clone();
        let user_driver = driver::Driver::alloc(mtm).set_ivars(driver::DriverIvars {
            notify: Box::new(move |event| driver_notify(event)),
            ready: RefCell::new(None),
            cancellation: RefCell::new(None),
            closing: std::cell::Cell::new(false),
            extracting: std::cell::Cell::new(false),
        });
        let delegate = Delegate::alloc(mtm).set_ivars(DelegateIvars {
            notify: Box::new(move |event| notify(event)),
            install: RefCell::new(None),
        });
        // SAFETY: NSObject initialization and documented Sparkle 2.10 APIs.
        unsafe {
            let delegate: Retained<Delegate> = msg_send![super(delegate), init];
            let user_driver: Retained<driver::Driver> = msg_send![super(user_driver), init];
            let allocated: *mut AnyObject = msg_send![class, alloc];
            let updater: *mut AnyObject = msg_send![allocated,
                initWithHostBundle: &*bundle, applicationBundle: &*bundle, userDriver: &*user_driver, delegate: &*delegate];
            let updater = Retained::from_raw(updater).ok_or("Could not create the updater")?;
            // Our driver downloads and waits for an explicit restart. Do not
            // enable Sparkle's automatic install-on-quit policy.
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
                updater,
                driver: user_driver,
                delegate,
                _framework: framework,
            })
        }
    }
    pub fn check(&self) {
        if self.driver.install() { return; }
        unsafe {
            let _: () = msg_send![&*self.updater, checkForUpdates];
        }
    }
    pub fn probe(&self) -> bool {
        // Background checks use our driver to download and stage without UI.
        unsafe {
            let busy: bool = msg_send![&*self.updater, sessionInProgress];
            if !busy {
                let _: () = msg_send![&*self.updater, checkForUpdatesInBackground];
            }
            !busy
        }
    }
    pub fn cancel_pending_install(&self) { self.driver.cancel(); }
    pub fn can_close(&self) -> bool { self.driver.can_close() }
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
