# unmute — Open-Source Roadmap

This document is the single source of truth for turning the copied Bolo codebase into
**unmute**: a lean, local, open-source voice dictation app for macOS. Everything below
was decided in the planning conversation. Work top-to-bottom; later phases assume earlier
ones are done.

> **Product in one line:** Press a key, speak, and clean *raw* text appears at your cursor.
> Formatting and transforms happen only when you ask. Bring your own Groq API key. Fully
> local — no servers, no accounts.

---

## Guiding principles

- **Local-first, zero backend.** No Supabase, no Cloudflare, no auth, no telemetry, no quota.
  The Electron app calls Groq directly with the user's own key.
- **Raw by default.** We never auto-format. Default dictation = the transcript, lightly
  cleaned in code. The LLM only runs when the user explicitly instructs (Control key).
- **Groq-only, no choices.** One provider, one set of models, hardcoded. No model picker.
- **Invisible until needed.** The HUD acks silently (glow), shows text only on failure.
- **Showcase craft.** Latency, native key capture, real-time audio, and a polished release
  are the things that make this read as a strong builder project.

---

## Phase 0 — Repo setup  ✅ DONE

- [x] Create new repo `unmute-dictation` as a sibling of `BoloAI`, fresh git history.
- [x] Exclude secrets/heavy artifacts (`.env`, `node_modules`, `dist`/`release`/`build`,
      Python venv, `.webm`).
- [x] Baseline commit on `main`. `BoloAI` left untouched.

---

## Phase 1 — Backend teardown (rip out Supabase + Cloudflare)

Goal: delete everything that exists only to hide keys / meter usage / authenticate.

- [ ] Delete `supabase/` entirely (migrations, `functions/admin`, edge functions).
- [ ] Delete `cloudflare/` entirely (config, pipeline, quick-chat, supabase-proxy, shared).
- [ ] Remove `@supabase/supabase-js` dependency and `renderer/shared/supabaseClient.ts`.
- [ ] Remove auth flow: `renderer/app/Auth.tsx`, sign in/up, JWT (`auth:token` IPC),
      Account-tab sign-out, OAuth, the `unmute://auth/callback` deep-link handling.
- [ ] Remove quota/daily-caps logic, `featureFlags.ts`, dev-whitelist gating, telemetry.
- [ ] Remove `deploy:*` scripts from `package.json`.
- [ ] Port the **needed** config values out of `cloudflare/shared/config.ts` into a local
      constants file (chunking params, junk-detection, the Groq STT + LLM model IDs we keep).
- [ ] Remove the backend-selection setting (Supabase/Cloudflare toggle).

---

## Phase 2 — Go local with BYO Groq key

- [ ] Rewrite `electron/api.ts` to call Groq directly:
      - STT → `https://api.groq.com/openai/v1/audio/transcriptions`
      - LLM → `https://api.groq.com/openai/v1/chat/completions`
      - Add `Authorization: Bearer <user key>`; drop all JWT logic.
- [ ] **Key storage via OS Keychain.** Use Electron `safeStorage.encryptString` on save,
      `decryptString` on read. Never write the key in plaintext. Never log it.
- [ ] **Settings UI:** a single "Groq API key" field.
      - [ ] Masked display after save (e.g. `gsk_••••1234`).
      - [ ] Optional "Test key" button that pings Groq once to validate.
      - [ ] Friendly empty-state: link to where to get a key + "paste it here to start".
- [ ] Block the pipeline when no key is set, with a clear prompt to add one.
- [ ] **Groq-only:** strip Cerebras / Cartesia / Sarvam provider configs, the
      `ACTIVE_MODELS` knob, and any model-selection UI. Hardcode the chosen Groq STT
      (Whisper) + Groq LLM model.

---

## Phase 3 — Cut Quick Chat

- [ ] Delete `renderer/quickchat/`, `electron/quickChatManager.ts`, the Quick Chat window
      in `windowManager.ts`, and `renderer/app/QuickChatPage.tsx`.
- [ ] Remove the Option+Space hotkey + `quick-chat-toggle` handling.
- [ ] Remove all `quick-chat:*` IPC channels and the `groq-compound` / SSE / markdown /
      web-search code paths.
- [ ] Result: two windows only — main (settings/history) + the HUD pill.

---

## Phase 4 — Raw-by-default + deterministic stitching (the behavior shift)

- [ ] **Remove the LLM from the default dictation path.** Default output = transcript with
      lightweight **deterministic** cleanup in code: trim, collapse whitespace, strip a
      trailing phantom "thank you", de-dupe chunk-boundary overlap.
- [ ] **Formatting/transform on-demand only** — the LLM runs only when the user gives a
      Control instruction (transform / context / instruction-only flows keep working).
- [ ] **Deterministic chunk stitching** (kills the `[Chunk 1/8]:` bug):
      - [ ] Cut chunks cleanly at silence (no overlap) so reassembly is a plain join.
      - [ ] Order chunks by zero-padded index and `join(' ')` in code.
      - [ ] Remove the LLM-merge prompt + all chunk labelling/markers.
      - [ ] (If overlap is ever needed: deterministic longest-suffix/prefix de-dupe, no LLM.)
- [ ] Keep the on-demand transform prompts (`prompts.ts`) for the instruction flows; drop the
      auto-cleanup-via-LLM dictation prompt.

---

## Phase 5 — UX improvements

- [ ] **HUD on success:** remove the transcript preview text. Show a brief green glow /
      minimal success ack, then auto-hide. (Lean toward glow-only; checkmark optional.)
- [ ] **HUD on failure:** keep showing the error + note that the text is still on the
      clipboard (this is the one case the user can't see the result anywhere else).
- [ ] **Silence guard (no wasted API calls):** track whether any audio crossed the RMS
      speech threshold during a recording. If silence-only, **skip STT entirely** and show
      "Didn't catch that." Reuse the existing VAD machinery.
- [ ] **Live "not hearing you" cue:** when N seconds of continuous silence is detected
      mid-recording, dim/flatten the waveform or show a subtle hint. Visual only.
- [ ] (Optional, default OFF) auto-stop on prolonged silence — only if testing shows demand.
- [ ] **Audio recovery:** keep the 5-session on-disk retention (already implemented). Add a
      **retry / re-transcribe** affordance (History row and/or HUD error state) that loads the
      saved audio via `loadAudioFile` and re-runs the pipeline. Turns the safety net into a
      visible "never lose what you said" feature.

---

## Phase 6 — Rename Bolo → unmute (everywhere)

Mechanical but thorough. "Bolo" appears in several forms.

- [ ] Code identifiers / strings: `Bolo`, `Bolo AI`, `BOLO` wordmark → `unmute`.
- [ ] `package.json` `name: "bolo"` → `unmute`.
- [ ] SQLite file `bolo.db` → `unmute.db` (handle existing-file path).
- [ ] CSS design tokens `--bolo-*` → `--unmute-*` (referenced widely; do carefully).
- [ ] IPC channel names, env var prefixes, log tags (`[audio]` etc. are fine, but `bolo`-named ones).
- [ ] App/product name in `electron-builder.yml`, window titles, tray.
- [ ] The `unmute://` URL scheme already exists — keep it.
- [ ] Rename / rewrite docs: `BOLO.md` → `README`-style doc; update `DESIGN_SYSTEM.md`.

---

## Phase 7 — Open-source readiness

Non-negotiables first.

- [ ] **LICENSE** — pick MIT or Apache-2.0 (permissive) and add the file. *Required.*
- [ ] **Secret / personal-data scrub** — verify none remain in the working tree *or* the new
      git history:
      - [ ] hardcoded Supabase JWKS public key (gone with Cloudflare teardown).
      - [ ] `DEV_WHITELIST` personal email.
      - [ ] Supabase URLs / anon key, `.env.example` contents.
      - [ ] confirm `.env` never committed.
- [ ] **README** — what it is, a GIF/screenshots, "get a Groq key → paste in Settings",
      install + build + run steps, permissions explanation (mic, accessibility, input monitoring).
- [ ] **Reproducible build** — ensure `npm install && npm run dev` works on a clean Mac;
      document the native-binary build (Swift `globe-listener`, whisper) or commit a working
      `compile:native` path.
- [ ] **Remove proprietary assets** — `PRD_Bolo.docx`, `TechSpec_Bolo.docx`, old logos;
      replace with unmute branding.
- [ ] **Contribution hygiene** (lighter): `CONTRIBUTING.md`, `.gitignore` correctness,
      issue template. Optional at launch.
- [ ] Create the GitHub remote and push (user-triggered) once scrubbed.

---

## Open decisions (resolve before building the affected phase)

- [ ] **Local STT (whisper.cpp / faster-whisper):** keep as an offline option, or remove for
      a Groq-only lean core? "Groq-only, no choice" leans toward removal; "local-first
      showcase" leans toward keeping. Affects Phases 2, 4, and resources/scripts cleanup.
- [ ] **Sarvam / Hinglish path:** likely removed with Groq-only STT — confirm. (Resolves
      KNOWN_ISSUES #4.)
- [ ] **Local LLM (`localLLM.ts`) + `prompts.ts` "copied verbatim" rationale:** keep for the
      on-demand transform, or simplify now that there's no local/cloud parity to maintain?
- [ ] License choice: MIT vs Apache-2.0.
- [ ] Widget success ack: glow-only vs glow + checkmark.

---

## Deferred — the "fuzzy" work (separate conversation, after the lean core exists)

- **UI redesign.** The current UI is weak; this is the biggest open piece and the highest-ROI
  item for "showcase." Design it against the simplified, real codebase — not now.
- **More feature enhancements** (TBD — user has many in mind).
- **Distribution:** code signing + notarization, release pipeline, auto-update.
- **Showcase polish:** latency engineering as the headline (measure p50/p95, before/after),
  streaming/partial STT, a transcript-accuracy benchmark/eval harness.
- **Remaining KNOWN_ISSUES** not auto-resolved by the above.

---

## Bug-fix ledger (from KNOWN_ISSUES.md — how each resolves)

| # | Issue | Resolution |
|---|---|---|
| 1 | `[Chunk x/y]` markers leak into output | **Fixed** by deterministic code stitching (Phase 4) |
| 2 | Phantom "thank you" appended | Deterministic trailing-phrase strip in cleanup (Phase 4) |
| 3 / 7 | Spelled-out word + scaffolding both appear | Only relevant in the on-demand format path now (Phase 4) |
| 4 | Sarvam outputs digit "1" for "one" | Likely **moot** if Sarvam removed (Open decision) |
| 5 | LLM formatting passes raw text ~half the time | **Moot** — no auto-format by default (Phase 4) |
| 6 | Spoken symbols not converted | On-demand format/transform concern; revisit later |
