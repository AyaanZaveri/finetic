//! Windows HDR10 output policy. Pixel encoding and DXGI signaling are one contract.
//! The D3D11 render API uses vo_gpu, whose linear output is normalized to the
//! selected peak. Use absolute PQ here instead of treating that output as scRGB.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Output {
    #[default]
    Sdr,
    Hdr10 {
        peak: u32,
    },
}

impl Output {
    pub fn hdr(self) -> bool {
        matches!(self, Self::Hdr10 { .. })
    }

    pub fn options(self) -> Vec<(&'static str, String)> {
        let (primaries, transfer, peak) = match self {
            Self::Sdr => ("bt.709", "srgb", "auto".to_owned()),
            Self::Hdr10 { peak } => ("bt.2020", "pq", peak.to_string()),
        };
        vec![
            ("target-prim", primaries.into()),
            ("target-trc", transfer.into()),
            ("target-peak", peak),
            ("icc-profile", "".into()),
            ("video-output-levels", "full".into()),
        ]
    }
}

pub fn hdr_source(gamma: Option<&str>, primaries: Option<&str>) -> bool {
    matches!(gamma, Some("pq" | "hlg")) && matches!(primaries, Some("bt.2020" | "display-p3"))
}

pub fn choose(source_hdr: bool, display_hdr: bool, peak: f32, requested: Option<u32>) -> Output {
    if source_hdr && display_hdr && peak.is_finite() && (80.0..=10_000.0).contains(&peak) {
        let display_peak = peak.round().max(203.0) as u32;
        Output::Hdr10 { peak: requested.unwrap_or(display_peak).clamp(203, display_peak) }
    } else {
        Output::Sdr
    }
}

/// No frame is presented while a configuration is incomplete. The client-call
/// worker may change several properties, but none of those intermediate states
/// may be displayed with the old or new DXGI color space.
#[derive(Default)]
pub struct Transition {
    configured: Option<Output>,
    pending: Option<(u64, Output)>,
    generation: u64,
}
impl Transition {
    pub fn sdr() -> Self {
        Self {
            configured: Some(Output::Sdr),
            ..Self::default()
        }
    }
    pub fn request(&mut self, wanted: Output) -> Option<(u64, Output)> {
        if self.pending.is_some() || self.configured == Some(wanted) {
            return None;
        }
        self.generation = self.generation.wrapping_add(1);
        self.pending = Some((self.generation, wanted));
        self.pending
    }
    pub fn finish(&mut self, generation: u64, success: bool) -> Option<Output> {
        let (active, output) = self.pending?;
        if active != generation {
            return None;
        }
        self.pending = None;
        // A failed batch can have applied some properties. Require a complete
        // SDR restoration before presenting again, even if the old state was SDR.
        self.configured = success.then_some(output);
        Some(output)
    }
    pub fn ready(&self, wanted: Output) -> bool {
        self.pending.is_none() && self.configured == Some(wanted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_and_display_must_both_support_hdr() {
        for gamma in ["pq", "hlg"] {
            for primaries in ["bt.2020", "display-p3"] {
                assert!(hdr_source(Some(gamma), Some(primaries)));
            }
        }
        for gamma in [None, Some("srgb"), Some("bt.1886"), Some("unknown")] {
            assert!(!hdr_source(gamma, Some("bt.2020")));
        }
        assert!(!hdr_source(Some("pq"), None));
        for peak in [f32::NAN, f32::INFINITY, 0.0, -1.0, 10_001.0] {
            assert_eq!(choose(true, true, peak, None), Output::Sdr);
        }
        assert_eq!(choose(true, false, 600.0, Some(500)), Output::Sdr);
        assert_eq!(choose(false, true, 600.0, Some(500)), Output::Sdr);
        assert_eq!(choose(true, true, 600.4, None), Output::Hdr10 { peak: 600 });
        assert_eq!(choose(true, true, 1600.0, Some(1000)), Output::Hdr10 { peak: 1000 });
        assert_eq!(choose(true, true, 600.0, Some(1600)), Output::Hdr10 { peak: 600 });
        let hdr = Output::Hdr10 { peak: 600 }.options();
        assert!(hdr.contains(&("target-prim", "bt.2020".into())));
        assert!(hdr.contains(&("target-trc", "pq".into())));
        assert!(hdr.contains(&("target-peak", "600".into())));
    }

    #[test]
    fn incomplete_stale_and_failed_configs_never_present() {
        let mut state = Transition::sdr();
        let hdr = Output::Hdr10 { peak: 600 };
        assert!(state.ready(Output::Sdr));
        let (first, _) = state.request(hdr).unwrap();
        assert!(!state.ready(hdr));
        assert!(!state.ready(Output::Sdr));
        assert!(state.request(Output::Sdr).is_none());
        assert_eq!(state.finish(first + 1, true), None);
        assert!(!state.ready(hdr));
        assert_eq!(state.finish(first, false), Some(hdr));
        assert!(
            !state.ready(Output::Sdr),
            "Partial failure must restore every SDR option"
        );
        let (restore, _) = state.request(Output::Sdr).unwrap();
        assert!(state.finish(first, true).is_none());
        state.finish(restore, true);
        assert!(state.ready(Output::Sdr));
        let (next, _) = state.request(hdr).unwrap();
        state.finish(next, true);
        assert!(state.ready(hdr));
        assert!(!state.ready(Output::Sdr));
        let (back, _) = state.request(Output::Sdr).unwrap();
        state.finish(back, true);
        assert!(state.ready(Output::Sdr));
    }
}
