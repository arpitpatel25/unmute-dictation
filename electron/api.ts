// ─── API layer (direct Groq, no proxy) ───
// Historically these functions called Cloudflare Workers that hid the API key.
// unmute is now fully local + bring-your-own-key, so they call Groq directly
// via groq.ts. Signatures are preserved so sessionManager/main need minimal change.
// The `authToken` parameter is vestigial (kept to avoid churn) and ignored.

import { groqTranscribe, groqChat, NoApiKeyError, type ChatMessage as GroqMessage } from './groq'
import { assembleTransformMessages } from './prompts'
import { CHUNKING, JUNK_DETECTION, REQUEST_TIMEOUT_MS, STT_CLOUD_TIMEOUT_MS } from './config'
import { localLLMManager } from './localLLM'
import { whisperManager } from './whisper'
import { hasApiKey } from './keyStore'

// ─── Cloud→local STT fallback ───
// Transcription is resilient: if a Groq key is set we try the cloud first (on a
// short budget); on any failure — or when no key is set at all — we transcribe
// on-device with whisper. `onFallback` lets the caller surface a one-time notice.

export type STTEngine = 'cloud' | 'local'

export interface TranscribeOutcome {
  text: string
  engine: STTEngine
  cloudError: string | null
}

/** Human-readable reason for switching to on-device (never mentions "Groq"). */
function fallbackReasonFor(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/\(401\)/.test(msg)) return 'API key rejected'
  if (/\(429\)/.test(msg)) return 'rate limit or no credits'
  if (/\(5\d\d\)/.test(msg)) return 'online model error'
  if (/abort/i.test(msg)) return 'online model timed out'
  return 'online model unavailable'
}

async function transcribeWithFallback(
  audioBuffer: Buffer,
  options: { sttEndpoint?: string; sttLanguage?: string } = {},
  signal?: AbortSignal,
  onFallback?: (reason: string) => void,
): Promise<TranscribeOutcome> {
  const groqOpts = {
    endpoint: (options.sttEndpoint === 'translations' ? 'translations' : 'transcriptions') as 'transcriptions' | 'translations',
    language: options.sttLanguage,
  }

  let cloudError: string | null = null

  if (hasApiKey()) {
    // Cloud attempt on a short budget so a hang doesn't stall the fallback.
    const budget = new AbortController()
    const timer = setTimeout(() => budget.abort(), STT_CLOUD_TIMEOUT_MS)
    const onOuter = () => budget.abort()
    signal?.addEventListener('abort', onOuter, { once: true })
    try {
      const text = await groqTranscribe(audioBuffer, groqOpts, budget.signal)
      return { text, engine: 'cloud', cloudError: null }
    } catch (err) {
      // A caller-initiated cancel (not the budget) should propagate, not fall back.
      if (signal?.aborted) throw err
      cloudError = err instanceof Error ? err.message : String(err)
      console.warn('[api] Cloud STT failed, falling back to on-device:', cloudError)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onOuter)
    }
  }

  // On-device fallback (also the path when no key is set).
  if (!whisperManager.isAvailable()) {
    if (!hasApiKey()) {
      throw new NoApiKeyError()
    }
    throw new Error(`${fallbackReasonFor(cloudError)} — and the on-device model isn't ready yet`)
  }

  onFallback?.(hasApiKey() ? fallbackReasonFor(cloudError) : 'on-device mode')
  const text = await whisperManager.transcribe(audioBuffer)
  return { text, engine: 'local', cloudError }
}

// ─── Config types (kept for compatibility; now sourced locally) ───

export interface QuotaInfo {
  used_pct: number
  remaining_budget: number
  max_recording_seconds: number
  plan: string
  resets_at: string
  capped: boolean
}

export interface ServerConfig {
  version: number
  transform: { timeout_ms: number }
  transcribe: { provider: string }
  chunking: {
    enabled: boolean
    min_duration_ms: number
    silence_threshold_rms: number
    silence_duration_ms: number
    hard_cap_ms: number
    vad_poll_interval_ms: number
  }
  junk_detection: { max_length: number; pattern: string }
  devFeatures?: { localModels: boolean }
  quota?: QuotaInfo
}

const LOCAL_CONFIG: ServerConfig = {
  version: 1,
  transform: { timeout_ms: REQUEST_TIMEOUT_MS },
  transcribe: { provider: 'groq' },
  chunking: { ...CHUNKING },
  junk_detection: { ...JUNK_DETECTION },
}

/** Returns the local config. No network. */
export function getCachedConfig(): ServerConfig {
  return LOCAL_CONFIG
}

/** No-op in local mode — kept so existing callers compile. */
export async function fetchServerConfig(_authToken?: string): Promise<ServerConfig> {
  return LOCAL_CONFIG
}

/** Config is static locally, never stale. */
export function isConfigStale(): boolean {
  return false
}

// ─── Result types ───

export interface TransformResult {
  output: string
  usedFallback: boolean
  fallbackReason: string | null
}

export interface PipelineResult {
  output: string
  transcript: string
  instructionTranscript: string | null
  usedFallback: boolean
  fallbackReason: string | null
  skippedLLM: boolean
  quota?: QuotaInfo | null
}

/** Retained for type compatibility — quota no longer exists locally, so never thrown. */
export class QuotaExceededError extends Error {
  quota: QuotaInfo | null
  constructor(message: string, quota: QuotaInfo | null) {
    super(message)
    this.name = 'QuotaExceededError'
    this.quota = quota
  }
}

// ─── Internal helpers ───

const junkPattern = new RegExp(JUNK_DETECTION.pattern)
function isJunkTranscript(text: string): boolean {
  const t = (text || '').trim()
  return t.length <= JUNK_DETECTION.max_length && junkPattern.test(t)
}

function stripChunkMarkers(text: string): string {
  return text
    .replace(/\[Chunk \d+\/\d+\]:\s*"/g, '')
    .replace(/"\s*$/gm, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
}

function isLLMRefusal(text: string): boolean {
  const lower = text.toLowerCase().trim()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
  const patterns = [
    /i('m| am) sorry.{0,20}(can't|cannot|can not|unable to)/,
    /i('m| am) not able to/,
    /i (can't|cannot|can not) (help|assist|process|generate|create|produce|write|provide)/,
    /as an ai.{0,30}(can't|cannot|can not|unable)/,
    /i('m| am) unable to (help|assist|process|fulfill|comply)/,
    /i (can't|cannot|won't|will not) (fulfill|comply|process) (this|that|your)/,
    /against my (guidelines|policy|programming|principles)/,
    /i (must|have to) (decline|refuse|refrain)/,
  ]
  return patterns.some((p) => p.test(lower))
}

/** Run a chat completion with refusal/empty fallback to a raw transcript. */
async function chatWithFallback(
  flowType: 'dictation' | 'transform' | 'quote' | 'context' | 'instruction',
  content: string | null,
  context: string | null,
  instruction: string | null,
  chunked: boolean,
  rawFallback: string,
  inputLanguage: string | undefined,
  signal?: AbortSignal,
): Promise<TransformResult> {
  const { messages, temperature } = assembleTransformMessages(
    flowType, content, context, instruction, chunked, inputLanguage,
  )
  const fallback = chunked ? stripChunkMarkers(rawFallback) : rawFallback
  try {
    const output = await groqChat(messages as GroqMessage[], { temperature }, signal)
    if (!output || output.trim() === '') {
      return { output: fallback, usedFallback: true, fallbackReason: 'empty_output' }
    }
    if (isLLMRefusal(output)) {
      return { output: fallback, usedFallback: true, fallbackReason: 'refusal' }
    }
    return { output, usedFallback: false, fallbackReason: null }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    console.warn('[api] chat failed, using raw fallback:', err instanceof Error ? err.message : err)
    return { output: fallback, usedFallback: true, fallbackReason: 'llm_error' }
  }
}

// ─── Transcription ───

export async function pipelineTranscribe(
  audioBuffer: Buffer,
  _authToken: string | null,
  options: {
    sttProvider?: string
    sttEndpoint?: string
    sttLanguage?: string
    inputLanguage?: string
    onFallback?: (reason: string) => void
  } = {},
  signal?: AbortSignal,
): Promise<string> {
  const outcome = await transcribeWithFallback(audioBuffer, options, signal, options.onFallback)
  return outcome.text
}

/** Parallel transcription (hi) + translation (en) of the same audio. */
export async function pipelineDualTranscribe(
  audioBuffer: Buffer,
  _authToken: string | null,
  signal?: AbortSignal,
): Promise<{ transcription: string; translation: string }> {
  const [transcription, translation] = await Promise.all([
    groqTranscribe(audioBuffer, { endpoint: 'transcriptions', language: 'hi' }, signal),
    groqTranscribe(audioBuffer, { endpoint: 'translations' }, signal),
  ])
  return { transcription, translation }
}

// ─── Combined pipeline: STT + LLM ───

export async function pipelineProcess(
  audioBuffer: Buffer,
  _authToken: string | null,
  flowType: 'dictation' | 'transform' | 'quote' | 'context' | 'instruction' = 'dictation',
  options: {
    sttProvider?: string
    chunked?: boolean
    context?: string | null
    instruction?: string | null
    instructionAudio?: Buffer | null
    sttEndpoint?: string
    sttLanguage?: string
    inputLanguage?: string
    onFallback?: (reason: string) => void
  } = {},
  signal?: AbortSignal,
): Promise<PipelineResult> {
  const dictationOutcome = await transcribeWithFallback(audioBuffer, options, signal, options.onFallback)
  const transcript = dictationOutcome.text

  let instruction = options.instruction ?? null
  if (options.instructionAudio) {
    // Don't re-fire the fallback notice for the second clip in the same session.
    const instrOutcome = await transcribeWithFallback(options.instructionAudio, { sttLanguage: options.sttLanguage }, signal)
    instruction = instrOutcome.text
  }

  // If STT fell back to local, the LLM (cloud-only in v1) likely won't reach either.
  // For instruction-bearing flows we still try; chatWithFallback degrades to raw text.

  // Dictation with a junk/silent transcript → no output.
  if (flowType === 'dictation' && isJunkTranscript(transcript)) {
    return {
      output: '', transcript, instructionTranscript: instruction,
      usedFallback: false, fallbackReason: null, skippedLLM: true, quota: null,
    }
  }

  const content = flowType === 'context' ? null : transcript
  const result = await chatWithFallback(
    flowType, content, options.context ?? null, instruction,
    !!options.chunked, transcript || instruction || '', options.inputLanguage, signal,
  )

  return {
    output: result.output,
    transcript,
    instructionTranscript: instruction,
    usedFallback: result.usedFallback,
    fallbackReason: result.fallbackReason,
    skippedLLM: false,
    quota: null,
  }
}

// ─── LLM-only transform (pre-transcribed text) ───

export async function pipelineTransform(
  transcript: string,
  _authToken: string | null,
  flowType: 'dictation' | 'transform' | 'quote' | 'context' | 'instruction' = 'dictation',
  options: {
    chunked?: boolean
    context?: string | null
    instruction?: string | null
    inputLanguage?: string
    sttProvider?: string
  } = {},
  signal?: AbortSignal,
): Promise<TransformResult> {
  const content = flowType === 'context' ? null : (transcript || '')
  const rawFallback = transcript || options.instruction || ''
  return chatWithFallback(
    flowType, content, options.context ?? null, options.instruction ?? null,
    !!options.chunked, rawFallback, options.inputLanguage, signal,
  )
}

// ─── Local LLM (offline) ───

export async function localTransformText(
  content: string | null,
  context: string | null,
  instruction: string | null,
  flowType: 'dictation' | 'transform' | 'quote' | 'context' | 'instruction' = 'dictation',
  chunked: boolean = false,
  signal?: AbortSignal,
  inputLanguage?: string,
): Promise<string> {
  const { messages, temperature } = assembleTransformMessages(flowType, content, context, instruction, chunked, inputLanguage)
  return localLLMManager.chat(messages, { temperature, max_tokens: 2048 }, signal)
}
