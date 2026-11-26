import AppKit
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
