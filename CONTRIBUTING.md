# Contributing to unmute

Thanks for your interest in improving unmute! This is a small, focused macOS
dictation app — contributions that keep it fast, local, and simple are very welcome.

## Getting set up

```bash
npm install
npm run dev
```

You'll need macOS, Node 18+, Xcode Command Line Tools, and a Groq API key
(see the [README](./README.md)).

## Before you open a PR

- **Build cleanly:** `npm run build` should pass.
- **Type-check:** `npx tsc --noEmit -p tsconfig.node.json` (main) and
  `-p tsconfig.web.json` (renderer).
- **Test the actual app**, not just the build — dictate something, try an
  instruction, and confirm the change behaves as intended.
- Keep changes scoped and the diff small. Match the existing style.

## Principles

- **Raw by default.** Dictation output is the transcript, cleaned in code — never
  silently rewritten. The LLM runs only for explicit instruction flows.
- **Local & private.** No servers, no accounts, no telemetry. The user's key stays
  in the Keychain; only audio→Groq leaves the machine.
- **Invisible until needed.** The HUD should be quiet and get out of the way.

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, and your macOS
version. Logs from the dev console help.

## Security

Please do **not** open a public issue for security problems. Email the maintainer
instead.
