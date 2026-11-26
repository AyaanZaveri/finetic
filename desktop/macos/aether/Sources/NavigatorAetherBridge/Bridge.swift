import AppKit
import AVFoundation
import AetherEngine
import Foundation

typealias EventCallback = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<UInt8>?, Int) -> Void

/// The native shell calls these entry points exclusively on the AppKit thread.
/// The loaded library stays resident for the process lifetime.
@MainActor
final class PlaybackBridge {
    private let engine: AetherEngine
    private let container: NSView
    private let view: AetherPlayerView
    private let bitmapOverlay: NSView
    private let callback: EventCallback
    private let context: UnsafeMutableRawPointer?
    private var session: String?
    private var loadTask: Task<Void, Never>?
    private var seekTask: Task<Void, Never>?
    private var previewTask: Task<Void, Never>?
    private var timer: Timer?
    private var generation = UUID()
    private var loaded = false
    private var ready = false
    private var desiredPaused = false
    private var volume: Double = 1
    private var muted = false
    private var rate: Double = 1
    private var subtitleDelay: Double = 0
    private var subtitleText = ""
    private var bitmapIDs: [String] = []
    private var bitmapBounds = CGRect.zero
    private var lastTracks: Data?
    private var lastChapters: Data?
    private var lastState: Data?
    private var lastStateAt = Date.distantPast
    private var lastClock: Double = 0

    init(parent: NSView, callback: EventCallback, context: UnsafeMutableRawPointer?) throws {
        engine = try AetherEngine()
        container = NSView(frame: parent.bounds)
        view = AetherPlayerView(frame: container.bounds)
        bitmapOverlay = NSView(frame: container.bounds)
        self.callback = callback
        self.context = context
        container.autoresizingMask = [.width, .height]
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.black.cgColor
        view.autoresizingMask = [.width, .height]
        bitmapOverlay.autoresizingMask = [.width, .height]
        bitmapOverlay.wantsLayer = true
        bitmapOverlay.layer?.masksToBounds = true
        container.addSubview(view)
        container.addSubview(bitmapOverlay)
        // Rust inserts this before WebKit, as a sibling of the mpv view.
        parent.addSubview(container)
        container.isHidden = true
        engine.bind(view: view)
        engine.maximumSubtitleOffsetSeconds = 30
    }

    func close() {
        stop()
        engine.unbind(view: view)
        container.removeFromSuperview()
    }

    func stop() {
        generation = UUID()
        loadTask?.cancel()
        seekTask?.cancel()
        previewTask?.cancel()
        timer?.invalidate()
        timer = nil
        session = nil
        loaded = false
        ready = false
        engine.stop()
        container.isHidden = true
        clearBitmap()
    }

    func command(_ data: Data) {
        guard let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = message["type"] as? String else { return }
        if type == "load" {
            guard let name = message["session"] as? String,
                  let raw = message["url"] as? String,
                  let url = URL(string: raw), ["http", "https"].contains(url.scheme ?? ""),
                  url.host != nil else { return }
            begin(name: name, url: url, message: message)
            return
        }
        guard let session, message["session"] as? String == session else { return }
        switch type {
        case "stop": stop()
        case "play":
            desiredPaused = false
            if loaded { engine.play() }
        case "pause":
            desiredPaused = true
            if loaded { engine.pause() }
        case "volume":
            if let value = message["volume"] as? Double {
                volume = max(0, min(1, value))
                applyVolume()
            }
        case "muted":
            muted = message["muted"] as? Bool ?? false
            applyVolume()
        case "rate":
            if let value = message["rate"] as? Double {
                rate = min(Double(engine.maxSupportedRate), max(0.25, value))
                if loaded { engine.setRate(Float(rate)) }
            }
        case "seek":
            guard let position = message["position"] as? Double else { return }
            seekTask?.cancel()
            let token = generation
            seekTask = Task { [weak self] in
                guard let self, self.generation == token, !Task.isCancelled else { return }
                await self.engine.seek(to: position, exact: true)
            }
        case "track":
            let id = (message["id"] as? String).flatMap(Int.init)
            if message["kind"] as? String == "audio" {
                if let id { engine.selectAudioTrack(index: id) }
            } else {
                clearBitmap()
                if let id { engine.selectSubtitleTrack(index: id) }
                else { engine.clearSubtitle() }
            }
        case "subtitle-delay":
            subtitleDelay = message["seconds"] as? Double ?? 0
            engine.setSoftwareSubtitleDelay(subtitleDelay)
            renderSubtitles()
        case "audio-delay":
            engine.setAudioDelay(message["seconds"] as? Double ?? 0)
        case "video-fit":
            switch message["mode"] as? String {
            case "crop": engine.videoGravity = .resizeAspectFill
            case "stretch": engine.videoGravity = .resize
            default: engine.videoGravity = .resizeAspect
            }
            clearBitmap()
        case "thumbnail":
            previewTask?.cancel()
            guard let at = message["position"] as? Double, let request = message["request"] as? Int else {
                Task { await engine.releaseScrubPreviewDecoders() }
                return
            }
            let token = generation
            previewTask = Task { [weak self] in
                guard let self, self.generation == token, !Task.isCancelled else { return }
                let frame = await self.engine.scrubPreviewFrame(atSeconds: at, refined: false, maxWidth: 448, isCancelled: { Task.isCancelled })
                guard self.generation == token, !Task.isCancelled else { return }
                var result: [String: Any] = ["request": request, "position": NSNull(), "src": NSNull()]
                if let frame, let jpeg = NSBitmapImageRep(cgImage: frame.image).representation(using: .jpeg, properties: [.compressionFactor: 0.72]) {
                    result["position"] = frame.actualSeconds
                    result["src"] = "data:image/jpeg;base64," + jpeg.base64EncodedString()
                }
                self.emit("thumbnail", result)
            }
        default: break
        }
        if type != "stop" { tick(force: true) }
    }

    private func begin(name: String, url: URL, message: [String: Any]) {
        stop()
        session = name
        desiredPaused = false
        lastTracks = nil
        lastChapters = nil
        lastState = nil
        subtitleText = ""
        subtitleDelay = 0
        lastClock = 0
        rate = 1
        lastStateAt = .distantPast
        engine.setSoftwareSubtitleDelay(0)
        container.isHidden = false
        emit("loading")
        emit("subtitle", ["text": ""])
        emit("chapters", ["chapters": []])
        let token = generation
        var options = LoadOptions(
            httpHeaders: message["headers"] as? [String: String] ?? [:],
            preferredAudioLanguages: (message["audioLanguage"] as? String).map { [$0] } ?? []
        )
        options.sessionCacheHardLimitBytes = 512 * 1024 * 1024
        options.sessionCacheFreeReserveBytes = 512 * 1024 * 1024
        // One app-owned reader budget, including subtitle/preview requests.
        options.maxConcurrentSourceRequests = 2
        options.autoplay = false
        options.skipsContainerAttachments = true
        let initialPosition = message["startPosition"] as? Double ?? 0
        lastClock = initialPosition
        loadTask = Task { [weak self] in
            guard let self else { return }
            do {
                _ = try await self.engine.load(url: url, startPosition: initialPosition > 0 ? initialPosition : nil, options: options)
                guard self.generation == token, !Task.isCancelled else { return }
                self.loaded = true
                self.applyVolume()
                self.engine.setRate(Float(self.rate))
                self.publishMetadata()
                self.tick(force: true)
                self.emit("loaded")
                if !self.desiredPaused { self.engine.play() }
                self.tick(force: true)
            } catch is CancellationError {
                // A newer load or stop superseded this operation.
            } catch {
                guard self.generation == token, !Task.isCancelled else { return }
                self.failure()
            }
        }
        timer = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        if let timer { RunLoop.main.add(timer, forMode: .common) }
    }

    private func applyVolume() { engine.volume = Float(muted ? 0 : volume) }

    private func publishMetadata() {
        func track(_ track: TrackInfo, type: String, selected: Int?) -> [String: Any] {
            ["id": track.id, "type": type, "title": track.name, "lang": track.language as Any,
             "codec": track.codec, "selected": track.id == selected, "forced": track.isForced]
        }
        var tracks = engine.audioTracks.map { track($0, type: "audio", selected: engine.activeAudioTrackIndex) }
        tracks += engine.subtitleTracks.map { track($0, type: "sub", selected: engine.activeSubtitleTrackIndex) }
        if let codec = engine.sourceVideoCodecName {
            tracks.append(["id": 0, "type": "video", "codec": codec, "selected": true])
        }
        let payload = ["tracks": tracks]
        if let bytes = encoded(payload), bytes != lastTracks {
            lastTracks = bytes
            emit("tracks", payload)
        }
        let chapters = engine.mediaChapters.map { ["time": $0.startSeconds, "title": $0.name] as [String: Any] }
        let chapterPayload = ["chapters": chapters]
        if let bytes = encoded(chapterPayload), bytes != lastChapters {
            lastChapters = bytes
            emit("chapters", chapterPayload)
        }
    }

    private func tick(force: Bool = false) {
        guard session != nil else { return }
        if case .error = engine.state { failure(); return }
        if case .ended = engine.state {
            emit("ended")
            timer?.invalidate()
            timer = nil
            clearBitmap()
            return
        }
        guard loaded else { return }
        renderSubtitles()
        let now = Date()
        if force || now.timeIntervalSince(lastStateAt) >= 0.24 {
            lastStateAt = now
            publishMetadata()
            if engine.currentTime.isFinite && engine.currentTime >= 0 { lastClock = engine.currentTime }
            let phase = engine.playbackPhase
            let buffering: Bool
            switch phase {
            case .loading, .rebuffering, .stalled: buffering = true
            default: buffering = false
            }
            var state: [String: Any] = [
                "position": lastClock, "duration": finite(engine.duration),
                "paused": desiredPaused, "volume": volume, "muted": muted, "rate": rate,
                "buffering": buffering, "seeking": engine.isSeeking, "buffered": finite(engine.bufferedPosition),
                "bufferedRanges": engine.residentRanges.map { ["start": finite($0.lowerBound), "end": finite($0.upperBound)] },
                "width": engine.sourceVideoWidth, "height": engine.sourceVideoHeight,
                "engine": "aether", "route": String(describing: engine.videoRoute),
                "hdr": String(describing: engine.videoFormat)
            ]
            if let decoder = engine.activeVideoDecoder { state["videoDecoder"] = decoder }
            if let decoder = engine.activeAudioDecoder { state["audioDecoder"] = decoder }
            if let count = engine.diagnostics.liveTelemetry?.droppedFrameCount { state["droppedFrames"] = count }
            if let bytes = encoded(state), bytes != lastState {
                lastState = bytes
                emit("state", ["state": state])
            }
        }
        if !ready, engine.hasFirstFrameReadyForDisplay, !engine.isBuffering, engine.playbackPhase != .loading {
            ready = true
            emit("ready")
        }
    }

    private func failure() {
        guard session != nil else { return }
        emit("error", ["message": "AetherEngine could not play this stream.", "position": lastClock])
        stop()
    }

    private func renderSubtitles() {
        let time = engine.sourceTime - subtitleDelay
        let active = engine.sourceTimeFollowsPicture ? engine.subtitleCues.filter { $0.startTime <= time && time < $0.endTime } : []
        let text = active.compactMap { cue -> String? in
            switch cue.body {
            case .text(let value): return value
            case .richText(let runs): return runs.map(\.text).joined()
            case .image: return nil
            }
        }.joined(separator: "\n")
        if text != subtitleText {
            subtitleText = text
            emit("subtitle", ["text": text])
        }
        let ids = active.compactMap { cue -> String? in
            if case .image = cue.body { return String(describing: cue.id) }
            return nil
        }
        if ids == bitmapIDs, bitmapBounds == bitmapOverlay.bounds { return }
        clearBitmap()
        bitmapIDs = ids
        bitmapBounds = bitmapOverlay.bounds
        for cue in active {
            guard case .image(let image) = cue.body else { continue }
            let bounds = bitmapOverlay.bounds
            let size = engine.softwareDisplaySize ?? CGSize(
                width: CGFloat(engine.sourceVideoWidth) * CGFloat(engine.sourceVideoPixelAspectRatio),
                height: CGFloat(engine.sourceVideoHeight))
            var picture = bounds
            if let videoRect = engine.nativePlayerLayer?.videoRect, !videoRect.isEmpty {
                picture = videoRect
            } else if size.width > 0, size.height > 0, engine.videoGravity != .resize {
                let sx = bounds.width / size.width, sy = bounds.height / size.height
                let scale = engine.videoGravity == .resizeAspectFill ? max(sx, sy) : min(sx, sy)
                picture = CGRect(x: (bounds.width - size.width * scale) / 2,
                                 y: (bounds.height - size.height * scale) / 2,
                                 width: size.width * scale, height: size.height * scale)
            }
            // SubtitleImage.position is a normalized top-left rect, not pixels.
            let rect = image.position
            let layer = CALayer()
            layer.contents = image.cgImage
            layer.contentsGravity = .resize
            layer.frame = CGRect(x: picture.minX + rect.minX * picture.width,
                                 y: picture.minY + (1 - rect.maxY) * picture.height,
                                 width: rect.width * picture.width, height: rect.height * picture.height)
            bitmapOverlay.layer?.addSublayer(layer)
        }
    }

    private func clearBitmap() {
        bitmapIDs = []
        bitmapOverlay.layer?.sublayers = nil
    }

    private func emit(_ type: String, _ fields: [String: Any] = [:]) {
        guard let session else { return }
        var message = fields
        message["type"] = type
        message["session"] = session
        guard let data = encoded(message) else { return }
        data.withUnsafeBytes { callback(context, $0.bindMemory(to: UInt8.self).baseAddress, data.count) }
    }

    private func encoded(_ value: [String: Any]) -> Data? {
        try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }

    private func finite(_ value: Double) -> Double { value.isFinite ? max(0, value) : 0 }
}

@_cdecl("navigator_aether_create")
func create(_ parent: UnsafeMutableRawPointer?, _ callback: EventCallback, _ context: UnsafeMutableRawPointer?) -> UnsafeMutableRawPointer? {
    // The main actor's return type must be Sendable. Transfer only the
    // retained object's address across the synchronous isolation assertion.
    let address: UInt = MainActor.assumeIsolated {
        guard let parent else { return 0 }
        let view = Unmanaged<NSView>.fromOpaque(parent).takeUnretainedValue()
        guard let bridge = try? PlaybackBridge(parent: view, callback: callback, context: context) else { return 0 }
        return UInt(bitPattern: Unmanaged.passRetained(bridge).toOpaque())
    }
    return UnsafeMutableRawPointer(bitPattern: address)
}

@_cdecl("navigator_aether_command")
func command(_ handle: UnsafeMutableRawPointer?, _ bytes: UnsafePointer<UInt8>?, _ count: Int) {
    MainActor.assumeIsolated {
        guard let handle, let bytes, count > 0, count <= 65536 else { return }
        Unmanaged<PlaybackBridge>.fromOpaque(handle).takeUnretainedValue().command(Data(bytes: bytes, count: count))
    }
}

@_cdecl("navigator_aether_destroy")
func destroy(_ handle: UnsafeMutableRawPointer?) {
    MainActor.assumeIsolated {
        guard let handle else { return }
        Unmanaged<PlaybackBridge>.fromOpaque(handle).takeRetainedValue().close()
    }
}
