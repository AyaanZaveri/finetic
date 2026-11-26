import AppKit
import Foundation
import Testing
@testable import NavigatorAetherBridge

@MainActor
@Test func bridgeLifecycle() throws {
    let parent = NSView(frame: NSRect(x: 0, y: 0, width: 320, height: 180))
    let callback: EventCallback = { _, _, _ in }
    let bridge = try PlaybackBridge(parent: parent, callback: callback, context: nil)
    #expect(parent.subviews.count == 1)
    #expect(parent.subviews[0].isHidden)
    bridge.close()
    #expect(parent.subviews.isEmpty)
}

@MainActor
private final class Events {
    var messages: [[String: Any]] = []
    let callback: EventCallback = { context, bytes, count in
        MainActor.assumeIsolated {
            guard let context, let bytes,
                  let value = try? JSONSerialization.jsonObject(with: Data(bytes: bytes, count: count)) as? [String: Any] else { return }
            Unmanaged<Events>.fromOpaque(context).takeUnretainedValue().messages.append(value)
        }
    }
    var state: [String: Any] { messages.last(where: { $0["type"] as? String == "state" })?["state"] as? [String: Any] ?? [:] }
    func waitFor(_ predicate: () -> Bool, seconds: Double = 30) async throws {
        let deadline = Date().addingTimeInterval(seconds)
        while !predicate(), Date() < deadline {
            try await Task.sleep(for: .milliseconds(100))
        }
        #expect(predicate(), "Timed out; last state: \(self.state)")
    }
    func has(_ type: String) -> Bool { messages.contains { $0["type"] as? String == type } }
}

@MainActor
@Test func remoteMediaLifecycle() async throws {
    // CI owns this deterministic HTTP range origin and media fixture.
    guard let url = ProcessInfo.processInfo.environment["NAVIGATOR_AETHER_FIXTURE"] else { return }
    _ = NSApplication.shared
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 320, height: 180), styleMask: [.titled], backing: .buffered, defer: false)
    let parent = try #require(window.contentView)
    let events = Events()
    let bridge = try PlaybackBridge(parent: parent, callback: events.callback, context: Unmanaged.passUnretained(events).toOpaque())
    defer { bridge.close(); window.orderOut(nil) }
    window.orderFront(nil)
    func send(_ type: String, _ fields: [String: Any] = [:]) throws {
        var value = fields
        value["type"] = type
        value["session"] = "fixture"
        bridge.command(try JSONSerialization.data(withJSONObject: value))
    }
    try send("load", ["url": url, "startPosition": 2, "audioLanguage": "eng"])
    try await events.waitFor({ events.has("loaded") || events.has("error") })
    try #require(!events.has("error"))
    try await events.waitFor({ (events.state["position"] as? Double ?? 0) > 2.1 })
    #expect(events.state["engine"] as? String == "aether")
    #expect(events.state["route"] as? String == "loopback")
    #expect(events.state["videoDecoder"] as? String != nil)
    #expect(events.state["width"] as? Int == 320)
    #expect(events.state["duration"] as? Double ?? 0 >= 10)

    let tracks = try #require(events.messages.last(where: { $0["type"] as? String == "tracks" })?["tracks"] as? [[String: Any]])
    let audio = tracks.filter { $0["type"] as? String == "audio" }
    let subtitles = tracks.filter { $0["type"] as? String == "sub" }
    #expect(audio.count == 2)
    #expect(subtitles.count == 1)
    let other = try #require(audio.first(where: { $0["selected"] as? Bool != true })?["id"] as? Int)
    try send("track", ["kind": "audio", "id": String(other)])
    try await events.waitFor({
        let latest = events.messages.last(where: { $0["type"] as? String == "tracks" })?["tracks"] as? [[String: Any]]
        return latest?.contains { $0["type"] as? String == "audio" && $0["id"] as? Int == other && $0["selected"] as? Bool == true } == true
    })
    let subtitle = try #require(subtitles.first?["id"] as? Int)
    try send("track", ["kind": "subtitle", "id": String(subtitle)])
    try send("pause")
    try await events.waitFor({ events.state["paused"] as? Bool == true })
    try send("seek", ["position": 6.0])
    try await events.waitFor({
        abs((events.state["position"] as? Double ?? 0) - 6) < 0.5 && events.state["seeking"] as? Bool == false
    })
    try send("volume", ["volume": 0.4])
    try send("muted", ["muted": true])
    try send("rate", ["rate": 1.5])
    #expect(events.state["muted"] as? Bool == true)
    #expect(events.state["rate"] as? Double == 1.5)
    try send("thumbnail", ["request": 1, "position": 6.0])
    try await events.waitFor({ events.has("thumbnail") }, seconds: 10)
    let thumbnail = events.messages.last(where: { $0["type"] as? String == "thumbnail" })
    #expect((thumbnail?["src"] as? String)?.hasPrefix("data:image/jpeg;base64,") == true)
    try send("play")
    try await events.waitFor({ (events.state["position"] as? Double ?? 0) > 6.2 })
    try send("stop")
    #expect(parent.subviews.first?.isHidden == true)
    print("Aether playback fixture diagnostics: \(events.state)")
}
