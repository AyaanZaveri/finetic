//! Sparkle verifies and extracts; Navigator shows progress and owns the restart choice.
use super::*;

pub(super) struct DriverIvars {
    pub notify: Box<dyn Fn(Event)>,
    pub ready: RefCell<Option<RcBlock<dyn Fn(isize)>>>,
    pub cancellation: RefCell<Option<RcBlock<dyn Fn()>>>,
    pub target: RefCell<Option<String>>,
    pub closing: std::cell::Cell<bool>,
    pub extracting: std::cell::Cell<bool>,
}
define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "NavigatorUpdateDriver"]
    #[ivars = DriverIvars]
    pub(super) struct Driver;
    impl Driver {
        #[unsafe(method(showUpdatePermissionRequest:reply:))]
        fn permission(&self, _request: &AnyObject, reply: &Block<dyn Fn(*mut AnyObject)>) {
            // The app already owns the user's automatic-check preference.
            unsafe {
                let class = AnyClass::get(c"SUUpdatePermissionResponse").unwrap();
                let value: *mut AnyObject = msg_send![class, alloc];
                let value: *mut AnyObject = msg_send![value, initWithAutomaticUpdateChecks: false, sendSystemProfile: false];
                let value = Retained::from_raw(value).unwrap();
                reply.call((Retained::as_ptr(&value).cast_mut(),));
            }
        }
        #[unsafe(method(showUserInitiatedUpdateCheckWithCancellation:))]
        fn checking(&self, _cancel: &Block<dyn Fn()>) {}
        #[unsafe(method(showUpdateFoundWithAppcastItem:state:reply:))]
        fn found(&self, item: &AnyObject, state: &AnyObject, reply: &Block<dyn Fn(isize)>) {
            unsafe {
                let information: bool = msg_send![item, isInformationOnlyUpdate];
                let stage: isize = msg_send![state, stage];
                if self.ivars().closing.get() { reply.call((0,)); }
                else if information {
                    reply.call((2,)); // Dismiss information-only updates; never run an external installer.
                } else if stage < 2 {
                    let target = appcast_version(item);
                    *self.ivars().target.borrow_mut() = target.clone();
                    (self.ivars().notify)(Event::Downloading(target));
                    reply.call((1,)); // Download and extract, then wait at the ready callback.
                } else {
                    *self.ivars().ready.borrow_mut() = Some(reply.copy());
                    let target = appcast_version(item);
                    *self.ivars().target.borrow_mut() = target.clone();
                    (self.ivars().notify)(Event::Ready(target));
                }
            }
        }
        #[unsafe(method(showUpdateReleaseNotesWithDownloadData:))]
        fn notes(&self, _data: &AnyObject) {}
        #[unsafe(method(showUpdateReleaseNotesFailedToDownloadWithError:))]
        fn notes_failed(&self, _error: &NSError) {}
        #[unsafe(method(showUpdateNotFoundWithError:acknowledgement:))]
        fn current(&self, _error: &NSError, acknowledge: &Block<dyn Fn()>) {
            (self.ivars().notify)(Event::Current); acknowledge.call(());
        }
        #[unsafe(method(showUpdaterError:acknowledgement:))]
        fn failed(&self, _error: &NSError, acknowledge: &Block<dyn Fn()>) {
            self.ivars().ready.borrow_mut().take();
            self.ivars().target.borrow_mut().take();
            self.ivars().extracting.set(false);
            (self.ivars().notify)(Event::Error); acknowledge.call(());
        }
        #[unsafe(method(showDownloadInitiatedWithCancellation:))]
        fn downloading(&self, cancel: &Block<dyn Fn()>) {
            if self.ivars().closing.get() { cancel.call(()); return; }
            *self.ivars().cancellation.borrow_mut() = Some(cancel.copy());
            (self.ivars().notify)(Event::Downloading(self.ivars().target.borrow().clone()));
        }
        #[unsafe(method(showDownloadDidReceiveExpectedContentLength:))]
        fn expected(&self, _length: u64) {}
        #[unsafe(method(showDownloadDidReceiveDataOfLength:))]
        fn received(&self, _length: u64) {}
        #[unsafe(method(showDownloadDidStartExtractingUpdate))]
        fn extracting(&self) {
            self.ivars().cancellation.borrow_mut().take();
            self.ivars().extracting.set(true);
        }
        #[unsafe(method(showExtractionReceivedProgress:))]
        fn progress(&self, _progress: f64) {}
        #[unsafe(method(showReadyToInstallAndRelaunch:))]
        fn ready(&self, reply: &Block<dyn Fn(isize)>) {
            self.ivars().extracting.set(false);
            if self.ivars().closing.get() { reply.call((0,)); return; }
            *self.ivars().ready.borrow_mut() = Some(reply.copy());
            (self.ivars().notify)(Event::Ready(self.ivars().target.borrow().clone()));
        }
        #[unsafe(method(showInstallingUpdateWithApplicationTerminated:retryTerminatingApplication:))]
        fn installing(&self, _terminated: bool, _retry: &Block<dyn Fn()>) {}
        #[unsafe(method(showUpdateInstalledAndRelaunched:acknowledgement:))]
        fn installed(&self, _relaunched: bool, acknowledge: &Block<dyn Fn()>) { acknowledge.call(()); }
        #[unsafe(method(dismissUpdateInstallation))]
        fn dismissed(&self) {
            self.ivars().ready.borrow_mut().take();
            self.ivars().cancellation.borrow_mut().take();
            self.ivars().target.borrow_mut().take();
            self.ivars().extracting.set(false);
        }
        #[unsafe(method(showUpdateInFocus))]
        fn focus(&self) {}
    }
);
impl Driver {
    pub fn install(&self) -> bool {
        let ready = self.ivars().ready.borrow_mut().take();
        if let Some(ready) = ready { ready.call((1,)); true } else { false }
    }
    pub fn cancel(&self) {
        // Sparkle can install an extracted update on normal quit. Cancel the
        // staged installation unless the user explicitly chose Restart.
        let ready = self.ivars().ready.borrow_mut().take();
        self.ivars().closing.set(true);
        if let Some(ready) = ready { ready.call((0,)); }
        let cancel = self.ivars().cancellation.borrow_mut().take();
        if let Some(cancel) = cancel { cancel.call(()); }
    }
    pub fn can_close(&self) -> bool { !self.ivars().extracting.get() }
}
