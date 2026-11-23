//! Serializable placement is independent of the window toolkit so disconnected
//! displays and DPI changes can be regression-tested on every host.
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    pub width: f64,
    pub height: f64,
    pub maximized: bool,
}

pub struct Display {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

impl Placement {
    pub fn save(&self, path: &Path) {
        if let Ok(bytes) = serde_json::to_vec(self) {
            let temporary = path.with_extension("tmp");
            if std::fs::write(&temporary, bytes).is_ok() { let _ = std::fs::rename(temporary, path); }
        }
    }

    pub fn restore(&self, displays: &[Display]) -> Option<Self> {
        if !self.width.is_finite()
            || !self.height.is_finite()
            || !(480.0..=16384.0).contains(&self.width)
            || !(360.0..=16384.0).contains(&self.height)
        {
            return None;
        }
        let display = displays
            .iter()
            .find(|d| {
                let x = i64::from(self.x);
                let y = i64::from(self.y);
                x >= i64::from(d.x)
                    && x < i64::from(d.x) + i64::from(d.width)
                    && y >= i64::from(d.y)
                    && y < i64::from(d.y) + i64::from(d.height)
            })
            .or(displays.first())?;
        if !display.scale.is_finite() || display.scale <= 0.0 {
            return None;
        }
        // Leave room for caption/borders and the taskbar. The OS still owns
        // maximizing and snapping, so persisted dimensions are the normal size.
        let width = self
            .width
            .min((f64::from(display.width) / display.scale - 32.0).max(480.0));
        let height = self
            .height
            .min((f64::from(display.height) / display.scale - 80.0).max(360.0));
        let right = i64::from(display.x) + i64::from(display.width);
        let bottom = i64::from(display.y) + i64::from(display.height);
        let x = i64::from(self.x).clamp(
            i64::from(display.x),
            (right - (width * display.scale) as i64 - 16).max(i64::from(display.x)),
        );
        let y = i64::from(self.y).clamp(
            i64::from(display.y),
            (bottom - (height * display.scale) as i64 - 64).max(i64::from(display.y)),
        );
        Some(Self {
            x: x as i32,
            y: y as i32,
            width,
            height,
            maximized: self.maximized,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn disconnected_display_and_changed_scaling() {
        let saved = Placement {
            x: 6000,
            y: -1000,
            width: 1280.0,
            height: 800.0,
            maximized: true,
        };
        let display = Display {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
            scale: 2.0,
        };
        let restored = saved.restore(&[display]).unwrap();
        assert!((-1920..0).contains(&restored.x));
        assert!(restored.y >= 0);
        assert!(restored.width <= 960.0 && restored.height <= 540.0);
        assert!(restored.maximized);
    }
    #[test]
    fn corrupt_placement_is_ignored() {
        let mut saved = Placement {
            x: 0,
            y: 0,
            width: f64::NAN,
            height: 800.0,
            maximized: false,
        };
        assert!(saved.restore(&[]).is_none());
        saved.width = 1e12;
        assert!(
            saved
                .restore(&[Display {
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1080,
                    scale: 1.0
                }])
                .is_none()
        );
    }
}
