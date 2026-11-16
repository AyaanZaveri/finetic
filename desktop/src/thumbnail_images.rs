//! Session-scoped JPEGs. This endpoint serves memory only and never opens media URLs.
use std::{
    collections::{BTreeMap, VecDeque},
    io::{self, Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread::JoinHandle,
    time::Duration,
};

const CAPACITY: usize = 256;
const MAX_BYTES: usize = 16 << 20;

struct Connection(Arc<AtomicUsize>);
impl Drop for Connection {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

struct Images {
    entries: BTreeMap<u64, Arc<[u8]>>,
    order: VecDeque<u64>,
    bytes: usize,
    capacity: usize,
    max_bytes: usize,
}
impl Images {
    fn new(capacity: usize, max_bytes: usize) -> Self {
        Self {
            entries: BTreeMap::new(),
            order: VecDeque::new(),
            bytes: 0,
            capacity,
            max_bytes,
        }
    }
    fn get(&mut self, time: u64) -> Option<Arc<[u8]>> {
        let image = self.entries.get(&time)?.clone();
        self.order.retain(|key| *key != time);
        self.order.push_back(time);
        Some(image)
    }
    fn put(&mut self, time: u64, jpeg: &[u8]) -> bool {
        if jpeg.len() > self.max_bytes || self.capacity == 0 {
            return false;
        }
        if let Some(previous) = self.entries.remove(&time) {
            self.bytes -= previous.len();
        }
        self.order.retain(|key| *key != time);
        self.entries.insert(time, Arc::from(jpeg));
        self.order.push_back(time);
        self.bytes += jpeg.len();
        while self.entries.len() > self.capacity || self.bytes > self.max_bytes {
            if let Some(key) = self.order.pop_front() {
                if let Some(image) = self.entries.remove(&key) {
                    self.bytes -= image.len();
                }
            }
        }
        true
    }
}

pub struct ImageServer {
    images: Arc<Mutex<Images>>,
    address: SocketAddr,
    prefix: String,
    closed: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}
impl ImageServer {
    /// The caller supplies a fresh cryptographically random 128-bit token.
    pub fn start(token: String) -> io::Result<Self> {
        if token.len() != 32 || !token.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err(io::Error::other("Invalid thumbnail token"));
        }
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
        let address = listener.local_addr()?;
        let prefix = format!("/{token}/");
        let images = Arc::new(Mutex::new(Images::new(CAPACITY, MAX_BYTES)));
        let closed = Arc::new(AtomicBool::new(false));
        let (cache, stopped, path) = (images.clone(), closed.clone(), prefix.clone());
        let connections = Arc::new(AtomicUsize::new(0));
        let worker = std::thread::Builder::new()
            .name("thumbnail-images".into())
            .spawn(move || {
                for socket in listener.incoming() {
                    if stopped.load(Ordering::Acquire) {
                        break;
                    }
                    let Ok(socket) = socket else {
                        continue;
                    };
                    let slot = Connection(connections.clone());
                    if connections.fetch_add(1, Ordering::Relaxed) >= 8 {
                        continue;
                    }
                    let (cache, path, stopped) = (cache.clone(), path.clone(), stopped.clone());
                    // A speculative/slow connection must not hold up other images.
                    let _ = std::thread::Builder::new()
                        .name("thumbnail-image".into())
                        .spawn(move || {
                            let _slot = slot;
                            if !stopped.load(Ordering::Acquire) {
                                let _ = serve(socket, address, &path, &cache);
                            }
                        });
                }
            })?;
        Ok(Self {
            images,
            address,
            prefix,
            closed,
            worker: Some(worker),
        })
    }
    pub fn cached(&self, time: u64) -> Option<String> {
        self.images.lock().unwrap().get(time)?;
        Some(self.url(time))
    }
    pub fn insert(&self, time: u64, jpeg: &[u8]) -> Option<String> {
        self.images
            .lock()
            .unwrap()
            .put(time, jpeg)
            .then(|| self.url(time))
    }
    fn url(&self, time: u64) -> String {
        format!("http://{}{}{time}.jpg", self.address, self.prefix)
    }
}
impl Drop for ImageServer {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::Release);
        let _ = TcpStream::connect_timeout(&self.address, Duration::from_millis(100));
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        let mut images = self.images.lock().unwrap();
        images.entries.clear();
        images.order.clear();
        images.bytes = 0;
    }
}

fn serve(
    mut socket: TcpStream,
    address: SocketAddr,
    prefix: &str,
    images: &Mutex<Images>,
) -> io::Result<()> {
    socket.set_read_timeout(Some(Duration::from_millis(250)))?;
    socket.set_write_timeout(Some(Duration::from_secs(1)))?;
    let mut header = Vec::new();
    let mut buffer = [0; 1024];
    while !header.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = socket.read(&mut buffer)?;
        if n == 0 || header.len() + n > 4096 {
            return Ok(());
        }
        header.extend_from_slice(&buffer[..n]);
    }
    let Ok(header) = std::str::from_utf8(&header) else {
        return Ok(());
    };
    let mut lines = header.split("\r\n");
    let parts: Vec<_> = lines.next().unwrap_or("").split_whitespace().collect();
    let hosts: Vec<_> = lines
        .filter_map(|line| line.split_once(':'))
        .filter(|(name, _)| name.eq_ignore_ascii_case("host"))
        .map(|(_, value)| value.trim())
        .collect();
    let mut status = "404 Not Found";
    let mut image = None;
    if parts.len() == 3 && parts[2] == "HTTP/1.1" && hosts == [address.to_string()] {
        if matches!(parts[0], "GET" | "HEAD") {
            if let Some(time) = parts[1]
                .strip_prefix(prefix)
                .and_then(|s| s.strip_suffix(".jpg"))
                .and_then(|s| s.parse::<u64>().ok())
            {
                image = images.lock().unwrap().get(time);
                if image.is_some() {
                    status = "200 OK";
                }
            }
        } else {
            status = "405 Method Not Allowed";
        }
    }
    let bytes = image.as_deref().unwrap_or(&[]);
    write!(
        socket,
        "HTTP/1.1 {status}\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        bytes.len()
    )?;
    if parts.first() != Some(&"HEAD") {
        socket.write_all(bytes)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_bounds_and_revisits() {
        let mut cache = Images::new(2, 5);
        assert!(cache.put(1, &[1, 2]));
        assert!(cache.put(2, &[3, 4]));
        cache.get(1);
        cache.put(3, &[5, 6]);
        assert!(cache.get(2).is_none());
        cache.put(4, &[7, 8, 9, 10]);
        assert_eq!(cache.bytes, 4);
        assert_eq!(cache.entries.len(), 1);
        assert!(!cache.put(5, &[0; 6]));
    }
    fn request(address: SocketAddr, path: &str, host: &str, method: &str) -> Vec<u8> {
        let mut socket = TcpStream::connect(address).unwrap();
        write!(socket, "{method} {path} HTTP/1.1\r\nHost: {host}\r\n\r\n").unwrap();
        let mut bytes = Vec::new();
        socket.read_to_end(&mut bytes).unwrap();
        bytes
    }
    #[test]
    fn images_require_current_token_and_loopback_host() {
        let server = ImageServer::start("0123456789abcdef0123456789abcdef".into()).unwrap();
        let jpeg = [0xff, 0xd8, 0xff, 0xd9];
        let url = server.insert(123, &jpeg).unwrap();
        assert_eq!(server.cached(123), Some(url));
        let path = format!("{}123.jpg", server.prefix);
        let bytes = request(server.address, &path, &server.address.to_string(), "GET");
        assert!(bytes.starts_with(b"HTTP/1.1 200"));
        assert!(String::from_utf8_lossy(&bytes).contains("Cache-Control: no-store"));
        assert!(bytes.ends_with(&jpeg));
        let head = request(server.address, &path, &server.address.to_string(), "HEAD");
        assert!(head.starts_with(b"HTTP/1.1 200"));
        assert!(head.ends_with(b"\r\n\r\n"));
        for (path, host) in [
            ("/wrong/123.jpg", server.address.to_string()),
            (&path, "foreign.test".into()),
        ] {
            assert!(request(server.address, path, &host, "GET").starts_with(b"HTTP/1.1 404"));
        }
        let address = server.address;
        drop(server);
        assert!(TcpStream::connect(address).is_err());
    }
}
