// SPDX-License-Identifier: AGPL-3.0-only
// Adapted from AIOStreams c358754b0ae4758d034badf8618de6fdb7fa9333,
// packages/desktop/app/src/platform/macos/video.rs (OpenGL HDR path only).
// See desktop/THIRD-PARTY.md for provenance and modifications.

use crate::{
    hdr::{SDR_OUTPUT_OPTIONS, Video, defer_sdr_reset, output_peak},
    mpv::Mpv,
};
use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchTime};
use objc2::{
    MainThreadMarker,
    rc::Retained,
    runtime::{NSObjectProtocol, ProtocolObject},
};
use objc2_app_kit::{NSApplicationDidChangeScreenParametersNotification, NSScreen, NSView};
use objc2_core_foundation::CFString;
use objc2_core_graphics::CGColorSpace;
use objc2_foundation::{NSNotification, NSNotificationCenter, NSOperationQueue};
use objc2_quartz_core::CAOpenGLLayer;
use std::{cell::RefCell, ptr::NonNull, sync::Arc, time::Duration};

#[derive(Clone, Copy, PartialEq, Eq)]
struct Applied {
    video: Video,
    peak: u32,
}

#[derive(Default)]
struct State {
    mpv: Option<Arc<Mpv>>,
    layer: Option<Retained<CAOpenGLLayer>>,
    view: Option<Retained<NSView>>,
    float_surface: bool,
    video: Option<Video>,
    peak_override: Option<u32>,
    applied: Option<Applied>,
    sdr_configured: bool,
    generation: u64,
    refresh_pending: bool,
    observer: Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
}

thread_local! { static STATE: RefCell<State> = RefCell::default(); }

pub fn attach(
    layer: Retained<CAOpenGLLayer>,
    view: Retained<NSView>,
    mpv: Arc<Mpv>,
    float_surface: bool,
) {
    let block = RcBlock::new(|_: NonNull<NSNotification>| refresh());
    // AppKit notifications are observed only on the main queue.
    let observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(NSApplicationDidChangeScreenParametersNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        )
    };
    STATE.with_borrow_mut(|s| {
        s.layer = Some(layer);
        s.view = Some(view);
        s.mpv = Some(mpv);
        s.float_surface = float_surface;
        s.observer = Some(observer);
        s.switch_off();
    });
    if !float_surface {
        log::warn!("HDR unavailable: using an 8-bit OpenGL surface; keeping SDR tone mapping");
    }
}

/// The worker reads mpv's metadata; all Core Animation work stays on the main queue.
pub fn update(gamma: Option<String>, primaries: Option<String>) {
    DispatchQueue::main().exec_async(move || {
        let defer_reset = defer_sdr_reset(gamma.as_deref());
        let video = Video::from_metadata(gamma.as_deref(), primaries.as_deref());
        let (wait, generation) = STATE.with_borrow_mut(|s| {
            s.generation = s.generation.wrapping_add(1);
            let wait = video.is_none() && s.applied.is_some() && defer_reset;
            s.video = video;
            (wait, s.generation)
        });
        // Retain EDR through short gaps between files, as AIOStreams does.
        if wait {
            after(Duration::from_millis(1500), move || {
                if STATE.with_borrow(|s| s.generation) == generation {
                    apply();
                }
            });
        } else {
            apply();
        }
    });
}

/// Coalesce window/display/brightness changes without polling every video frame.
pub fn refresh() {
    let queued = STATE.with_borrow_mut(|s| std::mem::replace(&mut s.refresh_pending, true));
    if !queued {
        after(Duration::from_millis(250), || {
            STATE.with_borrow_mut(|s| s.refresh_pending = false);
            apply();
        });
    }
}

pub fn set_peak(nits: Option<u32>) {
    let changed = STATE.with_borrow_mut(|s| std::mem::replace(&mut s.peak_override, nits) != nits);
    if changed {
        apply();
    }
}

fn after(delay: Duration, work: impl FnOnce() + Send + 'static) {
    if let Ok(when) = DispatchTime::try_from(delay) {
        let _ = DispatchQueue::main().after(when, work);
    }
}

fn apply() {
    let view = STATE.with_borrow(|s| s.view.clone());
    let screen = view
        .as_deref()
        .and_then(|v| v.window())
        .and_then(|w| w.screen())
        .or_else(|| MainThreadMarker::new().and_then(NSScreen::mainScreen));
    let (current, potential) = screen.map_or((1.0, 1.0), |s| {
        (
            s.maximumExtendedDynamicRangeColorComponentValue(),
            s.maximumPotentialExtendedDynamicRangeColorComponentValue(),
        )
    });
    STATE.with_borrow_mut(|s| {
        log::debug!(
            "HDR display current={current:.2} potential={potential:.2} float={} video={:?}",
            s.float_surface,
            s.video
        );
        let peak = output_peak(
            current,
            potential,
            s.float_surface,
            s.applied.map(|a| a.peak),
            s.peak_override,
        );
        match s.video.zip(peak) {
            Some((video, peak)) => s.switch_on(Applied { video, peak }),
            None => s.switch_off(),
        }
    });
}

impl State {
    fn switch_on(&mut self, want: Applied) {
        if self.applied == Some(want) {
            return;
        }
        let (Some(layer), Some(mpv)) = (self.layer.clone(), self.mpv.clone()) else {
            return;
        };
        if self.applied.is_none_or(|old| old.video != want.video) {
            self.switch_off();
            let name = CFString::from_static_str(want.video.colorspace);
            let Some(space) = CGColorSpace::with_name(Some(&name)) else {
                log::warn!("HDR colorspace unavailable; keeping SDR output");
                return;
            };
            layer.setColorspace(Some(&space));
            layer.setWantsExtendedDynamicRangeContent(true);
            self.sdr_configured = false;
            // HLG/PQ input is rendered as PQ; an ICC profile would turn it back into SDR.
            for (name, value) in [
                ("target-prim", want.video.primaries),
                ("target-trc", "pq"),
                ("icc-profile", ""),
            ] {
                set(&mpv, name, value);
            }
        }
        set(&mpv, "target-peak", &want.peak.to_string());
        log::info!(
            "HDR on primaries={} target-peak={}",
            want.video.primaries,
            want.peak
        );
        self.applied = Some(want);
    }

    fn switch_off(&mut self) {
        // A queued display refresh may arrive after shutdown. Only mark SDR
        // configured when there is an actual layer and mpv instance to configure.
        if self.layer.is_none() || self.mpv.is_none() {
            return;
        }
        if self.applied.take().is_none() && self.sdr_configured {
            return;
        }
        let Some(space) =
            CGColorSpace::with_name(Some(&CFString::from_static_str("kCGColorSpaceSRGB")))
        else {
            log::error!("Unable to create the SDR sRGB colorspace");
            return;
        };
        if let Some(layer) = &self.layer {
            layer.setWantsExtendedDynamicRangeContent(false);
            layer.setColorspace(Some(&space));
        }
        if let Some(mpv) = &self.mpv {
            for &(name, value) in SDR_OUTPUT_OPTIONS {
                set(mpv, name, value);
            }
        }
        self.sdr_configured = true;
        log::info!("SDR output: sRGB layer, BT.709/sRGB full-range pixels");
    }
}

fn set(mpv: &Mpv, name: &str, value: &str) {
    // A render API's main thread must never block on mpv's dispatch lock.
    if let Err(error) = mpv.set_property_async(name, value) {
        log::warn!("HDR mpv {name}={value}: {error}");
    }
}

pub fn shutdown() {
    STATE.with_borrow_mut(|s| {
        s.switch_off();
        if let Some(observer) = s.observer.take() {
            unsafe {
                NSNotificationCenter::defaultCenter().removeObserver((*observer).as_ref());
            }
        }
        *s = State::default();
    });
}

/// Native integration-check state; never exposed through the web bridge.
pub fn diagnostics() -> (bool, f64, bool, bool) {
    STATE.with_borrow(|s| {
        let potential = s
            .view
            .as_deref()
            .and_then(|v| v.window())
            .and_then(|w| w.screen())
            .map_or(1.0, |screen| {
                screen.maximumPotentialExtendedDynamicRangeColorComponentValue()
            });
        let active = s
            .layer
            .as_ref()
            .is_some_and(|layer| layer.wantsExtendedDynamicRangeContent());
        let configured = s.applied.is_some()
            && s.layer
                .as_ref()
                .is_some_and(|layer| layer.colorspace().is_some());
        (s.float_surface, potential, active, configured)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mpv::Kind;
    use std::time::Instant;

    #[test]
    #[ignore = "set NAVIGATOR_TEST_LIBMPV to the packaged native library"]
    fn native_sdr_hdr_sdr_output_round_trip() {
        let library = std::env::var("NAVIGATOR_TEST_LIBMPV").unwrap();
        let mut options = vec![
            ("config", "no"),
            ("vo", "null"),
            ("ao", "null"),
            ("idle", "yes"),
            ("terminal", "no"),
        ];
        options.extend_from_slice(SDR_OUTPUT_OPTIONS);
        let mpv = Arc::new(Mpv::new(std::path::Path::new(&library), &options).unwrap());
        let layer = CAOpenGLLayer::layer();
        let mut state = State {
            mpv: Some(mpv.clone()),
            layer: Some(layer.clone()),
            ..Default::default()
        };
        let space_name =
            || CGColorSpace::name(layer.colorspace().as_deref()).map(|name| name.to_string());
        state.switch_off();
        assert_eq!(space_name().as_deref(), Some("kCGColorSpaceSRGB"));
        assert!(!layer.wantsExtendedDynamicRangeContent());

        for (gamma, primaries) in [("pq", "bt.2020"), ("hlg", "bt.2020"), ("pq", "display-p3")] {
            let video = Video::from_metadata(Some(gamma), Some(primaries)).unwrap();
            state.switch_on(Applied { video, peak: 812 });
            assert!(layer.wantsExtendedDynamicRangeContent());
            assert_eq!(space_name().as_deref(), Some(video.colorspace));
            let until = Instant::now() + Duration::from_secs(3);
            while mpv
                .get_property("target-trc", Kind::String)
                .as_ref()
                .and_then(serde_json::Value::as_str)
                != Some("pq")
            {
                assert!(Instant::now() < until, "HDR must retain PQ output");
                std::thread::sleep(Duration::from_millis(10));
            }
            state.switch_off();
            assert!(!layer.wantsExtendedDynamicRangeContent());
            assert_eq!(space_name().as_deref(), Some("kCGColorSpaceSRGB"));
            let until = Instant::now() + Duration::from_secs(3);
            while mpv
                .get_property("target-trc", Kind::String)
                .as_ref()
                .and_then(serde_json::Value::as_str)
                != Some("srgb")
            {
                assert!(Instant::now() < until, "SDR must restore sRGB output");
                std::thread::sleep(Duration::from_millis(10));
            }
            assert_eq!(
                mpv.get_property("target-prim", Kind::String)
                    .as_ref()
                    .and_then(serde_json::Value::as_str),
                Some("bt.709")
            );
        }
    }
}
