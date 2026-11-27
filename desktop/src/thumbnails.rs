//! Keyframe previews outside the playback decoder, using AIOStreams/media.
use aiostreams_container::Options;
use aiostreams_thumbs::{Session, Settings, Thumbnail};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Arc, Condvar, Mutex, Weak},
    time::{Duration, Instant},
};

type Emit = Arc<dyn Fn(Value) + Send + Sync>;
const INDEXED_FRAME_WAIT: Duration = Duration::from_millis(2500);
// A range read can race playback's initial read. Never treat a transient
// failure as proof that a container has no usable preview index.
fn open_index<T>(
    mut open: impl FnMut() -> aiostreams_thumbs::Result<T>,
    mut retry: impl FnMut() -> bool,
) -> aiostreams_thumbs::Result<T> {
    let mut attempts = 0;
    loop {
        match open() {
            Err(error) if error.is_transient() && attempts < 2 => {
                attempts += 1;
                if !retry() {
                    return Err(error);
                }
            }
            result => return result,
        }
    }
}
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
    fallback: bool,
    requested_at: Instant,
    answered: bool,
}
struct Shared {
    state: Mutex<State>,
    wake: Condvar,
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
        library: Option<PathBuf>,
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
            wake: Condvar::new(),
            state: Mutex::new(State {
                decoder: None,
                wanted: None,
                expected: None,
                closed: false,
                unavailable: false,
                fallback: false,
                requested_at: Instant::now(),
                answered: false,
            }),
        });
        let opened = shared.clone();
        let _ = std::thread::Builder::new()
            .name("preview-index".into())
            .spawn(move || {
                let options = Options {
                    headers: headers.iter().map(|(name, value)| (name.clone(), value.clone())).collect(),
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
                    // Give the latest target a slot when two older range reads stall.
                    fetches: crate::media_cache::PREVIEW_READ_SLOTS,
                    ..Settings::default()
                };
                let result = open_index(
                    || {
                        let weak = Arc::downgrade(&opened);
                        Session::open(&url, options.clone(), settings.clone(), move |thumbnail| {
                            publish(&weak, thumbnail)
                        })
                    },
                    || {
                        if opened.state.lock().unwrap().closed {
                            return false;
                        }
                        std::thread::sleep(Duration::from_millis(400));
                        !opened.state.lock().unwrap().closed
                    },
                );
                let mut state = opened.state.lock().unwrap();
                if state.closed {
                    return;
                }
                let fallback_allowed = library.is_some()
                    && url::Url::parse(&url).ok().is_some_and(|parsed| matches!(parsed.scheme(), "http" | "https"));
                match result {
                    Ok(decoder) => state.decoder = Some(decoder),
                    Err(error) => {
                        // Error text can contain provider URLs or credentials.
                        let reason = match error {
                            aiostreams_thumbs::Error::Container(aiostreams_container::Error::Http(_)) => "range read failed",
                            aiostreams_thumbs::Error::Container(aiostreams_container::Error::NoIndex) => "no keyframe index",
                            aiostreams_thumbs::Error::Container(aiostreams_container::Error::Budget) => "index read budget exhausted",
                            aiostreams_thumbs::Error::Decode(_) => "unsupported decoder configuration",
                            _ => "unsupported or malformed container",
                        };
                        log::warn!("Seek preview index unavailable: {reason}");
                        state.unavailable = true;
                        // The full demuxer can still seek files with absent or
                        // unsupported cue tables. Only allow the same HTTP(S)
                        // media source that the native player already accepted.
                        state.fallback = fallback_allowed;
                    }
                }
                let result = answer(&mut state, &opened);
                if result.is_some() { state.answered = true; }
                drop(state);
                if let Some((request, image)) = result {
                    send(&opened, Some(request), image);
                }
                if fallback_allowed {
                    fallback_loop(&opened, &url, &headers, library.as_ref().unwrap());
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
        state.requested_at = Instant::now();
        state.answered = false;
        let result = answer(&mut state, &self.shared);
        if result.is_some() { state.answered = true; }
        drop(state);
        self.shared.wake.notify_all();
        if let Some((request, image)) = result {
            send(&self.shared, Some(request), image);
        }
    }
}
type Picture = (u64, String);
fn picture(shared: &Shared, image: &Thumbnail) -> Picture {
    store_picture(shared, image.time_ms, &image.jpeg)
}
fn store_picture(shared: &Shared, time: u64, jpeg: &[u8]) -> Picture {
    let src = shared
        .images
        .as_ref()
        .and_then(|images| {
            images
                .cached(time)
                .or_else(|| images.insert(time, jpeg))
        })
        .unwrap_or_else(|| format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg)));
    (time, src)
}
fn answer(state: &mut State, shared: &Shared) -> Option<(Request, Option<Picture>)> {
    let wanted = state.wanted?;
    if state.unavailable {
        if state.fallback {
            return None;
        }
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

fn fallback_loop(shared: &Shared, url: &str, headers: &BTreeMap<String, String>, library: &std::path::Path) {
    let mut decoder = None;
    let mut handled = None;
    loop {
        let wanted = {
            let mut state = shared.state.lock().unwrap();
            loop {
                if state.closed { return; }
                let mut wait = Duration::from_secs(10);
                if let Some(wanted) = state.wanted {
                    if state.fallback {
                        if handled != Some(wanted.id) { break wanted; }
                    } else if state.decoder.is_some() && !state.answered {
                        // Sparse packet failures are reported only to the
                        // decoder's logs, not via its frame callback. If the
                        // pointer settles without an answer, switch to the
                        // full demuxer rather than time out forever.
                        let remaining = INDEXED_FRAME_WAIT.saturating_sub(state.requested_at.elapsed());
                        if remaining.is_zero() {
                            log::warn!("Seek preview keyframe did not finish; using native demuxer fallback");
                            state.decoder = None;
                            state.expected = None;
                            state.unavailable = true;
                            state.fallback = true;
                            break wanted;
                        }
                        wait = remaining;
                    }
                }
                let (next, idle) = shared.wake.wait_timeout(state, wait).unwrap();
                state = next;
                if idle.timed_out() && decoder.is_some() {
                    // Release unused demux/decode buffers without holding the
                    // request mutex during native teardown.
                    drop(state);
                    decoder = None;
                    state = shared.state.lock().unwrap();
                }
            }
        };
        handled = Some(wanted.id);
        if let Some(src) = shared.images.as_ref().and_then(|images| images.cached(wanted.position)) {
            // A newer request can have arrived while the same frame was
            // decoding. The worker owns both cache-hit and fresh publication.
            let state = shared.state.lock().unwrap();
            let current = !state.closed && state.wanted.is_some_and(|request| request.id == wanted.id);
            drop(state);
            if current { send(shared, Some(wanted), Some((wanted.position, src))); }
            continue;
        }
        if decoder.is_none() {
            match crate::preview_fallback::Decoder::new(library, headers) {
                Ok(value) => decoder = Some(value),
                Err(_) => {
                    log::warn!("Seek preview fallback decoder could not initialize");
                    let mut state = shared.state.lock().unwrap();
                    state.fallback = false;
                    let result = answer(&mut state, shared);
                    drop(state);
                    if let Some((request, image)) = result { send(shared, Some(request), image); }
                    return;
                }
            }
        }
        let jpeg = decoder.as_mut().unwrap().frame(url, wanted.position, || {
            let state = shared.state.lock().unwrap();
            state.closed || state.wanted.is_none()
        });
        let image = jpeg.as_ref().map(|bytes| store_picture(shared, wanted.position, bytes));
        let state = shared.state.lock().unwrap();
        let current = !state.closed && state.wanted.is_some_and(|request| request.id == wanted.id);
        drop(state);
        if current { send(shared, Some(wanted), image); }
    }
}
fn publish(weak: &Weak<Shared>, image: Arc<Thumbnail>) {
    let Some(shared) = weak.upgrade() else {
        return;
    };
    let (wanted, current) = {
        let mut state = shared.state.lock().unwrap();
        if state.closed || state.fallback {
            return;
        }
        let current = state.expected == Some(image.time_ms);
        if current { state.answered = true; }
        (state.wanted, current)
    };
    shared.wake.notify_all();
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
        self.shared.wake.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::PathBuf, sync::mpsc, time::Instant};

    #[test]
    fn transient_index_reads_get_bounded_retries() {
        use aiostreams_container::Error as ContainerError;
        use aiostreams_thumbs::Error;
        let mut attempts = 0;
        let result = open_index(
            || {
                attempts += 1;
                if attempts < 3 {
                    Err(Error::Container(ContainerError::Http("temporary range failure".into())))
                } else {
                    Ok(42)
                }
            },
            || true,
        );
        assert_eq!(result.unwrap(), 42);
        assert_eq!(attempts, 3);
        let mut failures = 0;
        assert!(open_index(
            || {
                failures += 1;
                Err::<(), _>(Error::Container(ContainerError::Http("offline".into())))
            },
            || true,
        ).is_err());
        assert_eq!(failures, 3);
        let mut unsupported = 0;
        assert!(open_index(
            || {
                unsupported += 1;
                Err::<(), _>(Error::Container(ContainerError::NoIndex))
            },
            || panic!("A missing index must not cause repeated downloads"),
        ).is_err());
        assert_eq!(unsupported, 1);
        let mut cancelled = 0;
        assert!(open_index(
            || {
                cancelled += 1;
                Err::<(), _>(Error::Container(ContainerError::Http("closed".into())))
            },
            || false,
        ).is_err());
        assert_eq!(cancelled, 1);
    }

    #[test]
    #[ignore = "generated synthetic MKV fixtures and pinned libmpv required"]
    fn headless_webdl_preview_index_recovers_after_http_failure() {
        let library = PathBuf::from(std::env::var("NAVIGATOR_TEST_LIBMPV").unwrap());
        let _library_owner = crate::mpv::Mpv::new(&library, &[("config", "no"), ("vo", "null"), ("ao", "null"), ("idle", "yes"), ("terminal", "no")]).unwrap();
        aiostreams_thumbs::library_dirs(vec![library.parent().unwrap().to_path_buf()]);
        let directory = PathBuf::from(std::env::var("NAVIGATOR_TEST_PREVIEW_DIR").unwrap());
        let data = std::fs::read(directory.join("avc-stereo.mkv")).unwrap();
        let origin = crate::media_cache::tests::Origin::new(data.clone());
        origin.mode.store(3, std::sync::atomic::Ordering::SeqCst);
        let first = Session::open(&origin.url, Options::default(), Settings::default(), |_| {});
        assert!(first.err().is_some_and(|error| error.is_transient()), "The old one-shot index open fails on an actual HTTP 503");
        drop(origin);

        let origin = crate::media_cache::tests::Origin::new(data);
        origin.mode.store(3, std::sync::atomic::Ordering::SeqCst);
        let (send, inbox) = mpsc::channel();
        let previews = Previews::new("retry-webdl".into(), origin.url.clone(), BTreeMap::new(),
            Arc::new(move |value| { let _ = send.send(value); }), None);
        previews.want(1, Some(18.0));
        let reply = inbox.recv_timeout(Duration::from_secs(6)).expect("Retry must deliver a thumbnail before the UI deadline");
        assert_eq!(reply["request"], 1);
        let src = reply["src"].as_str().expect("The transient HTTP failure cannot disable preview extraction");
        let jpeg = if let Some(data) = src.strip_prefix("data:image/jpeg;base64,") {
            STANDARD.decode(data).unwrap()
        } else {
            ureq::get(src).call().unwrap().body_mut().read_to_vec().unwrap()
        };
        assert!(jpeg.starts_with(&[0xff, 0xd8, 0xff]));
        println!("WEB-DL preview recovered from an actual HTTP 503 and delivered a JPEG");
    }

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
                None,
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
