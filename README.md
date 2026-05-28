# unmute

**Typing sucks. Just unmute.**

A fast, local, voice-first dictation app for macOS. Press a key, speak, and clean
text appears at your cursor — in any app. Bring your own [Groq](https://groq.com)
API key; everything runs on your machine.

> **Raw by default.** unmute pastes what you said, lightly cleaned — it never
> rewrites or "formats" your words unless you explicitly ask it to. Formatting and
> transforms happen on demand, via a spoken instruction.

---

## Features

- **Dictation** — hold/tap a key, speak, and the transcript is pasted at your cursor.
- **Instruction** — give a voice command to transform text ("make this a bullet
  list", "translate to French", "turn this into a commit message").
- **Works on selected text** — select text anywhere, then dictate or instruct to
  rewrite it in place.
- **Local & private** — audio and history stay on your Mac (SQLite + local files).
  The only thing that leaves your machine is the audio sent to Groq for
  transcription, using **your** key.
- **Fast** — pure dictation is speech-to-text only (no LLM round-trip), so text
  lands in ~1–2s. The LLM is used only when you give an instruction.
- **No account, no server, no telemetry.** Your Groq key is stored encrypted in
  the macOS Keychain.

## How it works

```
key press → record → transcribe (Groq Whisper) → clean in code → paste at cursor
                                                  └─ + LLM only if you gave an instruction
```

A small compiled Swift helper watches for the global hotkeys; audio is captured in
the app, transcribed via Groq, and the result is pasted via the clipboard.

## Requirements

- macOS (the global key capture is macOS-only)
- [Node.js](https://nodejs.org) 18+
- Xcode Command Line Tools (`xcode-select --install`) — to compile the Swift helper
- A free Groq API key — get one at <https://console.groq.com/keys>

## Quick start

```bash
git clone <your-fork-url> unmute && cd unmute
npm install
npm run dev          # compiles native helpers, then launches the app
```

On first launch:

1. Open **Settings → Groq API Key**, paste your key, and save (it's validated and
   stored in your Keychain).
2. Grant the macOS permissions when prompted (see below).
3. Press your dictation key and start talking.

## Permissions (macOS)

unmute needs three permissions, all prompted on first use:

- **Microphone** — to record your voice.
- **Accessibility** — to paste text and read your selection.
- **Input Monitoring** — for the global dictation/instruction hotkeys.

Grant them in **System Settings → Privacy & Security**.

## Keys

| Key | Action |
|-----|--------|
| **Fn (Globe)** or **Right Option** | Dictate (configurable in Settings) |
| **Control** | Instruction — transform text with a voice command |
| Chain them | Dictate, then instruct (or vice-versa) in one go |
| **Escape** | Cancel the current recording / processing |

## Build a distributable

```bash
npm run build        # bundle main + preload + renderer
npm run dist         # build a macOS .dmg (unsigned)
```

Native helpers are built via `npm run compile:native` (run automatically before
`dev`/`build`).

## Project structure

```
electron/      Main process — key capture, session pipeline, Groq client, SQLite
renderer/      React UI — main window (history/settings) + the HUD pill
native/macos/  Swift global-key listener
resources/     Compiled binaries + app icon
scripts/       Native build scripts
```

## Privacy

- Audio is sent only to `api.groq.com`, authenticated with your own key.
- Transcripts and session history live in a local SQLite DB; recent audio files are
  kept briefly for retry and pruned automatically.
- Your API key is encrypted at rest via Electron `safeStorage` (macOS Keychain) and
  never logged or transmitted anywhere except Groq.

## Optional: local / offline models

An offline path (whisper.cpp / a local LLM) exists in the codebase behind a feature
flag and is disabled by default. Cloud Groq is the supported, out-of-the-box mode.

## License

[MIT](./LICENSE)
