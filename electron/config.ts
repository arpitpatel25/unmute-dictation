// ─── Local configuration (no server) ───
// Single source of truth for unmute's Groq endpoints, models, and tunables.
// Previously served by the Cloudflare config worker; now hardcoded locally
// since unmute is a fully local, bring-your-own-key app.

// ─── Groq endpoints ───
export const GROQ = {
  sttUrl: 'https://api.groq.com/openai/v1/audio/transcriptions',
  sttTranslationsUrl: 'https://api.groq.com/openai/v1/audio/translations',
  sttModel: 'whisper-large-v3-turbo',
  sttResponseFormat: 'verbose_json',
  // Default Whisper params. `prompt` nudges accurate transcription; `language`
  // can be overridden per-request (or omitted for auto-detect).
  sttDefaultLanguage: 'en',
  sttPrompt: 'Transcribe the spoken audio accurately.',

  chatUrl: 'https://api.groq.com/openai/v1/chat/completions',
  // LLM used for on-demand transform/instruction flows.
  chatModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
  chatMaxTokens: 8192,
} as const

// ─── Chunking (long-recording VAD splitting) ───
// Read by the renderer at recording start.
export const CHUNKING = {
  enabled: true,
  min_duration_ms: 30_000,
  silence_threshold_rms: 0.015,
  silence_duration_ms: 400,
  hard_cap_ms: 45_000,
  vad_poll_interval_ms: 100,
} as const

// ─── Junk-transcript detection ───
// A transcript this short and matching this pattern (only punctuation/space)
// is treated as silence and produces no output.
export const JUNK_DETECTION = {
  max_length: 2,
  pattern: '^[.\\s,!?;:]*$',
} as const

// ─── Request timeout for a single Groq call ───
export const REQUEST_TIMEOUT_MS = 15_000

// ─── Cloud→local fallback ───
// Shorter budget for the cloud transcription attempt before falling back to the
// on-device model. A genuine error returns fast; this caps how long a network
// hang can stall before we switch.
export const STT_CLOUD_TIMEOUT_MS = 8_000

// Kill the idle on-device whisper server after this long with no transcription,
// so it doesn't hold the model in RAM between bursts of use.
export const LOCAL_STT_IDLE_SHUTDOWN_MS = 5 * 60 * 1_000
