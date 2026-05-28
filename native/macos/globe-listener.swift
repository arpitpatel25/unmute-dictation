import AppKit
import CoreGraphics
import Foundation

// Disable stdout buffering for real-time pipe communication with Electron
setbuf(stdout, nil)

var previousModifiers: NSEvent.ModifierFlags = []
// Track whether Option is currently held (for Option+Space detection)
var optionHeld = false
// Track Right Option separately (keyCode 61) for configurable dictation key
var rightOptionHeld = false

func handleModifierChange(_ event: NSEvent) {
    let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)

    // Fn/Globe key detection
    let hadFn = previousModifiers.contains(.function)
    let hasFn = mods.contains(.function)
    if !hadFn && hasFn {
        print("FN_DOWN")
    }
    if hadFn && !hasFn {
        print("FN_UP")
    }

    // Caps Lock detection (for instruction mode)
    let hadCaps = previousModifiers.contains(.capsLock)
    let hasCaps = mods.contains(.capsLock)
    if !hadCaps && hasCaps {
        print("CAPS_DOWN")
    }
    if hadCaps && !hasCaps {
        print("CAPS_UP")
    }

    // Right Option key detection (keyCode 61 = Right Option, 58 = Left Option)
    if event.keyCode == 61 {  // Right Option
        let hadOption = previousModifiers.contains(.option)
        let hasOption = mods.contains(.option)
        if !hadOption && hasOption {
            rightOptionHeld = true
            print("RIGHT_OPTION_DOWN")
        }
        if hadOption && !hasOption {
            rightOptionHeld = false
            print("RIGHT_OPTION_UP")
        }
    } else if event.keyCode == 58 {  // Left Option released
        let hadOption = previousModifiers.contains(.option)
        let hasOption = mods.contains(.option)
        if hadOption && !hasOption { rightOptionHeld = false }
    }

    // Track Option key state (for Option+Space combo detection)
    optionHeld = mods.contains(.option)

    previousModifiers = mods
}

func handleKeyDown(_ event: NSEvent) {
    // Detect Space (keyCode 49) while Option is held → Option+Space combo
    if event.keyCode == 49 && optionHeld {
        print("OPTION_SPACE")
    }
}

// ─── Stdin command handler ───
// Electron can send commands via stdin for fast keystroke simulation.
// Uses CGEvent instead of NSAppleScript to avoid blocking the main thread.
// NSAppleScript.executeAndReturnError() is synchronous and blocks the main
// run loop for ~30-40ms, which causes NSEvent global monitors to miss
// flagsChanged events (FN_UP) — corrupting the previousModifiers state
// and making the user need 3 Fn presses instead of 2.
// CGEvent posts asynchronously and never blocks the run loop.

// Key codes (from Carbon/Events.h)
let kVK_V: CGKeyCode = 9
let kVK_C: CGKeyCode = 8

func simulateKeystroke(_ keyCode: CGKeyCode) -> Bool {
    let src = CGEventSource(stateID: .combinedSessionState)
    guard let keyDown = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: true),
          let keyUp = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: false) else {
        return false
    }
    keyDown.flags = .maskCommand
    keyUp.flags = .maskCommand
    keyDown.post(tap: .cgSessionEventTap)
    keyUp.post(tap: .cgSessionEventTap)
    return true
}

func handleStdinCommand(_ command: String) {
    switch command {
    case "PASTE":
        if simulateKeystroke(kVK_V) {
            print("PASTE_OK")
        } else {
            fputs("PASTE_ERROR:Failed to create CGEvent\n", stderr)
        }
    case "COPY":
        if simulateKeystroke(kVK_C) {
            print("COPY_OK")
        } else {
            fputs("COPY_ERROR:Failed to create CGEvent\n", stderr)
        }
    default:
        break
    }
}

// Read stdin on a background thread so it doesn't block the run loop.
// Commands are also executed on the background thread (CGEvent doesn't
// require the main thread, unlike NSAppleScript).
DispatchQueue.global(qos: .userInteractive).async {
    while let line = readLine() {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            handleStdinCommand(trimmed)
        }
    }
}

// Monitor global flagsChanged events (when other apps are focused)
NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { event in
    handleModifierChange(event)
}

// Also monitor local flagsChanged events (when our app is focused)
NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { event in
    handleModifierChange(event)
    return event
}

// Monitor global keyDown events for Option+Space detection
NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { event in
    handleKeyDown(event)
}

// Also monitor local keyDown events
NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
    handleKeyDown(event)
    return event
}

// Keep the run loop alive
NSApplication.shared.run()
