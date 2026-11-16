//! Keyframe previews outside the playback decoder, using AIOStreams/media.
use aiostreams_container::Options;
use aiostreams_thumbs::{Session, Settings, Thumbnail};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, Weak},
    time::Duration,
};

type Emit = Arc<dyn Fn(Value) + Send + Sync>;
#[derive(Clone, Copy)]
struct Request {
    id: u64,
    position: u64,
}
struct State {
    decoder: Option<Session>,
    wanted: Option<Request>,
    expected: Option<u64>,
    closed: bool,
    unavailable: bool,
}
struct Shared {
    state: Mutex<State>,
    session: String,
    emit: Emit,
    images: Option<crate::thumbnail_images::ImageServer>,
}

/// Dropping a source cancels publication, even if a bounded HTTP read is finishing.
pub struct Previews {
    shared: Arc<Shared>,
}
impl Previews {
    pub fn new(
        session: String,
        url: String,
        headers: BTreeMap<String, String>,
        emit: Emit,
    ) -> Self {
        let mut token = [0_u8; 16];
        let images = getrandom::getrandom(&mut token).ok().and_then(|_| {
            crate::thumbnail_images::ImageServer::start(
                token.iter().map(|b| format!("{b:02x}")).collect(),
            )
            .ok()
        });
        let shared = Arc::new(Shared {
            session,
            emit,
            images,
            state: Mutex::new(State {
                decoder: None,
                wanted: None,
                expected: None,
                closed: false,
                unavailable: false,
            }),
        });
        let opened = shared.clone();
        let _ = std::thread::Builder::new()
            .name("preview-index".into())
            .spawn(move || {
                let options = Options {
                    headers: headers.into_iter().collect(),
                    timeout: Duration::from_secs(4),
                    connect_timeout: Duration::from_secs(3),
                    max_bytes: Some(256 << 20),
                    max_requests: Some(2048),
                    ..Options::default()
                };
                let settings = Settings {
                    width: 448,
                    quality: 72,
                    // The image server owns the 256-entry, 16 MiB cache. Keep
                    // a few working JPEGs in the decoder so late fetches cannot
                    // evict its current frame and trigger a duplicate download.
                    cache: if opened.images.is_some() { 4 } else { 96 },
                    workers: 2,
                    fetches: 2,
                    ..Settings::default()
                };
                let weak = Arc::downgrade(&opened);
                let result = Session::open(&url, options, settings, move |thumbnail| {
                    publish(&weak, thumbnail)
                });
                let mut state = opened.state.lock().unwrap();
                if state.closed {
                    return;
                }
                match result {
                    Ok(decoder) => state.decoder = Some(decoder),
                    Err(_) => state.unavailable = true,
                }
                let result = answer(&mut state, &opened);
                drop(state);
                if let Some((request, image)) = result {
                    send(&opened, Some(request), image);
                }
            });
        Self { shared }
    }

    pub fn session(&self) -> &str {
        &self.shared.session
    }
    pub fn want(&self, request: u64, position: Option<f64>) {
        let mut state = self.shared.state.lock().unwrap();
        state.wanted = position.map(|seconds| Request {
            id: request,
            position: (seconds * 1000.0) as u64,
        });
        state.expected = None;
        let result = answer(&mut state, &self.shared);
        drop(state);
        if let Some((request, image)) = result {
            send(&self.shared, Some(request), image);
        }
    }
}
type Picture = (u64, String);
fn picture(shared: &Shared, image: &Thumbnail) -> Picture {
    let src = shared
        .images
        .as_ref()
        .and_then(|images| {
            images
                .cached(image.time_ms)
                .or_else(|| images.insert(image.time_ms, &image.jpeg))
        })
        .unwrap_or_else(|| format!("data:image/jpeg;base64,{}", STANDARD.encode(&image.jpeg)));
    (image.time_ms, src)
}
fn answer(state: &mut State, shared: &Shared) -> Option<(Request, Option<Picture>)> {
    let wanted = state.wanted?;
    if state.unavailable {
        return Some((wanted, None));
    }
    let decoder = state.decoder.as_ref()?;
    let index = decoder.keyframes().at(wanted.position);
    let time = decoder.keyframes().entries.get(index)?.time_ms;
    state.expected = Some(time);
    if let Some(src) = shared
        .images
        .as_ref()
        .and_then(|images| images.cached(time))
    {
        return Some((wanted, Some((time, src))));
    }
    decoder
        .want(wanted.position, None)
        .map(|image| (wanted, Some(picture(shared, &image))))
}
fn publish(weak: &Weak<Shared>, image: Arc<Thumbnail>) {
    let Some(shared) = weak.upgrade() else {
        return;
    };
    let (wanted, current) = {
        let state = shared.state.lock().unwrap();
        if state.closed {
            return;
        }
        (state.wanted, state.expected == Some(image.time_ms))
    };
    // Retain useful completed work even when the pointer has moved on.
    let image = picture(&shared, &image);
    if let Some(wanted) = wanted {
        send(&shared, current.then_some(wanted), Some(image));
    }
}
fn send(shared: &Shared, request: Option<Request>, image: Option<Picture>) {
    let range = image.as_ref().and_then(|(time, _)| {
        let state = shared.state.lock().unwrap();
        let keys = state.decoder.as_ref()?.keyframes();
        let index = keys.at(*time);
        let start = keys.entries.get(index)?.time_ms;
        let end = keys
            .entries
            .get(index + 1)
            .map_or(keys.duration_ms, |entry| entry.time_ms);
        (*time == start && end > start)
            .then(|| json!({"start": start as f64 / 1000.0, "end": end as f64 / 1000.0}))
    });
    let (at, src) = image.map_or((None, None), |(time, src)| {
        (Some(time as f64 / 1000.0), Some(src))
    });
    if let Some(request) = request {
        (shared.emit)(
            json!({"type":"thumbnail", "session":shared.session, "request":request.id, "src":src, "position":at, "range":range}),
        );
    } else {
        (shared.emit)(
            json!({"type":"thumbnail-frame", "session":shared.session, "src":src, "position":at, "range":range}),
        );
    }
}
impl Drop for Previews {
    fn drop(&mut self) {
        let mut state = self.shared.state.lock().unwrap();
        state.closed = true;
        state.wanted = None;
        state.decoder = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::PathBuf, sync::mpsc, time::Instant};

    #[test]
    #[ignore = "set NAVIGATOR_TEST_LIBMPV and NAVIGATOR_TEST_HDR_DIR"]
    fn hdr_keyframe_preview_cache_and_cancellation() {
        let library = PathBuf::from(std::env::var("NAVIGATOR_TEST_LIBMPV").unwrap());
        aiostreams_thumbs::library_dirs(vec![library.parent().unwrap().to_path_buf()]);
        let directory = PathBuf::from(std::env::var("NAVIGATOR_TEST_HDR_DIR").unwrap());
        for file in ["pq", "hlg", "sdr"] {
            let (send, inbox) = mpsc::channel();
            let started = Instant::now();
            let previews = Previews::new(
                "preview-test".into(),
                directory
                    .join(format!("{file}.mkv"))
                    .to_string_lossy()
                    .into_owned(),
                BTreeMap::new(),
                Arc::new(move |value| {
                    let _ = send.send(value);
                }),
            );
            previews.want(1, Some(0.5));
            previews.want(2, Some(1.0));
            let first = loop {
                let value = inbox
                    .recv_timeout(Duration::from_secs(8))
                    .expect("A real HDR/SDR keyframe must decode");
                if value["request"] == 2 {
                    break value;
                }
            };
            let src = first["src"].as_str().expect("Preview must contain a JPEG");
            let bytes = if let Some(data) = src.strip_prefix("data:image/jpeg;base64,") {
                STANDARD.decode(data).unwrap()
            } else {
                ureq::get(src)
                    .call()
                    .unwrap()
                    .body_mut()
                    .read_to_vec()
                    .unwrap()
            };
            assert!(
                bytes.starts_with(&[0xff, 0xd8, 0xff]),
                "Native preview must be a real encoded JPEG"
            );
            println!(
                "{file} first preview: {:?}, {} bytes",
                started.elapsed(),
                bytes.len()
            );
            let cached = Instant::now();
            previews.want(3, Some(1.0));
            let repeat = inbox.recv_timeout(Duration::from_secs(1)).unwrap();
            assert_eq!(repeat["src"], first["src"]);
            assert_eq!(repeat["request"], 3);
            println!("{file} cached preview: {:?}", cached.elapsed());
            previews.want(4, None);
            assert!(
                inbox.recv_timeout(Duration::from_millis(40)).is_err(),
                "Cancelled previews must not publish"
            );
        }
    }
}
