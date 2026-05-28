import Foundation
import CoreGraphics

// key-poster: Ultra-fast keyboard shortcut simulation via CGEvent.
// Usage: key-poster <command>
//   paste   → Cmd+V
//   copy    → Cmd+C
//
// CGEvent posts directly to the system event stream (~5-15ms),
// replacing osascript/AppleScript (~180ms child process spawn).
// Requires Accessibility permission (same as globe-listener).

guard CommandLine.arguments.count >= 2 else {
    fputs("Usage: key-poster <paste|copy>\n", stderr)
    exit(1)
}

let command = CommandLine.arguments[1].lowercased()

// Key codes (from Carbon/Events.h)
let kVK_V: CGKeyCode = 9
let kVK_C: CGKeyCode = 8

let keyCode: CGKeyCode
switch command {
case "paste":
    keyCode = kVK_V
case "copy":
    keyCode = kVK_C
default:
    fputs("Unknown command: \(command). Use 'paste' or 'copy'.\n", stderr)
    exit(1)
}

// Use combinedSessionState so the event targets the frontmost app
// in the current login session, regardless of which app spawned us.
let src = CGEventSource(stateID: .combinedSessionState)

guard let keyDown = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: true),
      let keyUp = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: false) else {
    fputs("Failed to create CGEvent\n", stderr)
    exit(1)
}

// Set Command modifier flag
keyDown.flags = .maskCommand
keyUp.flags = .maskCommand

// Post to the login session event tap — this delivers the event
// to whichever app currently has keyboard focus in this session.
keyDown.post(tap: .cgSessionEventTap)
keyUp.post(tap: .cgSessionEventTap)
