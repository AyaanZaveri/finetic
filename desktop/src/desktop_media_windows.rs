use super::{Action, Metadata, Timeline};
use std::sync::Arc;
use windows::{
    Foundation::{TimeSpan, TypedEventHandler, Uri},
    Media::{
        MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls,
        SystemMediaTransportControlsButton, SystemMediaTransportControlsTimelineProperties,
    },
    Storage::Streams::RandomAccessStreamReference,
    Win32::{
        Foundation::HWND,
        System::WinRT::{
            ISystemMediaTransportControlsInterop, RO_INIT_SINGLETHREADED, RoInitialize,
            RoUninitialize,
        },
    },
    core::{HSTRING, Result, factory},
};

struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { RoUninitialize() }
    }
}

pub struct Controls {
    controls: SystemMediaTransportControls,
    timeline: SystemMediaTransportControlsTimelineProperties,
    buttons: i64,
    seek: Option<i64>,
    metadata: Option<Metadata>,
    last_timeline: Option<Timeline>,
    _apartment: Apartment,
}

impl Controls {
    pub fn new(window: HWND, dispatch: impl Fn(Action) + Send + Sync + 'static) -> Result<Self> {
        unsafe {
            RoInitialize(RO_INIT_SINGLETHREADED)?;
        }
        let apartment = Apartment;
        let interop =
            factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()?;
        let controls: SystemMediaTransportControls = unsafe { interop.GetForWindow(window)? };
        controls.SetIsEnabled(false)?;
        controls.SetIsPlayEnabled(true)?;
        controls.SetIsPauseEnabled(true)?;
        let timeline = SystemMediaTransportControlsTimelineProperties::new()?;
        let dispatch = Arc::new(dispatch);
        let on_button = dispatch.clone();
        let buttons = controls.ButtonPressed(&TypedEventHandler::<
            SystemMediaTransportControls,
            windows::Media::SystemMediaTransportControlsButtonPressedEventArgs,
        >::new(move |_, event| {
            if let Some(event) = event.as_ref() {
                match event.Button()? {
                    SystemMediaTransportControlsButton::Play => on_button(Action::Play),
                    SystemMediaTransportControlsButton::Pause => on_button(Action::Pause),
                    _ => {}
                }
            }
            Ok(())
        }))?;
        let seek = controls
            .PlaybackPositionChangeRequested(&TypedEventHandler::<
                SystemMediaTransportControls,
                windows::Media::PlaybackPositionChangeRequestedEventArgs,
            >::new(move |_, event| {
                if let Some(event) = event.as_ref() {
                    dispatch(Action::Seek(
                        event.RequestedPlaybackPosition()?.Duration as f64 / 10_000_000.0,
                    ));
                }
                Ok(())
            }))
            .ok();
        Ok(Self {
            controls,
            timeline,
            buttons,
            seek,
            metadata: None,
            last_timeline: None,
            _apartment: apartment,
        })
    }

    pub fn sync(&mut self, state: Option<(&Metadata, Timeline)>) {
        let Some((metadata, timeline)) = state else {
            if self.metadata.take().is_some() {
                self.clear_system();
            }
            self.last_timeline = None;
            return;
        };
        if self.metadata.as_ref() != Some(metadata) {
            if let Err(error) = self.publish_metadata(metadata) {
                log::debug!("Could not publish system media metadata: {error}");
            }
            self.metadata = Some(metadata.clone());
            let _ = self.controls.SetIsEnabled(true);
        }
        if self.last_timeline != Some(timeline) {
            let status = if timeline.paused {
                MediaPlaybackStatus::Paused
            } else if timeline.buffering {
                MediaPlaybackStatus::Changing
            } else {
                MediaPlaybackStatus::Playing
            };
            if self.last_timeline.is_none_or(|last| {
                last.paused != timeline.paused || last.buffering != timeline.buffering
            }) {
                let _ = self.controls.SetPlaybackStatus(status);
            }
            if self
                .last_timeline
                .is_none_or(|last| last.rate != timeline.rate)
            {
                let _ = self.controls.SetPlaybackRate(timeline.rate);
            }
            let time = |seconds: f64| TimeSpan {
                Duration: (seconds * 10_000_000.0) as i64,
            };
            let _ = self.timeline.SetPosition(time(timeline.position));
            let _ = self.timeline.SetEndTime(time(timeline.duration));
            let _ = self.timeline.SetMaxSeekTime(time(timeline.duration));
            let _ = self.controls.UpdateTimelineProperties(&self.timeline);
            self.last_timeline = Some(timeline);
        }
    }

    fn publish_metadata(&self, metadata: &Metadata) -> Result<()> {
        let display = self.controls.DisplayUpdater()?;
        display.ClearAll()?;
        display.SetType(MediaPlaybackType::Video)?;
        let video = display.VideoProperties()?;
        video.SetTitle(&HSTRING::from(&metadata.title))?;
        video.SetSubtitle(&HSTRING::from(
            metadata.subtitle.as_deref().unwrap_or_default(),
        ))?;
        if let Some(url) = &metadata.artwork
            && let Ok(uri) = Uri::CreateUri(&HSTRING::from(url))
            && let Ok(poster) = RandomAccessStreamReference::CreateFromUri(&uri)
        {
            let _ = display.SetThumbnail(&poster);
        }
        display.Update()
    }

    fn clear_system(&self) {
        let _ = self.controls.SetPlaybackStatus(MediaPlaybackStatus::Closed);
        let _ = self.controls.SetIsEnabled(false);
        if let Ok(display) = self.controls.DisplayUpdater() {
            let _ = display.ClearAll();
            let _ = display.Update();
        }
    }
}

impl Drop for Controls {
    fn drop(&mut self) {
        self.clear_system();
        let _ = self.controls.RemoveButtonPressed(self.buttons);
        if let Some(seek) = self.seek {
            let _ = self.controls.RemovePlaybackPositionChangeRequested(seek);
        }
    }
}
