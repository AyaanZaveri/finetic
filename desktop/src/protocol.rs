use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use url::Url;

pub const PROTOCOL: u32 = 1;
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;

/// Deliberately exposes playback operations, never arbitrary mpv commands or paths.
#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Command {
    ClientStage {
        stage: ClientStage,
    },
    AppReady {
        dark: bool,
    },
    VideoFit {
        session: String,
        mode: VideoFitMode,
    },
    Load {
        session: String,
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default, rename = "startPosition")]
        start_position: f64,
    },
    MediaMetadata { session: String, title: String, subtitle: Option<String>, artwork: Option<String> },
    Play {
        session: String,
    },
    Pause {
        session: String,
    },
    Seek {
        session: String,
        position: f64,
    },
    Volume {
        session: String,
        volume: f64,
    },
    Muted {
        session: String,
        muted: bool,
    },
    Rate {
        session: String,
        rate: f64,
    },
    SubtitleDelay { session: String, seconds: f64 },
    AudioDelay { session: String, seconds: f64 },
    #[serde(alias = "mac-hdr-peak")]
    NativeHdrPeak { nits: Option<u32> },
    NativeEngine {
        engine: NativeEngine,
        #[serde(rename = "audioLanguage", default)]
        audio_language: Option<String>,
    },
    Track {
        session: String,
        kind: TrackKind,
        id: String,
    },
    Stop {
        session: String,
    },
    Fullscreen {
        value: bool,
    },
    UpdateStatus {},
    UpdateCheck { #[serde(default)] intent: Option<UpdateIntent> },
    UpdateAutomatic { enabled: bool },
    WindowDrag {
        #[serde(default, rename = "doubleClick")]
        double_click: bool,
    },
    WindowControlsVisible {
        visible: bool,
    },
    WindowControl {
        action: WindowAction,
    },
    GlassConsumed { slot: u32, sequence: u64 },
    Glass { session: String, active: bool },
    Thumbnail {
        session: String,
        request: u64,
        position: Option<f64>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateIntent {
    Prepare,
    Install,
}

impl UpdateIntent {
    pub fn for_state(intent: Option<Self>, state: &str) -> Option<Self> {
        match state {
            "ready" if intent != Some(Self::Prepare) => Some(Self::Install),
            "ready" | "checking" | "downloading" | "installing" => None,
            _ if intent != Some(Self::Install) => Some(Self::Prepare),
            _ => None,
        }
    }
}

#[cfg(test)]
#[test]
fn update_intent_distinguishes_preparing_from_restarting() {
    use UpdateIntent::{Install, Prepare};
    assert!(matches!(parse(r#"{"type":"update-check","intent":"install"}"#), Ok(Command::UpdateCheck { intent: Some(Install) })));
    assert!(parse(r#"{"type":"update-check","intent":"force"}"#).is_err());
    assert_eq!(UpdateIntent::for_state(Some(Prepare), "ready"), None);
    assert_eq!(UpdateIntent::for_state(Some(Install), "available"), None);
    assert_eq!(UpdateIntent::for_state(Some(Install), "installing"), None);
    assert_eq!(UpdateIntent::for_state(Some(Install), "ready"), Some(Install));
    assert_eq!(UpdateIntent::for_state(Some(Prepare), "available"), Some(Prepare));
    assert_eq!(UpdateIntent::for_state(None, "ready"), Some(Install));
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientStage {
    InterfaceHydrated,
    PlayRequested,
    PlayerMounted,
    StreamResolving,
    StreamResolved,
}
impl ClientStage {
    pub fn label(&self) -> &'static str {
        match self {
            Self::InterfaceHydrated => "client-interface-hydrated",
            Self::PlayRequested => "client-play-requested",
            Self::PlayerMounted => "client-player-mounted",
            Self::StreamResolving => "client-stream-resolving",
            Self::StreamResolved => "client-stream-resolved",
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum WindowAction {
    Minimize,
    ToggleMaximize,
    Close,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum VideoFitMode {
    Fit,
    Crop,
    Stretch,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    Audio,
    Subtitle,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeEngine {
    #[default]
    Automatic,
    Aether,
    Mpv,
}

pub fn parse(text: &str) -> Result<Command, String> {
    if text.len() > MAX_MESSAGE_BYTES {
        return Err("Message is too large".into());
    }
    let command: Command = serde_json::from_str(text).map_err(|e| e.to_string())?;
    match &command {
        Command::Load {
            session,
            url,
            headers,
            start_position,
        } => {
            if session.is_empty() || session.len() > 128 {
                return Err("Invalid playback session".into());
            }
            media_url(url)?;
            if !start_position.is_finite() || *start_position < 0.0 {
                return Err("Invalid start position".into());
            }
            if headers.len() > 32
                || headers.iter().any(|(name, value)| {
                    name.is_empty()
                        || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                        || value.contains(['\r', '\n', '\0'])
                        || value.len() > 8192
                })
            {
                return Err("Invalid request headers".into());
            }
        }
        Command::NativeEngine { audio_language: Some(language), .. }
            if language.len() > 64 || !language.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') => {
            return Err("Invalid audio language".into());
        }
        Command::GlassConsumed { slot, sequence } if *slot > 2 || *sequence == 0 || *sequence > 9_007_199_254_740_991 => {
            return Err("Invalid shared frame acknowledgment".into());
        }
        Command::Glass { session, .. } if session.is_empty() || session.len() > 128 => {
            return Err("Invalid playback session".into());
        }
        Command::MediaMetadata { session, title, subtitle, artwork }
            if session.is_empty() || session.len() > 128 || title.trim().is_empty() || title.len() > 1024
                || subtitle.as_ref().is_some_and(|line| line.len() > 1024)
                || artwork.as_ref().is_some_and(|url| url.len() > 2048) => {
            return Err("Invalid system media metadata".into());
        }
        Command::Seek { position, .. } if !position.is_finite() || *position < 0.0 => {
            return Err("Invalid seek position".into());
        }
        Command::Volume { volume, .. } if !volume.is_finite() || !(0.0..=1.0).contains(volume) => {
            return Err("Volume must be between 0 and 1".into());
        }
        Command::Rate { rate, .. } if !rate.is_finite() || !(0.25..=4.0).contains(rate) => {
            return Err("Playback speed must be between 0.25 and 4".into());
        }
        Command::SubtitleDelay { session, seconds } if session.is_empty() || session.len() > 128 || !seconds.is_finite() || !(-30.0..=30.0).contains(seconds) => {
            return Err("Invalid subtitle delay".into());
        }
        Command::AudioDelay { session, seconds } if session.is_empty() || session.len() > 128 || !seconds.is_finite() || !(-30.0..=30.0).contains(seconds) => {
            return Err("Invalid audio delay".into());
        }
        Command::NativeHdrPeak { nits: Some(nits) } if !(203..=10_000).contains(nits) => {
            return Err("Invalid HDR peak brightness".into());
        }
        Command::Track { id, .. } if id != "no" && id.parse::<u32>().is_err() => {
            return Err("Invalid track id".into());
        }
        Command::Thumbnail {
            position: Some(position),
            ..
        } if !position.is_finite() || *position < 0.0 => {
            return Err("Invalid preview position".into());
        }
        _ => {}
    }
    Ok(command)
}

pub fn media_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() || value.contains('\0')
    {
        return Err("Playback accepts HTTP and HTTPS streams only".into());
    }
    Ok(url)
}

pub fn origin(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.origin().ascii_serialization())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn audio_delay_boundary() {
        for seconds in ["-30", "-0.1", "0", "0.1", "30"] {
            assert!(matches!(parse(&format!(r#"{{"type":"audio-delay","session":"test","seconds":{seconds}}}"#)), Ok(Command::AudioDelay { .. })));
        }
        for seconds in ["-31", "31", "null", "1e999", "\"0.1\""] {
            assert!(parse(&format!(r#"{{"type":"audio-delay","session":"test","seconds":{seconds}}}"#)).is_err());
        }
        assert!(parse(r#"{"type":"audio-delay","session":"","seconds":0}"#).is_err());
    }
    #[test]
    fn playback_boundary() {
        for seconds in ["-30", "0", "0.1", "30"] {
            assert!(parse(&format!(r#"{{"type":"subtitle-delay","session":"test","seconds":{seconds}}}"#)).is_ok());
        }
        for invalid in [r#"{"type":"subtitle-delay","session":"","seconds":0}"#, r#"{"type":"subtitle-delay","session":"test","seconds":31}"#, r#"{"type":"subtitle-delay","session":"test","seconds":-31}"#] {
            assert!(parse(invalid).is_err());
        }
        assert!(parse(r#"{"type":"update-check"}"#).is_ok());
        assert!(parse(r#"{"type":"update-status"}"#).is_ok());
        assert!(parse(r#"{"type":"update-automatic","enabled":false}"#).is_ok());
        for invalid in [r#"{"type":"update-check","url":"https://evil.example"}"#, r#"{"type":"update-status","path":"x"}"#, r#"{"type":"update-automatic","enabled":"false"}"#] {
            assert!(parse(invalid).is_err());
        }

        assert!(parse(r#"{"type":"glass-consumed","slot":2,"sequence":1}"#).is_ok());
        for invalid in [r#"{"type":"glass-consumed","slot":3,"sequence":1}"#, r#"{"type":"glass-consumed","slot":0,"sequence":0}"#, r#"{"type":"glass-consumed","slot":0,"sequence":9007199254740992}"#] { assert!(parse(invalid).is_err()); }

        assert!(parse(r#"{"type":"client-stage","stage":"play-requested"}"#).is_ok());
        assert!(parse(r#"{"type":"client-stage","stage":"http://example.com"}"#).is_err());
        assert!(
            parse(r#"{"type":"client-stage","stage":"play-requested","url":"secret"}"#).is_err()
        );
        assert!(parse(r#"{"type":"app-ready","dark":true}"#).is_ok());
        assert!(matches!(parse(r#"{"type":"mac-hdr-peak","nits":1600}"#), Ok(Command::NativeHdrPeak { nits: Some(1600) })));
        assert!(matches!(parse(r#"{"type":"native-hdr-peak","nits":null}"#), Ok(Command::NativeHdrPeak { nits: None })));
        for nits in ["202", "10001", "-1", "1600.5", "\"1600\""] {
            assert!(parse(&format!(r#"{{"type":"mac-hdr-peak","nits":{nits}}}"#)).is_err());
        }
        assert!(parse(r#"{"type":"app-ready","dark":true,"url":"file:///x"}"#).is_err());
        assert!(parse(r#"{"type":"app-ready","dark":"true"}"#).is_err());
        for mode in ["fit", "crop", "stretch"] {
            assert!(
                parse(&format!(
                    r#"{{"type":"video-fit","session":"one","mode":"{mode}"}}"#
                ))
                .is_ok()
            );
        }
        assert!(parse(r#"{"type":"video-fit","session":"one","mode":"arbitrary"}"#).is_err());
        for url in [
            "file:///etc/passwd",
            "edl://x",
            "av://x",
            "/tmp/video",
            "https://example.com/\0x",
        ] {
            assert!(media_url(url).is_err());
        }
        assert!(parse(r#"{"type":"load","session":"one","url":"https://example.com/video.mkv","headers":{"Referer":"https://example.com"}}"#).is_ok());
        let resume = parse(r#"{"type":"load","session":"one","url":"https://example.com/video.mkv","startPosition":123.4}"#).unwrap();
        assert!(matches!(resume, Command::Load { start_position, .. } if start_position == 123.4));
        let legacy = parse(r#"{"type":"load","session":"one","url":"https://example.com/video.mkv"}"#).unwrap();
        assert!(matches!(legacy, Command::Load { start_position: 0.0, .. }));
        for value in ["-1", "null", "\"123\"", "1e999"] {
            assert!(parse(&format!(r#"{{"type":"load","session":"one","url":"https://example.com/video.mkv","startPosition":{value}}}"#)).is_err());
        }
        assert!(parse(r#"{"type":"load","session":"one","url":"https://example.com","headers":{"X-Test":"x\r\nInjected: x"}}"#).is_err());
        assert!(parse(r#"{"type":"seek","session":"one","position":-1}"#).is_err());
        assert!(parse(r#"{"type":"thumbnail","session":"one","request":1,"position":10}"#).is_ok());
        assert!(
            parse(r#"{"type":"thumbnail","session":"one","request":2,"position":null}"#).is_ok()
        );
        assert!(
            parse(r#"{"type":"thumbnail","session":"one","request":3,"position":-1}"#).is_err()
        );
        assert!(parse(r#"{"type":"thumbnail","session":"one","request":4,"position":0,"url":"file:///private/file"}"#).is_err());
        assert!(parse(r#"{"type":"volume","session":"one","volume":2}"#).is_err());
        assert!(parse(r#"{"type":"command","args":["run","sh"]}"#).is_err());
        assert!(parse(r#"{"type":"window-controls-visible","visible":false}"#).is_ok());
        assert!(parse(r#"{"type":"window-controls-visible","visible":true}"#).is_ok());
        assert!(parse(r#"{"type":"window-controls-visible","visible":"false"}"#).is_err());
        assert!(parse(r#"{"type":"window-controls-visible","visible":true,"script":"x"}"#).is_err());
        assert!(matches!(parse(r#"{"type":"window-drag"}"#), Ok(Command::WindowDrag { double_click: false })));
        assert!(matches!(parse(r#"{"type":"window-drag","doubleClick":true}"#), Ok(Command::WindowDrag { double_click: true })));
        assert!(parse(r#"{"type":"window-control","action":"toggle-maximize"}"#).is_ok());
        assert!(parse(r#"{"type":"window-control","action":"exec"}"#).is_err());
        assert!(parse(r#"{"type":"window-control","action":"close","script":"x"}"#).is_err());
        assert!(parse(r#"{"type":"window-drag","script":"arbitrary"}"#).is_err());
        assert!(parse(r#"{"type":"play","session":"one","extra":"ignored?"}"#).is_err());
        assert_ne!(
            origin("http://localhost:3000"),
            origin("http://localhost:3001")
        );
    }
}
