//! Per-load, memory-only HTTP byte cache shared by mpv and the preview decoder.
//! This stores source bytes, not mpv's demuxed packets. Never exposed to the UI.
use std::{
    collections::BTreeMap,
    io::{self, Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

const CAPACITY: usize = 64 << 20;
const CHUNK: usize = 64 << 10;
const MAX_PIECES: usize = 4096;
const PREVIEW_WAIT: Duration = Duration::from_millis(150);

type Headers = BTreeMap<String, String>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlaybackSourceMode {
    SharedCache,
    Direct,
}

impl PlaybackSourceMode {
    pub fn from_setting(value: Option<&str>) -> Self {
        match value {
            Some("direct") => Self::Direct,
            _ => Self::SharedCache,
        }
    }
}

fn invalid() -> io::Error {
    io::Error::other("Local media source unavailable")
}

struct Piece {
    data: Arc<[u8]>,
    used: u64,
    playback: bool,
}
#[derive(Default)]
struct Bytes {
    pieces: BTreeMap<u64, Piece>,
    bytes: usize,
    clock: u64,
}
impl Bytes {
    fn get(&mut self, at: u64) -> Option<(Arc<[u8]>, usize)> {
        self.clock = self.clock.wrapping_add(1);
        let (start, piece) = self
            .pieces
            .range_mut(..=at)
            .rev()
            .find(|(start, piece)| at - **start < piece.data.len() as u64)?;
        piece.used = self.clock;
        Some((piece.data.clone(), (at - *start) as usize))
    }
    fn next(&self, at: u64) -> Option<u64> {
        self.pieces.range(at..).next().map(|(start, _)| *start)
    }
    fn put(&mut self, at: u64, data: &[u8], playback: bool, capacity: usize) {
        if data.is_empty() || data.len() > capacity {
            return;
        }
        let Some(end) = at.checked_add(data.len() as u64) else {
            return;
        };
        if !playback
            && self
                .pieces
                .range(..end)
                .any(|(start, piece)| piece.playback && *start + piece.data.len() as u64 > at)
        {
            return;
        }
        // Overlapping entries are allowed. Remove entries fully superseded here.
        let replaced: Vec<_> = self
            .pieces
            .range(at..end)
            .filter(|(start, piece)| **start + piece.data.len() as u64 <= end || **start == at)
            .map(|(start, _)| *start)
            .collect();
        for key in replaced {
            self.bytes -= self.pieces.remove(&key).unwrap().data.len();
        }
        while self.bytes + data.len() > capacity || self.pieces.len() >= MAX_PIECES {
            let oldest = self
                .pieces
                .iter()
                .filter(|(_, piece)| playback || !piece.playback)
                .min_by_key(|(_, piece)| (piece.playback, piece.used))
                .map(|(key, _)| *key);
            let Some(oldest) = oldest else {
                return;
            }; // Previews never evict playback bytes.
            self.bytes -= self.pieces.remove(&oldest).unwrap().data.len();
        }
        self.clock = self.clock.wrapping_add(1);
        self.bytes += data.len();
        self.pieces.insert(
            at,
            Piece {
                data: Arc::from(data),
                used: self.clock,
                playback,
            },
        );
    }
}

#[derive(Clone, Debug)]
struct Entity {
    size: u64,
    etag: Option<String>,
    modified: Option<String>,
    mime: Option<String>,
    ranges: bool,
}
impl Entity {
    fn validator(&self) -> Option<&str> {
        self.etag
            .as_deref()
            .filter(|tag| !tag.starts_with("W/"))
            .or(self.modified.as_deref())
    }
    fn compatible(&self, other: &Self) -> bool {
        self.size == other.size
            && self
                .etag
                .as_ref()
                .is_none_or(|tag| other.etag.as_ref() == Some(tag))
            && self
                .modified
                .as_ref()
                .is_none_or(|date| other.modified.as_ref() == Some(date))
    }
}
struct Flight {
    id: u64,
    next: u64,
    end: u64,
}
#[derive(Default)]
struct State {
    bytes: Bytes,
    entity: Option<Entity>,
    flights: Vec<Flight>,
    next_id: u64,
    poisoned: bool,
}
struct Shared {
    original: String,
    headers: Headers,
    agent: ureq::Agent,
    state: Mutex<State>,
    changed: Condvar,
    closed: AtomicBool,
    playback_connections: AtomicUsize,
    preview_connections: AtomicUsize,
    capacity: usize,
}
impl Shared {
    fn cached(&self, at: u64, preview: bool) -> Option<(Arc<[u8]>, usize)> {
        let until = Instant::now() + PREVIEW_WAIT;
        let mut state = self.state.lock().unwrap();
        loop {
            if self.closed.load(Ordering::Acquire) || state.poisoned {
                return None;
            }
            if let Some(bytes) = state.bytes.get(at) {
                return Some(bytes);
            }
            // A preview may briefly wait for an imminent read, but playback never waits for previews.
            let imminent = state
                .flights
                .iter()
                .any(|f| at >= f.next && at <= f.end && at - f.next <= CHUNK as u64);
            let left = until.saturating_duration_since(Instant::now());
            if !preview || !imminent || left.is_zero() {
                return None;
            }
            state = self.changed.wait_timeout(state, left).unwrap().0;
        }
    }
    fn remember(&self, at: u64, bytes: &[u8], playback: bool) {
        let mut state = self.state.lock().unwrap();
        if !self.closed.load(Ordering::Acquire) && !state.poisoned {
            state.bytes.put(at, bytes, playback, self.capacity);
            self.changed.notify_all();
        }
    }
    fn entity(&self, next: Entity) -> io::Result<()> {
        let mut state = self.state.lock().unwrap();
        if state.poisoned {
            return Err(invalid());
        }
        if state
            .entity
            .as_ref()
            .is_some_and(|old| !old.compatible(&next))
        {
            state.bytes = Bytes::default();
            state.poisoned = true;
            self.changed.notify_all();
            return Err(invalid());
        }
        state.entity = Some(next);
        Ok(())
    }
    fn open(
        &self,
        method: &str,
        range: Option<&str>,
        validator: Option<&str>,
        preview: bool,
    ) -> io::Result<ureq::http::Response<ureq::Body>> {
        if self.closed.load(Ordering::Acquire) {
            return Err(invalid());
        }
        let mut request = if method == "HEAD" {
            self.agent.head(&self.original)
        } else {
            self.agent.get(&self.original)
        };
        for (name, value) in &self.headers {
            if !matches!(
                name.to_ascii_lowercase().as_str(),
                "host" | "range" | "if-range" | "connection" | "content-length" | "accept-encoding"
            ) {
                request = request.header(name, value);
            }
        }
        request = request.header("Accept-Encoding", "identity");
        if let Some(range) = range {
            request = request.header("Range", range);
        }
        if let Some(validator) = validator {
            request = request.header("If-Range", validator);
        }
        request
            .config()
            .timeout_per_call(preview.then_some(Duration::from_secs(4)))
            .build()
            .call()
            .map_err(|_| invalid())
    }
}

/// One isolated source, retired on replacement/stop. No cache files or database.
pub struct MediaSource {
    shared: Arc<Shared>,
    address: SocketAddr,
    path: String,
    worker: Option<JoinHandle<()>>,
}
impl MediaSource {
    pub fn for_playback(
        original: &str,
        headers: &Headers,
        mode: PlaybackSourceMode,
    ) -> Option<Self> {
        match mode {
            PlaybackSourceMode::Direct => None,
            PlaybackSourceMode::SharedCache => Self::new(original, headers),
        }
    }

    pub fn new(original: &str, headers: &Headers) -> Option<Self> {
        let url = url::Url::parse(original).ok()?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return None;
        }
        let extension = url.path().rsplit('.').next()?.to_ascii_lowercase();
        if !matches!(extension.as_str(), "mp4" | "m4v" | "mov" | "mkv" | "webm") {
            return None;
        }
        Self::start(original, headers, &extension, CAPACITY).ok()
    }
    fn start(
        original: &str,
        headers: &Headers,
        extension: &str,
        capacity: usize,
    ) -> io::Result<Self> {
        let mut token = [0_u8; 16];
        getrandom::getrandom(&mut token).map_err(|_| invalid())?;
        let token: String = token.iter().map(|byte| format!("{byte:02x}")).collect();
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
        let address = listener.local_addr()?;
        let path = format!("/{token}");
        let shared = Arc::new(Shared {
            original: original.into(),
            headers: headers.clone(),
            agent: ureq::Agent::config_builder()
                .http_status_as_error(false)
                .timeout_connect(Some(Duration::from_secs(5)))
                .timeout_recv_response(Some(Duration::from_secs(10)))
                .timeout_per_read(Some(Duration::from_secs(10)))
                .timeout_per_write(Some(Duration::from_secs(10)))
                .redirect_auth_headers(ureq::config::RedirectAuthHeaders::SameHost)
                .max_redirects(8)
                .build()
                .into(),
            state: Mutex::default(),
            changed: Condvar::new(),
            closed: AtomicBool::new(false),
            playback_connections: AtomicUsize::new(0),
            preview_connections: AtomicUsize::new(0),
            capacity,
        });
        let (source, prefix, extension) = (shared.clone(), path.clone(), extension.to_owned());
        let worker = std::thread::Builder::new()
            .name("media-source".into())
            .spawn(move || {
                for socket in listener.incoming() {
                    if source.closed.load(Ordering::Acquire) {
                        break;
                    }
                    let Ok(socket) = socket else {
                        break;
                    };
                    // Unauthenticated slow connections are bounded too.
                    if source.playback_connections.load(Ordering::Relaxed) >= 8 {
                        continue;
                    }
                    source.playback_connections.fetch_add(1, Ordering::Relaxed);
                    let (source, prefix, extension) =
                        (source.clone(), prefix.clone(), extension.clone());
                    let counted = source.clone();
                    if std::thread::Builder::new()
                        .name("media-read".into())
                        .spawn(move || {
                            let _slot = Slot(&source.playback_connections);
                            let _ = serve(socket, &source, &prefix, &extension, address);
                        })
                        .is_err()
                    {
                        counted.playback_connections.fetch_sub(1, Ordering::Relaxed);
                    }
                }
            })?;
        Ok(Self {
            shared,
            address,
            path,
            worker: Some(worker),
        })
    }
    pub fn playback_url(&self) -> String {
        format!(
            "http://{}{}/play.{}",
            self.address,
            self.path,
            extension(&self.shared.original)
        )
    }
    pub fn preview_url(&self) -> String {
        format!(
            "http://{}{}/preview.{}",
            self.address,
            self.path,
            extension(&self.shared.original)
        )
    }
}
fn extension(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|url| url.path().rsplit('.').next().map(str::to_ascii_lowercase))
        .unwrap_or_else(|| "mp4".into())
}
struct Slot<'a>(&'a AtomicUsize);
impl Drop for Slot<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}
impl Drop for MediaSource {
    fn drop(&mut self) {
        self.shared.closed.store(true, Ordering::Release);
        {
            let mut state = self.shared.state.lock().unwrap();
            state.bytes = Bytes::default();
            state.entity = None;
        }
        self.shared.changed.notify_all();
        let _ = TcpStream::connect_timeout(&self.address, Duration::from_millis(100));
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Range {
    All,
    From(u64, Option<u64>),
    Suffix(u64),
}
impl Range {
    fn parse(value: Option<&str>) -> io::Result<Self> {
        let Some(value) = value else {
            return Ok(Self::All);
        };
        let (start, end) = value
            .strip_prefix("bytes=")
            .and_then(|v| v.split_once('-'))
            .ok_or_else(invalid)?;
        if start.is_empty() {
            return end
                .parse::<u64>()
                .ok()
                .filter(|n| *n > 0)
                .map(Self::Suffix)
                .ok_or_else(invalid);
        }
        let start = start.parse::<u64>().map_err(|_| invalid())?;
        let end = if end.is_empty() {
            None
        } else {
            Some(end.parse::<u64>().map_err(|_| invalid())?)
        };
        if end.is_some_and(|end| end < start) {
            return Err(invalid());
        }
        Ok(Self::From(start, end))
    }
    fn bounds(self, size: u64) -> Option<(u64, u64)> {
        if size == 0 {
            return None;
        }
        let (start, end) = match self {
            Self::All => (0, size - 1),
            Self::Suffix(n) => (size.saturating_sub(n), size - 1),
            Self::From(start, end) => (start, end.unwrap_or(size - 1).min(size - 1)),
        };
        (start < size && start <= end).then_some((start, end))
    }
}

struct Request {
    method: String,
    path: String,
    host: String,
    range: Option<String>,
    forbidden: bool,
    #[cfg(test)]
    authorization: Option<String>,
}
fn request(socket: &mut TcpStream) -> io::Result<Request> {
    let mut bytes = Vec::new();
    let started = Instant::now();
    for _ in 0..8192 {
        let left = Duration::from_secs(3).saturating_sub(started.elapsed());
        if left.is_zero() {
            return Err(invalid());
        }
        socket.set_read_timeout(Some(left))?;
        let mut byte = [0];
        socket.read_exact(&mut byte)?;
        bytes.push(byte[0]);
        if bytes.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    if !bytes.ends_with(b"\r\n\r\n") {
        return Err(invalid());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| invalid())?;
    let mut lines = text.split("\r\n");
    let fields: Vec<_> = lines
        .next()
        .ok_or_else(invalid)?
        .split_whitespace()
        .collect();
    if fields.len() != 3 || !matches!(fields[2], "HTTP/1.1" | "HTTP/1.0") {
        return Err(invalid());
    }
    let mut request = Request {
        method: fields[0].into(),
        path: fields[1].into(),
        host: String::new(),
        range: None,
        forbidden: false,
        #[cfg(test)]
        authorization: None,
    };
    for line in lines.filter(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':').ok_or_else(invalid)?;
        let value = value.trim();
        match name.to_ascii_lowercase().as_str() {
            "host" if request.host.is_empty() => request.host = value.into(),
            "range" if request.range.is_none() => request.range = Some(value.into()),
            "authorization" => {
                #[cfg(test)]
                {
                    request.authorization = Some(value.into());
                }
            }
            "origin" | "if-range" | "transfer-encoding" | "content-length" | "host" | "range" => {
                request.forbidden = true
            }
            _ => {}
        }
    }
    Ok(request)
}
fn reply(socket: &mut TcpStream, status: u16, headers: &[(String, String)]) -> io::Result<()> {
    write!(
        socket,
        "HTTP/1.1 {status} {}\r\nConnection: close\r\nCache-Control: no-store\r\n",
        match status {
            200 => "OK",
            206 => "Partial Content",
            307 => "Temporary Redirect",
            416 => "Range Not Satisfiable",
            _ => "Unavailable",
        }
    )?;
    for (name, value) in headers {
        write!(socket, "{name}: {value}\r\n")?;
    }
    socket.write_all(b"\r\n")
}
fn reject(socket: &mut TcpStream, status: u16) -> io::Result<()> {
    reply(socket, status, &[("Content-Length".into(), "0".into())])
}
fn redirect(socket: &mut TcpStream, original: &str) -> io::Result<()> {
    reply(
        socket,
        307,
        &[
            ("Location".into(), original.into()),
            ("Content-Length".into(), "0".into()),
        ],
    )
}
fn header(response: &ureq::http::Response<ureq::Body>, name: &str) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}
fn content_range(value: &str) -> Option<(u64, u64, u64)> {
    let (interval, size) = value.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = interval.split_once('-')?;
    let (start, end, size) = (
        start.parse::<u64>().ok()?,
        end.parse::<u64>().ok()?,
        size.parse::<u64>().ok()?,
    );
    (start <= end && end < size).then_some((start, end, size))
}
fn describe(response: &ureq::http::Response<ureq::Body>) -> Option<(Entity, u64, u64)> {
    let (start, end, size) = if response.status().as_u16() == 206 {
        content_range(&header(response, "content-range")?)?
    } else if response.status().as_u16() == 200 {
        let size = header(response, "content-length")?.parse::<u64>().ok()?;
        if size == 0 {
            return None;
        }
        (0, size - 1, size)
    } else {
        return None;
    };
    let entity = Entity {
        size,
        etag: header(response, "etag"),
        modified: header(response, "last-modified"),
        mime: header(response, "content-type"),
        ranges: response.status().as_u16() == 206
            || header(response, "accept-ranges").is_some_and(|v| v == "bytes"),
    };
    Some((entity, start, end))
}
fn unsafe_type(response: &ureq::http::Response<ureq::Body>) -> bool {
    header(response, "content-encoding").is_some_and(|v| !v.eq_ignore_ascii_case("identity"))
        || header(response, "content-type").is_some_and(|v| {
            let v = v.to_ascii_lowercase();
            v.contains("mpegurl") || v.contains("dash+xml") || v.contains("text/html")
        })
}
fn flight(source: &Shared, start: u64, end: u64, preview: bool) -> io::Result<Reading<'_>> {
    let mut state = source.state.lock().unwrap();
    if preview
        && state
            .flights
            .iter()
            .any(|f| start >= f.next && start <= f.end && start - f.next <= CHUNK as u64)
    {
        // The cache wait expired. Do not add a competing preview download to a
        // stalled playback read; a later hover can retry it.
        return Err(invalid());
    }
    state.next_id += 1;
    let id = state.next_id;
    state.flights.push(Flight {
        id,
        next: start,
        end,
    });
    Ok(Reading { source, id })
}
struct Reading<'a> {
    source: &'a Shared,
    id: u64,
}
impl Drop for Reading<'_> {
    fn drop(&mut self) {
        self.source
            .state
            .lock()
            .unwrap()
            .flights
            .retain(|f| f.id != self.id);
        self.source.changed.notify_all();
    }
}
fn relay(
    socket: &mut TcpStream,
    source: &Shared,
    response: ureq::http::Response<ureq::Body>,
    start: u64,
    end: u64,
    preview: bool,
    reading: &Reading<'_>,
) -> io::Result<()> {
    let id = reading.id;
    let mut reader = response.into_body().into_reader();
    let mut at = start;
    let mut bytes = [0_u8; CHUNK];
    while at <= end && !source.closed.load(Ordering::Acquire) {
        let len = (end - at).saturating_add(1).min(CHUNK as u64) as usize;
        let n = reader.read(&mut bytes[..len])?;
        if n == 0 || source.closed.load(Ordering::Acquire) {
            return Err(invalid());
        }
        source.remember(at, &bytes[..n], !preview);
        at += n as u64;
        {
            let mut state = source.state.lock().unwrap();
            if let Some(f) = state.flights.iter_mut().find(|f| f.id == id) {
                f.next = at;
            }
        }
        socket.write_all(&bytes[..n])?;
    }
    Ok(())
}
fn serve(
    mut socket: TcpStream,
    source: &Shared,
    prefix: &str,
    extension: &str,
    address: SocketAddr,
) -> io::Result<()> {
    socket.set_read_timeout(Some(Duration::from_secs(3)))?;
    socket.set_write_timeout(Some(Duration::from_secs(3)))?;
    socket.set_nodelay(true)?;
    let Ok(request) = request(&mut socket) else {
        return reject(&mut socket, 400);
    };
    let preview = request.path == format!("{prefix}/preview.{extension}");
    if request.forbidden
        || request.host != address.to_string()
        || (!preview && request.path != format!("{prefix}/play.{extension}"))
    {
        return reject(&mut socket, 403);
    }
    if !matches!(request.method.as_str(), "GET" | "HEAD") {
        return reject(&mut socket, 405);
    }
    let Ok(range) = Range::parse(request.range.as_deref()) else {
        return reject(&mut socket, 400);
    };
    let _preview_slot = if preview {
        let prior = source.preview_connections.fetch_add(1, Ordering::Relaxed);
        let slot = Slot(&source.preview_connections);
        if prior >= 2 {
            return reject(&mut socket, 503);
        }
        Some(slot)
    } else {
        None
    };
    let entity = {
        let state = source.state.lock().unwrap();
        if state.poisoned || source.closed.load(Ordering::Acquire) {
            return reject(&mut socket, 410);
        }
        state.entity.clone().filter(|e| e.ranges)
    };
    if let Some(entity) = entity {
        let Some((start, end)) = range.bounds(entity.size) else {
            return reply(
                &mut socket,
                416,
                &[
                    ("Content-Range".into(), format!("bytes */{}", entity.size)),
                    ("Content-Length".into(), "0".into()),
                ],
            );
        };
        let mut headers = vec![
            ("Content-Length".into(), (end - start + 1).to_string()),
            ("Accept-Ranges".into(), "bytes".into()),
        ];
        if range != Range::All {
            headers.push((
                "Content-Range".into(),
                format!("bytes {start}-{end}/{}", entity.size),
            ));
        }
        if let Some(mime) = &entity.mime {
            headers.push(("Content-Type".into(), mime.clone()));
        }
        if let Some(etag) = &entity.etag {
            headers.push(("ETag".into(), etag.clone()));
        }
        if let Some(date) = &entity.modified {
            headers.push(("Last-Modified".into(), date.clone()));
        }
        reply(
            &mut socket,
            if range == Range::All { 200 } else { 206 },
            &headers,
        )?;
        if request.method == "HEAD" {
            return Ok(());
        }
        let mut at = start;
        while at <= end && !source.closed.load(Ordering::Acquire) {
            if let Some((bytes, offset)) = source.cached(at, preview) {
                let n = (bytes.len() - offset)
                    .min((end - at).saturating_add(1).min(usize::MAX as u64) as usize);
                socket.write_all(&bytes[offset..offset + n])?;
                at += n as u64;
            } else {
                let next = source
                    .state
                    .lock()
                    .unwrap()
                    .bytes
                    .next(at)
                    .unwrap_or(u64::MAX);
                let last = end.min(next.saturating_sub(1));
                let reading = flight(source, at, last, preview)?;
                let response = source.open(
                    "GET",
                    Some(&format!("bytes={at}-{last}")),
                    entity.validator(),
                    preview,
                )?;
                let Some((new, actual_start, actual_end)) = describe(&response) else {
                    return Err(invalid());
                };
                if response.status().as_u16() != 206
                    || actual_start != at
                    || actual_end != last
                    || unsafe_type(&response)
                {
                    return Err(invalid());
                }
                source.entity(new)?;
                relay(&mut socket, source, response, at, last, preview, &reading)?;
                at = last + 1;
            }
        }
        return Ok(());
    }
    // First request preserves upstream range/non-range behavior. Do not preflight
    // with HEAD or divide playback into RTT-bound tiny range requests.
    let first_start = match range {
        Range::From(start, _) => start,
        _ => 0,
    };
    let first_end = match range {
        Range::From(_, Some(end)) => end,
        _ => u64::MAX,
    };
    let reading = flight(source, first_start, first_end, preview)?;
    let mut response = match source.open(&request.method, request.range.as_deref(), None, preview) {
        Ok(response) => response,
        Err(_) => return reject(&mut socket, 502),
    };
    if unsafe_type(&response) {
        return redirect(&mut socket, &source.original);
    }
    let mut headers = Vec::new();
    for name in [
        "content-length",
        "content-range",
        "content-type",
        "accept-ranges",
        "etag",
        "last-modified",
        "retry-after",
    ] {
        if let Some(value) = header(&response, name) {
            headers.push((name.into(), value));
        }
    }
    let status = response.status().as_u16();
    let described = describe(&response);
    if let Some((entity, start, end)) = &described {
        if status == 206 && range.bounds(entity.size) != Some((*start, *end)) {
            return reject(&mut socket, 502);
        }
        if source.entity(entity.clone()).is_err() {
            return reject(&mut socket, 502);
        }
    }
    reply(&mut socket, status, &headers)?;
    if request.method == "HEAD" {
        return Ok(());
    }
    if let Some((_, start, end)) = described {
        relay(&mut socket, source, response, start, end, preview, &reading)
    } else {
        // Unknown-size and error responses are passed through, never accumulated.
        let mut reader = response.body_mut().as_reader();
        let mut bytes = [0_u8; CHUNK];
        loop {
            if source.closed.load(Ordering::Acquire) {
                return Ok(());
            }
            let n = reader.read(&mut bytes)?;
            if n == 0 {
                return Ok(());
            }
            socket.write_all(&bytes[..n])?;
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    #[test]
    fn playback_source_mode_bypasses_relay_only_when_requested() {
        for setting in [None, Some("shared-cache"), Some("invalid")] {
            assert_eq!(PlaybackSourceMode::from_setting(setting), PlaybackSourceMode::SharedCache);
        }
        let url = "https://fixture.invalid/video.mkv";
        let headers = Headers::from([("Authorization".into(), "Bearer fixture".into())]);
        let direct = PlaybackSourceMode::from_setting(Some("direct"));
        assert_eq!(direct, PlaybackSourceMode::Direct);
        assert!(MediaSource::for_playback(url, &headers, direct).is_none());
        let cached =
            MediaSource::for_playback(url, &headers, PlaybackSourceMode::SharedCache).unwrap();
        assert!(cached.playback_url().starts_with("http://127.0.0.1:"));
        assert_eq!(cached.shared.original, url);
        assert_eq!(cached.shared.headers, headers);
    }

    /// Deterministic origin with counters, auth, ranges and failure modes.
    pub(crate) struct Origin {
        pub url: String,
        pub requests: Arc<AtomicUsize>,
        pub transferred: Arc<AtomicU64>,
        pub mode: Arc<AtomicUsize>, // 1 ignores Range; 2 changes ETag; 3 fails first request
        pub seen: Arc<Mutex<Vec<(u64, u64)>>>,
        closed: Arc<AtomicBool>,
        address: SocketAddr,
        thread: Option<JoinHandle<()>>,
    }
    impl Origin {
        pub(crate) fn new(data: Vec<u8>) -> Self {
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
            let address = listener.local_addr().unwrap();
            let (requests, transferred, mode, seen, closed) = (
                Arc::new(AtomicUsize::new(0)),
                Arc::new(AtomicU64::new(0)),
                Arc::new(AtomicUsize::new(0)),
                Arc::new(Mutex::new(Vec::new())),
                Arc::new(AtomicBool::new(false)),
            );
            let (count, bytes, behavior, ranges, stop) = (
                requests.clone(),
                transferred.clone(),
                mode.clone(),
                seen.clone(),
                closed.clone(),
            );
            let thread = std::thread::spawn(move || {
                for socket in listener.incoming() {
                    if stop.load(Ordering::Acquire) {
                        break;
                    }
                    let Ok(mut socket) = socket else {
                        break;
                    };
                    let count = count.fetch_add(1, Ordering::SeqCst);
                    let Ok(request) = request(&mut socket) else {
                        continue;
                    };
                    if behavior.load(Ordering::SeqCst) == 5
                        && request.authorization.as_deref() != Some("Bearer private-fixture")
                    {
                        let _ = reject(&mut socket, 401);
                        continue;
                    }
                    if behavior.load(Ordering::SeqCst) == 3 && count == 0 {
                        let _ = reject(&mut socket, 503);
                        continue;
                    }
                    if request.path.starts_with("/redirect") {
                        let _ = reply(
                            &mut socket,
                            302,
                            &[
                                ("Location".into(), format!("http://{address}/video.mp4")),
                                ("Content-Length".into(), "0".into()),
                            ],
                        );
                        continue;
                    }
                    let requested = Range::parse(request.range.as_deref()).unwrap();
                    let requested = if behavior.load(Ordering::SeqCst) == 1 {
                        Range::All
                    } else {
                        requested
                    };
                    let Some((start, end)) = requested.bounds(data.len() as u64) else {
                        let _ = reply(
                            &mut socket,
                            416,
                            &[
                                ("Content-Range".into(), format!("bytes */{}", data.len())),
                                ("Content-Length".into(), "0".into()),
                            ],
                        );
                        continue;
                    };
                    let mut headers = vec![
                        ("Content-Length".into(), (end - start + 1).to_string()),
                        ("Content-Type".into(), "video/mp4".into()),
                        (
                            "ETag".into(),
                            if behavior.load(Ordering::SeqCst) == 2 {
                                "\"changed\""
                            } else {
                                "\"original\""
                            }
                            .into(),
                        ),
                    ];
                    if behavior.load(Ordering::SeqCst) != 1 {
                        headers.push(("Accept-Ranges".into(), "bytes".into()));
                    }
                    if requested != Range::All {
                        headers.push((
                            "Content-Range".into(),
                            format!("bytes {start}-{end}/{}", data.len()),
                        ));
                    }
                    if reply(
                        &mut socket,
                        if requested == Range::All { 200 } else { 206 },
                        &headers,
                    )
                    .is_err()
                    {
                        continue;
                    }
                    if request.method != "HEAD" {
                        ranges.lock().unwrap().push((start, end));
                        if behavior.load(Ordering::SeqCst) == 4 {
                            std::thread::sleep(Duration::from_millis(70));
                        }
                        if socket
                            .write_all(&data[start as usize..=end as usize])
                            .is_ok()
                        {
                            bytes.fetch_add(end - start + 1, Ordering::SeqCst);
                        }
                    }
                }
            });
            Self {
                url: format!("http://{address}/video.mp4"),
                requests,
                transferred,
                mode,
                seen,
                closed,
                address,
                thread: Some(thread),
            }
        }
    }
    impl Drop for Origin {
        fn drop(&mut self) {
            self.closed.store(true, Ordering::Release);
            let _ = TcpStream::connect(self.address);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
    fn data() -> Vec<u8> {
        (0..CHUNK * 5).map(|i| (i % 251) as u8).collect()
    }
    fn get(url: &str, range: Option<&str>) -> (u16, Vec<u8>) {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(Duration::from_secs(3)))
            .build()
            .into();
        let mut request = agent.get(url);
        if let Some(range) = range {
            request = request.header("Range", range);
        }
        let mut response = request.call().unwrap();
        let status = response.status().as_u16();
        let mut bytes = Vec::new();
        response
            .body_mut()
            .as_reader()
            .read_to_end(&mut bytes)
            .unwrap();
        (status, bytes)
    }
    #[test]
    fn intervals_eviction_and_playback_priority() {
        let mut cache = Bytes::default();
        cache.put(100, &[1; 8], true, 16);
        cache.put(100, &[9; 4], false, 16);
        assert_eq!(
            &*cache.get(100).unwrap().0,
            &[1; 8],
            "An overlapping preview cannot replace playback bytes"
        );
        cache.put(200, &[2; 8], false, 16);
        cache.put(300, &[3; 8], false, 16);
        assert!(cache.get(200).is_none());
        assert!(cache.get(100).is_some());
        cache.put(400, &[4; 16], false, 16);
        assert!(cache.get(100).is_some(), "Preview cannot evict playback");
        cache.put(105, &[5; 3], true, 16);
        assert_eq!(&*cache.get(106).unwrap().0, &[5; 3]);
        assert!(cache.bytes <= 16);
        cache.put(500, &[6; 16], true, 16);
        assert_eq!(cache.bytes, 16);
        assert!(cache.get(100).is_none());
        assert!(cache.get(516).is_none(), "Intervals are half-open");
        cache.put(u64::MAX, &[7; 2], true, 16);
        assert_eq!(cache.bytes, 16);
    }
    #[test]
    fn range_parsing_and_large_offsets() {
        assert_eq!(
            Range::parse(Some("bytes=8589934592-8589934600"))
                .unwrap()
                .bounds(10_000_000_000),
            Some((8589934592, 8589934600))
        );
        assert_eq!(Range::Suffix(7).bounds(5), Some((0, 4)));
        assert_eq!(Range::From(3, Some(100)).bounds(5), Some((3, 4)));
        assert!(Range::From(5, None).bounds(5).is_none());
        for bad in [
            "bytes=3-2",
            "bytes=0-1,3-4",
            "bytes=-0",
            "bytes=x-",
            "bytes=18446744073709551616-",
            "none",
        ] {
            assert!(Range::parse(Some(bad)).is_err());
        }
        assert!(content_range("bytes 1-10/10").is_none());
    }
    #[test]
    fn playback_bytes_serve_first_time_previews_without_origin_reads() {
        let expected = data();
        let origin = Origin::new(expected.clone());
        let source = MediaSource::new(&origin.url, &Headers::new()).unwrap();
        assert_eq!(get(&source.playback_url(), None).1, expected);
        let calls = origin.requests.load(Ordering::SeqCst);
        for range in ["bytes=7-90000", "bytes=-17", "bytes=131070-131075"] {
            let (status, bytes) = get(&source.preview_url(), Some(range));
            assert_eq!(status, 206);
            let (start, end) = Range::parse(Some(range))
                .unwrap()
                .bounds(expected.len() as u64)
                .unwrap();
            assert_eq!(bytes, expected[start as usize..=end as usize]);
        }
        assert_eq!(
            origin.requests.load(Ordering::SeqCst),
            calls,
            "First-time previews reuse playback bytes, not just JPEGs"
        );
        assert_eq!(
            origin.transferred.load(Ordering::SeqCst),
            expected.len() as u64
        );
        assert_eq!(
            get(&source.preview_url(), Some("bytes=999999-")),
            (416, vec![])
        );
        let old = source.preview_url();
        let state = source.shared.clone();
        drop(source);
        assert!(state.state.lock().unwrap().bytes.pieces.is_empty());
        assert!(
            TcpStream::connect(
                url::Url::parse(&old)
                    .unwrap()
                    .socket_addrs(|| None)
                    .unwrap()[0]
            )
            .is_err()
        );
    }
    #[test]
    fn sparse_hits_fetch_only_missing_intervals_and_validate_entities() {
        let expected = data();
        let origin = Origin::new(expected.clone());
        let source = MediaSource::new(&origin.url, &Headers::new()).unwrap();
        assert_eq!(
            get(&source.playback_url(), Some("bytes=100-199")).1,
            expected[100..200]
        );
        assert_eq!(
            get(&source.preview_url(), Some("bytes=50-249")).1,
            expected[50..250]
        );
        assert_eq!(
            *origin.seen.lock().unwrap(),
            vec![(100, 199), (50, 99), (200, 249)]
        );
        origin.mode.store(2, Ordering::SeqCst);
        // A changed entity must never be combined with previously cached bytes.
        let result = source
            .shared
            .open("GET", Some("bytes=300-399"), None, true)
            .unwrap();
        let (next, _, _) = describe(&result).unwrap();
        assert!(source.shared.entity(next).is_err());
        assert!(source.shared.state.lock().unwrap().bytes.pieces.is_empty());
        assert_eq!(get(&source.preview_url(), Some("bytes=100-199")).0, 410);
    }
    #[test]
    fn source_isolation_non_range_and_redirects() {
        let expected = data();
        let origin = Origin::new(expected.clone());
        let one = MediaSource::new(&origin.url, &Headers::new()).unwrap();
        get(&one.playback_url(), Some("bytes=0-99"));
        let two = MediaSource::new(&origin.url, &Headers::new()).unwrap();
        assert_ne!(one.playback_url(), two.playback_url());
        let before = origin.requests.load(Ordering::SeqCst);
        get(&two.preview_url(), Some("bytes=0-99"));
        assert_eq!(origin.requests.load(Ordering::SeqCst), before + 1);
        let redirect =
            MediaSource::new(&origin.url.replace("video", "redirect"), &Headers::new()).unwrap();
        assert_eq!(
            get(&redirect.playback_url(), Some("bytes=2-9")).1,
            expected[2..10]
        );
        origin.mode.store(1, Ordering::SeqCst);
        let source = MediaSource::new(&origin.url, &Headers::new()).unwrap();
        assert_eq!(
            get(&source.playback_url(), Some("bytes=12-24")),
            (200, expected)
        );
        for url in [
            "https://example.org/file.m3u8",
            "https://example.org/file.mpd",
            "file:///video.mp4",
            "https://user:password@example.org/video.mp4",
        ] {
            assert!(MediaSource::new(url, &Headers::new()).is_none());
        }
    }
    #[test]
    fn concurrent_previews_reuse_inflight_bytes_without_delaying_playback() {
        let expected = data();
        let origin = Origin::new(expected.clone());
        let source = MediaSource::new(&origin.url, &Headers::new()).unwrap();
        get(&source.playback_url(), Some("bytes=0-99"));
        origin.mode.store(4, Ordering::SeqCst);
        let url = source.preview_url();
        let one = std::thread::spawn(move || get(&url, Some("bytes=100000-150000")));
        let until = Instant::now() + Duration::from_secs(1);
        while origin.requests.load(Ordering::SeqCst) < 2 {
            assert!(Instant::now() < until);
            std::thread::yield_now();
        }
        let two = get(&source.preview_url(), Some("bytes=100000-150000"));
        assert_eq!(one.join().unwrap().1, expected[100000..150001]);
        assert_eq!(two.1, expected[100000..150001]);
        assert_eq!(origin.requests.load(Ordering::SeqCst), 2);
        // A playback miss never waits on a preview's in-flight reservation.
        let reading = flight(&source.shared, 200000, 220000, true).unwrap();
        let now = Instant::now();
        assert!(source.shared.cached(200000, false).is_none());
        assert!(now.elapsed() < Duration::from_millis(50));
        drop(reading);
    }
    #[test]
    fn authenticated_head_and_retirement_during_an_inflight_read() {
        let expected = data();
        let origin = Origin::new(expected.clone());
        origin.mode.store(5, Ordering::SeqCst);
        let headers = Headers::from([("Authorization".into(), "Bearer private-fixture".into())]);
        let source = MediaSource::new(&origin.url, &headers).unwrap();
        let response = ureq::head(&source.playback_url()).call().unwrap();
        assert_eq!(
            response
                .headers()
                .get("content-length")
                .unwrap()
                .to_str()
                .unwrap(),
            expected.len().to_string()
        );
        assert_eq!(
            origin.transferred.load(Ordering::SeqCst),
            0,
            "HEAD must not download the video"
        );
        assert_eq!(
            get(&source.playback_url(), Some("bytes=0-99")).1,
            expected[..100]
        );
        origin.mode.store(4, Ordering::SeqCst);
        let url = source.preview_url();
        let reader = std::thread::spawn(move || {
            let mut response = ureq::get(&url)
                .header("Range", "bytes=100000-150000")
                .call()
                .unwrap();
            let mut bytes = Vec::new();
            let _ = response.body_mut().as_reader().read_to_end(&mut bytes);
        });
        let until = Instant::now() + Duration::from_secs(1);
        while origin.requests.load(Ordering::SeqCst) < 3 {
            assert!(Instant::now() < until);
            std::thread::yield_now();
        }
        let shared = source.shared.clone();
        let now = Instant::now();
        drop(source);
        assert!(
            now.elapsed() < Duration::from_millis(100),
            "Retirement cannot wait for an upstream body"
        );
        reader.join().unwrap();
        assert!(
            shared.state.lock().unwrap().bytes.pieces.is_empty(),
            "An old read must not repopulate a retired cache"
        );
    }
    #[test]
    fn local_endpoint_rejects_foreign_origins_tokens_and_requests() {
        let origin = Origin::new(data());
        let source = MediaSource::new(&origin.url, &Headers::new()).unwrap();
        for (method, path, extra, status) in [
            ("GET", "/wrong/play.mp4".into(), "", 403),
            (
                "GET",
                format!("{}/play.mp4", source.path),
                "Origin: https://example.org\r\n",
                403,
            ),
            ("POST", format!("{}/play.mp4", source.path), "", 405),
            (
                "GET",
                format!("{}/play.mp4", source.path),
                "Range: bytes=0-1,3-4\r\n",
                400,
            ),
        ] {
            let mut stream = TcpStream::connect(source.address).unwrap();
            write!(
                stream,
                "{method} {path} HTTP/1.1\r\nHost: {}\r\n{extra}\r\n",
                source.address
            )
            .unwrap();
            let mut bytes = String::new();
            stream.read_to_string(&mut bytes).unwrap();
            assert!(bytes.starts_with(&format!("HTTP/1.1 {status}")), "{bytes}");
        }
        assert_eq!(origin.requests.load(Ordering::SeqCst), 0);
    }
}
