use crate::protocol::Command;
use serde_json::Value;

#[cfg(target_os = "macos")]
#[path = "desktop_media_macos.rs"]
mod native;
#[cfg(windows)]
#[path = "desktop_media_windows.rs"]
mod native;
#[cfg(any(windows, target_os = "macos"))]
pub use native::Controls;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Metadata {
    pub title: String,
    pub subtitle: Option<String>,
    pub artwork: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Timeline {
    pub position: f64,
    pub duration: f64,
    pub rate: f64,
    pub paused: bool,
    pub buffering: bool,
}

#[derive(Clone, Copy, Debug)]
pub enum Action {
    Play,
    Pause,
    Toggle,
    Seek(f64),
}

#[derive(Default)]
pub struct Session {
    owner: String,
    metadata: Option<Metadata>,
    timeline: Option<Timeline>,
    ready: bool,
}

impl Session {
    pub fn observe_command(&mut self, command: &Command) {
        match command {
            Command::Load { session, .. } => {
                *self = Self {
                    owner: session.clone(),
                    ..Default::default()
                };
            }
            Command::Stop { session } if *session == self.owner => self.clear(),
            Command::MediaMetadata {
                session,
                title,
                subtitle,
                artwork,
            } if *session == self.owner => {
                let artwork = artwork.as_deref().and_then(public_artwork);
                self.metadata = Some(Metadata {
                    title: title.clone(),
                    subtitle: subtitle.clone(),
                    artwork,
                });
            }
            _ => {}
        }
    }

    pub fn observe_event(&mut self, value: &Value) {
        if self.owner.is_empty() || value["session"].as_str() != Some(self.owner.as_str()) {
            return;
        }
        match value["type"].as_str() {
            Some("loading") => {
                self.ready = false;
                self.timeline = None;
            }
            Some("state") => {
                let state = &value["state"];
                let duration = state["duration"].as_f64().unwrap_or_default().max(0.0);
                self.timeline = Some(Timeline {
                    position: state["position"].as_f64().unwrap_or_default().max(0.0),
                    duration,
                    paused: state["paused"].as_bool().unwrap_or(true),
                    buffering: state["buffering"].as_bool().unwrap_or(false)
                        || state["seeking"].as_bool().unwrap_or(false),
                    rate: state["rate"].as_f64().unwrap_or(1.0),
                });
            }
            Some("ready") => self.ready = true,
            Some("error" | "ended") => self.clear(),
            _ => {}
        }
    }

    pub fn now_playing(&self) -> Option<(&Metadata, Timeline)> {
        if !self.ready {
            return None;
        }
        Some((self.metadata.as_ref()?, self.timeline?))
    }

    pub fn clear(&mut self) {
        *self = Self::default();
    }

    pub fn pause_for_close(&self) -> Option<Command> {
        (!self.owner.is_empty()).then(|| Command::Pause {
            session: self.owner.clone(),
        })
    }

    pub fn command(&self, action: Action) -> Option<Command> {
        let (_, timeline) = self.now_playing()?;
        let session = self.owner.clone();
        match action {
            Action::Play => Some(Command::Play { session }),
            Action::Pause => Some(Command::Pause { session }),
            Action::Toggle if timeline.paused => Some(Command::Play { session }),
            Action::Toggle => Some(Command::Pause { session }),
            Action::Seek(position) if position.is_finite() && timeline.duration > 0.0 => {
                Some(Command::Seek {
                    session,
                    position: position.clamp(0.0, timeline.duration),
                })
            }
            Action::Seek(_) => None,
        }
    }
}

// Use only public TMDB artwork, never playback URLs, local files, or credentials.
fn public_artwork(input: &str) -> Option<String> {
    let url = url::Url::parse(input).ok()?;
    (url.scheme() == "https"
        && url.host_str() == Some("image.tmdb.org")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().starts_with("/t/p/")
        && url.query().is_none()
        && url.fragment().is_none())
    .then(|| url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn system_controls_follow_only_the_current_ready_session() {
        let mut session = Session::default();
        let load = |id| Command::Load {
            session: id,
            url: "https://example.test/video".into(),
            headers: Default::default(),
            start_position: 0.0,
        };
        let metadata = |id| Command::MediaMetadata {
            session: id,
            title: "Title".into(),
            subtitle: None,
            artwork: None,
        };
        session.observe_command(&load("one".into()));
        session.observe_command(&metadata("one".into()));
        session.observe_event(&json!({"type":"state","session":"one","state":{"position":15,"duration":30,"paused":true}}));
        assert!(session.command(Action::Play).is_none());
        session.observe_event(&json!({"type":"ready","session":"one"}));
        assert!(
            matches!(session.command(Action::Toggle), Some(Command::Play { session }) if session == "one")
        );
        assert!(matches!(
            session.command(Action::Pause),
            Some(Command::Pause { .. })
        ));
        assert!(matches!(
            session.command(Action::Seek(35.0)),
            Some(Command::Seek { position: 30.0, .. })
        ));
        assert!(session.command(Action::Seek(f64::NAN)).is_none());
        session.observe_command(&load("two".into()));
        session.observe_command(&metadata("one".into()));
        session.observe_event(&json!({"type":"ready","session":"one"}));
        session.observe_command(&Command::Stop {
            session: "one".into(),
        });
        assert!(session.now_playing().is_none());
        assert!(
            matches!(session.pause_for_close(), Some(Command::Pause { session }) if session == "two")
        );
        session.observe_event(&json!({"type":"ended","session":"two"}));
        assert!(session.pause_for_close().is_none());
    }

    #[test]
    fn only_public_artwork_is_exposed_to_platform_apis() {
        assert!(public_artwork("https://image.tmdb.org/t/p/w500/example.jpg").is_some());
        for url in [
            "http://image.tmdb.org/t/p/w500/a.jpg",
            "https://image.tmdb.org.example/t/p/a.jpg",
            "https://credentials@image.tmdb.org/t/p/a.jpg",
            "https://image.tmdb.org/t/p/a.jpg?token=secret",
            "file:///tmp/poster.jpg",
            "https://127.0.0.1/t/p/a.jpg",
        ] {
            assert!(public_artwork(url).is_none(), "{url}");
        }
    }
}
