//! Prevent idle display/system sleep while playing. Manual sleep remains OS policy.
use std::{marker::PhantomData, rc::Rc};

#[derive(Default)]
pub struct WakeLock {
    platform: Platform,
    requested: bool,
    // Windows execution requirements belong to the calling thread.
    _thread: PhantomData<Rc<()>>,
}

fn transition(
    requested: &mut bool,
    active: bool,
    apply: impl FnOnce(bool) -> bool,
) -> Result<(), &'static str> {
    if *requested == active {
        return Ok(());
    }
    *requested = active;
    if apply(active) {
        Ok(())
    } else {
        Err("Could not update playback idle-sleep prevention")
    }
}

impl WakeLock {
    pub fn set_active(&mut self, active: bool) -> Result<(), &'static str> {
        transition(&mut self.requested, active, |active| {
            self.platform.set_active(active)
        })
    }
}
impl Drop for WakeLock {
    fn drop(&mut self) {
        let _ = self.platform.set_active(false);
    }
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct Platform {
    assertion: Option<u32>,
}
#[cfg(target_os = "macos")]
impl Platform {
    fn set_active(&mut self, active: bool) -> bool {
        use std::ffi::{c_char, c_void};
        #[link(name = "CoreFoundation", kind = "framework")]
        unsafe extern "C" {
            fn CFStringCreateWithCString(
                allocator: *const c_void,
                value: *const c_char,
                encoding: u32,
            ) -> *const c_void;
            fn CFRelease(value: *const c_void);
        }
        #[link(name = "IOKit", kind = "framework")]
        unsafe extern "C" {
            fn IOPMAssertionCreateWithName(
                kind: *const c_void,
                level: u32,
                name: *const c_void,
                assertion: *mut u32,
            ) -> i32;
            fn IOPMAssertionRelease(assertion: u32) -> i32;
        }
        if !active {
            if let Some(assertion) = self.assertion {
                // SAFETY: this guard owns the live assertion returned by IOKit.
                if unsafe { IOPMAssertionRelease(assertion) } != 0 {
                    return false;
                }
                self.assertion = None;
            }
            return true;
        }
        if self.assertion.is_some() {
            return true;
        }
        // This assertion prevents display dimming and therefore idle system sleep.
        // It does not override lid close, explicit Sleep, or emergency power policy.
        unsafe {
            let kind = CFStringCreateWithCString(
                std::ptr::null(),
                c"PreventUserIdleDisplaySleep".as_ptr(),
                0x08000100,
            );
            let name = CFStringCreateWithCString(
                std::ptr::null(),
                c"Navigator video playback".as_ptr(),
                0x08000100,
            );
            if kind.is_null() || name.is_null() {
                if !kind.is_null() {
                    CFRelease(kind);
                }
                if !name.is_null() {
                    CFRelease(name);
                }
                return false;
            }
            let mut assertion = 0;
            let result = IOPMAssertionCreateWithName(kind, 255, name, &mut assertion);
            CFRelease(kind);
            CFRelease(name);
            if result != 0 {
                return false;
            }
            self.assertion = Some(assertion);
        }
        true
    }
}

#[cfg(windows)]
#[derive(Default)]
struct Platform {
    active: bool,
}
#[cfg(windows)]
impl Platform {
    fn set_active(&mut self, active: bool) -> bool {
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn SetThreadExecutionState(flags: u32) -> u32;
        }
        if self.active == active {
            return true;
        }
        const CONTINUOUS: u32 = 0x80000000;
        const SYSTEM_REQUIRED: u32 = 0x00000001;
        const DISPLAY_REQUIRED: u32 = 0x00000002;
        let flags = CONTINUOUS
            | if active {
                SYSTEM_REQUIRED | DISPLAY_REQUIRED
            } else {
                0
            };
        // SAFETY: calls stay on the dedicated player thread for this guard's lifetime.
        if unsafe { SetThreadExecutionState(flags) } == 0 {
            return false;
        }
        self.active = active;
        true
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
#[derive(Default)]
struct Platform;
#[cfg(not(any(target_os = "macos", windows)))]
impl Platform {
    fn set_active(&mut self, _active: bool) -> bool {
        true
    }
}

pub fn playback_active(file_open: bool, current: bool, paused: bool) -> bool {
    file_open && current && !paused
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn playback_policy_and_transitions() {
        for (label, open, current, paused, expected) in [
            ("playing or buffering", true, true, false, true),
            ("paused", true, true, true, false),
            ("stopped or ended", false, true, false, false),
            ("replaced session", true, false, false, false),
            ("no media", false, false, true, false),
        ] {
            assert_eq!(playback_active(open, current, paused), expected, "{label}");
        }
        let mut requested = false;
        let mut calls = Vec::new();
        for active in [false, true, true, false, false, true, false] {
            transition(&mut requested, active, |value| {
                calls.push(value);
                true
            })
            .unwrap();
        }
        assert_eq!(calls, [true, false, true, false]);
    }
    #[test]
    fn denied_requests_do_not_spin_and_can_retry_on_resume() {
        let mut requested = false;
        assert!(transition(&mut requested, true, |_| false).is_err());
        transition(&mut requested, true, |_| {
            panic!("Do not retry on every frame")
        })
        .unwrap();
        transition(&mut requested, false, |_| true).unwrap();
        transition(&mut requested, true, |_| true).unwrap();
    }
}
