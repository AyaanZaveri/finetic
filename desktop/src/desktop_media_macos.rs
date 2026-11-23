use super::{Action, Metadata, Timeline};
use block2::RcBlock;
use objc2::{AnyThread, rc::Retained, runtime::AnyObject};
use objc2_app_kit::NSImage;
use objc2_foundation::{NSData, NSDictionary, NSNumber, NSString};
use objc2_media_player::*;
use std::{ptr::NonNull, sync::Arc, time::Duration};

pub struct Controls {
    center: Retained<MPNowPlayingInfoCenter>,
    targets: Vec<(Retained<MPRemoteCommand>, Retained<AnyObject>)>,
    artwork: Option<Retained<MPMediaItemArtwork>>,
    artwork_url: Option<String>,
    active: Option<(Metadata, Timeline)>,
    deliver_artwork: Arc<dyn Fn(String, Vec<u8>) + Send + Sync>,
}

impl Controls {
    pub fn new(
        dispatch: impl Fn(Action) + Send + Sync + 'static,
        deliver_artwork: impl Fn(String, Vec<u8>) + Send + Sync + 'static,
    ) -> Self {
        let dispatch = Arc::new(dispatch);
        // MediaPlayer retains our handler blocks. They only enqueue events and
        // never access AppKit or the playback engine from a callback thread.
        unsafe {
            let remote = MPRemoteCommandCenter::sharedCommandCenter();
            let mut targets = Vec::new();
            for (command, action) in [
                (remote.playCommand(), Some(Action::Play)),
                (remote.pauseCommand(), Some(Action::Pause)),
                (remote.togglePlayPauseCommand(), Some(Action::Toggle)),
                (remote.changePlaybackPositionCommand().into_super(), None),
            ] {
                let dispatch = dispatch.clone();
                let handler = RcBlock::new(move |event: NonNull<MPRemoteCommandEvent>| {
                    let action = match action {
                        Some(action) => action,
                        None => {
                            let seek = event
                                .as_ref()
                                .downcast_ref::<MPChangePlaybackPositionCommandEvent>();
                            let Some(seek) = seek else {
                                return MPRemoteCommandHandlerStatus::CommandFailed;
                            };
                            Action::Seek(seek.positionTime())
                        }
                    };
                    dispatch(action);
                    MPRemoteCommandHandlerStatus::Success
                });
                command.setEnabled(false);
                let token = command.addTargetWithHandler(&handler);
                targets.push((command, token));
            }
            Self {
                center: MPNowPlayingInfoCenter::defaultCenter(),
                targets,
                artwork: None,
                artwork_url: None,
                active: None,
                deliver_artwork: Arc::new(deliver_artwork),
            }
        }
    }

    pub fn sync(&mut self, state: Option<(&Metadata, Timeline)>) {
        let Some((metadata, timeline)) = state else {
            if self.active.take().is_some() {
                self.artwork = None;
                self.artwork_url = None;
                self.clear_system();
            }
            return;
        };
        if self
            .active
            .as_ref()
            .is_some_and(|(current, time)| current == metadata && *time == timeline)
        {
            return;
        }
        let update_commands = self
            .active
            .as_ref()
            .is_none_or(|(_, previous)| (previous.duration > 0.0) != (timeline.duration > 0.0));
        if self.artwork_url != metadata.artwork {
            self.artwork = None;
            self.artwork_url = metadata.artwork.clone();
            if let Some(url) = self.artwork_url.clone() {
                let deliver = self.deliver_artwork.clone();
                let _ = std::thread::Builder::new()
                    .name("navigator-now-playing-artwork".into())
                    .spawn(move || {
                        let agent: ureq::Agent = ureq::Agent::config_builder()
                            .max_redirects(0)
                            .https_only(true)
                            .timeout_global(Some(Duration::from_secs(5)))
                            .build()
                            .into();
                        if let Ok(mut response) = agent.get(&url).call()
                            && let Ok(bytes) = response
                                .body_mut()
                                .with_config()
                                .limit(2 * 1024 * 1024)
                                .read_to_vec()
                        {
                            deliver(url, bytes);
                        }
                    });
            }
        }
        self.active = Some((metadata.clone(), timeline));
        if update_commands {
            for (index, (command, _)) in self.targets.iter().enumerate() {
                unsafe {
                    command.setEnabled(index < 3 || timeline.duration > 0.0);
                }
            }
        }
        self.publish();
    }

    pub fn receive_artwork(&mut self, url: String, bytes: Vec<u8>) {
        if self.artwork_url.as_deref() != Some(&url) {
            return;
        }
        let Some(image) = NSImage::initWithData(NSImage::alloc(), &NSData::from_vec(bytes)) else {
            return;
        };
        let size = image.size();
        if size.width <= 0.0 || size.height <= 0.0 {
            return;
        }
        // The retained image lives as long as this copied artwork block does.
        let handler = RcBlock::new(move |_| NonNull::from(&*image));
        self.artwork = Some(unsafe {
            MPMediaItemArtwork::initWithBoundsSize_requestHandler(
                MPMediaItemArtwork::alloc(),
                size,
                &handler,
            )
        });
        self.publish();
    }

    fn publish(&self) {
        let Some((metadata, timeline)) = &self.active else {
            return;
        };
        let rate = if timeline.paused || timeline.buffering {
            0.0
        } else {
            timeline.rate
        };
        unsafe {
            let title = NSString::from_str(&metadata.title);
            let subtitle = NSString::from_str(metadata.subtitle.as_deref().unwrap_or_default());
            let position = NSNumber::new_f64(timeline.position);
            let duration = NSNumber::new_f64(timeline.duration);
            let rate = NSNumber::new_f64(rate);
            let mut keys = vec![
                MPMediaItemPropertyTitle,
                MPMediaItemPropertyArtist,
                MPMediaItemPropertyPlaybackDuration,
                MPNowPlayingInfoPropertyElapsedPlaybackTime,
                MPNowPlayingInfoPropertyPlaybackRate,
            ];
            let mut objects: Vec<&AnyObject> = vec![&title, &subtitle, &duration, &position, &rate];
            if let Some(artwork) = &self.artwork {
                keys.push(MPMediaItemPropertyArtwork);
                objects.push(artwork);
            }
            let info = NSDictionary::from_slices(&keys, &objects);
            self.center.setNowPlayingInfo(Some(&info));
            self.center.setPlaybackState(if timeline.paused {
                MPNowPlayingPlaybackState::Paused
            } else {
                MPNowPlayingPlaybackState::Playing
            });
        }
    }

    fn clear_system(&self) {
        unsafe {
            self.center
                .setPlaybackState(MPNowPlayingPlaybackState::Stopped);
            self.center.setNowPlayingInfo(None);
            for (command, _) in &self.targets {
                command.setEnabled(false);
            }
        }
    }
}

impl Drop for Controls {
    fn drop(&mut self) {
        self.clear_system();
        for (command, target) in &self.targets {
            unsafe {
                command.removeTarget(Some(target));
            }
        }
    }
}
