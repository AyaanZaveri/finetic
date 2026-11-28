import AetherEngine
import Combine
import ExpoModulesCore
import UIKit

public final class NavigatorAether: Module {
  public func definition() -> ModuleDefinition {
    Name("NavigatorAether")

    View(NavigatorAetherView.self) {
      Events("onStatus", "onChapters", "onSeekLanded")

      Prop("source") { (view, source: String) in
        MainActor.assumeIsolated { view.source = URL(string: source) }
      }

      Prop("loop") { (view, loop: Bool) in
        MainActor.assumeIsolated { view.loop = loop }
      }

      OnViewDidUpdateProps { view in
        MainActor.assumeIsolated { view.updateSource() }
      }

      AsyncFunction("setPlaying") { (view, playing: Bool) in
        MainActor.assumeIsolated { view.setPlaying(playing) }
      }.runOnQueue(.main)

      AsyncFunction("seek") { (view: NavigatorAetherView, time: Double) async in
        await view.seek(to: time)
      }

      AsyncFunction("thumbnail") { (view: NavigatorAetherView, time: Double) async -> NavigatorAetherThumbnail? in
        await view.thumbnail(at: time)
      }
    }

    Class(NavigatorAetherThumbnail.self) {
      Property("width", \.ref.size.width)
      Property("height", \.ref.size.height)
    }
  }
}

private final class NavigatorAetherThumbnail: SharedRef<UIImage>, @unchecked Sendable {
  override var nativeRefType: String { "image" }

  override func getAdditionalMemoryPressure() -> Int {
    guard let image = ref.cgImage else { return 0 }
    return image.bytesPerRow * image.height
  }
}

@MainActor
private final class NavigatorAetherView: ExpoView {
  private struct Status: Equatable {
    var currentTime = 0.0
    var duration = 0.0
    var firstFrame = false
    var playing = false
    var ended = false
    var failed = false
    var subtitleCount = 0
  }

  let onStatus = EventDispatcher()
  let onChapters = EventDispatcher()
  let onSeekLanded = EventDispatcher()

  var source: URL?
  var loop = false

  private let surface = AetherPlayerView(frame: .zero)
  private var engine: AetherEngine?
  private var openedSource: URL?
  private var loadTask: Task<Void, Never>?
  private var extractor: FrameExtractor?
  private var timer: Timer?
  private var seekSubscription: AnyCancellable?
  private var wantsPlayback = true
  private var status = Status()
  private var lastChapters: [ChapterInfo] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    surface.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    surface.frame = bounds
    addSubview(surface)
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      close()
    } else {
      updateSource()
    }
  }

  func updateSource() {
    guard window != nil, source != openedSource else { return }
    close()
    guard let source else { return }
    openedSource = source
    wantsPlayback = UIApplication.shared.applicationState == .active
    do {
      let engine = try AetherEngine()
      self.engine = engine
      engine.bind(view: surface)
      seekSubscription = engine.seekEvents.sink { [weak self] event in
        guard case .landed = event.outcome else { return }
        self?.onSeekLanded(["target": event.target])
      }
      let timer = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
        MainActor.assumeIsolated { self?.updateStatus() }
      }
      RunLoop.main.add(timer, forMode: .common)
      self.timer = timer
      load(engine, source: source)
    } catch {
      status.failed = true
      publishStatus()
    }
  }

  private func load(_ engine: AetherEngine, source: URL) {
    guard loadTask == nil else { return }
    var options = LoadOptions()
    options.autoplay = wantsPlayback
    loadTask = Task { [weak self] in
      defer {
        if let self, self.engine === engine { self.loadTask = nil }
      }
      do {
        try await engine.load(url: source, options: options)
        guard let self, self.engine === engine, !Task.isCancelled else { return }
        if !self.wantsPlayback { engine.pause() }
      } catch is CancellationError {
        // The native view was detached or given another source.
      } catch {
        guard let self, self.engine === engine else { return }
        self.status.failed = true
        self.publishStatus()
      }
    }
  }

  func setPlaying(_ playing: Bool) {
    wantsPlayback = playing
    guard let engine else { return }
    if !playing {
      engine.pause()
    } else if engine.state == .ended, let openedSource {
      load(engine, source: openedSource)
    } else {
      engine.play()
    }
  }

  func seek(to time: Double) async {
    guard let engine, engine.canSeek, time.isFinite else { return }
    await engine.seek(to: time, exact: true)
  }

  func thumbnail(at time: Double) async -> NavigatorAetherThumbnail? {
    guard let engine, let openedSource, time.isFinite, time >= 0 else { return nil }
    let size = CGSize(width: 320, height: 180)
    let image: CGImage?
    if openedSource.isFileURL {
      // A local file can be read independently, including chapters beyond the buffered range.
      if extractor == nil { extractor = engine.makeFrameExtractor() }
      image = await extractor?.snapshot(at: time, maxSize: size)
    } else {
      // Keep URL previews within the existing playback connection.
      image = await engine.scrubThumbnail(atSeconds: time, maxWidth: Int(size.width))
    }
    guard let image, self.engine === engine, !Task.isCancelled else { return nil }
    let scale = min(size.width / CGFloat(image.width), size.height / CGFloat(image.height))
    let thumbnail = UIImage(cgImage: image)
    if scale >= 1 { return NavigatorAetherThumbnail(thumbnail) }

    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let scaledSize = CGSize(width: max(1, floor(CGFloat(image.width) * scale)),
                            height: max(1, floor(CGFloat(image.height) * scale)))
    let scaled = UIGraphicsImageRenderer(size: scaledSize, format: format).image { _ in
      thumbnail.draw(in: CGRect(origin: .zero, size: scaledSize))
    }
    return NavigatorAetherThumbnail(scaled)
  }

  private func updateStatus() {
    guard let engine else { return }
    if loop, wantsPlayback, engine.state == .ended, let openedSource {
      load(engine, source: openedSource)
    }

    let failed: Bool
    if case .error = engine.state { failed = true } else { failed = status.failed }
    let currentTime = engine.currentTime.isFinite ? engine.currentTime : 0
    let duration = engine.duration.isFinite && engine.duration > 0 ? engine.duration : status.duration
    let latest = Status(
      currentTime: currentTime,
      duration: duration,
      firstFrame: status.firstFrame || engine.hasFirstFrameReadyForDisplay,
      playing: engine.state == .playing || (engine.state == .seeking && wantsPlayback),
      ended: engine.state == .ended && !loop,
      failed: failed,
      subtitleCount: engine.subtitleTracks.count
    )
    if status != latest {
      status = latest
      publishStatus()
    }

    let chapters = Array(engine.mediaChapters.prefix(8))
    if chapters != lastChapters {
      // A fixture restart briefly clears engine metadata. Keep the current strip until
      // the same source publishes its chapters again.
      if loop && chapters.isEmpty && loadTask != nil { return }
      lastChapters = chapters
      onChapters(["chapters": chapters.map { ["title": $0.name, "time": $0.startSeconds] }])
    }
  }

  private func publishStatus() {
    onStatus([
      "currentTime": status.currentTime,
      "duration": status.duration,
      "firstFrame": status.firstFrame,
      "isPlaying": status.playing,
      "ended": status.ended,
      "failed": status.failed,
      "subtitleCount": status.subtitleCount
    ])
  }

  private func close() {
    timer?.invalidate()
    timer = nil
    seekSubscription = nil
    loadTask?.cancel()
    loadTask = nil
    engine?.stop()
    engine = nil
    if let extractor {
      Task { await extractor.shutdown() }
      self.extractor = nil
    }
    openedSource = nil
    status = Status()
    lastChapters = []
  }
}
