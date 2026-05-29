// ─── Direct Groq API client ───
// unmute calls Groq directly from the main process using the user's own key
// (stored via keyStore). No proxy, no server. Keep-alive agents reuse TCP+TLS
// connections to shave handshake latency off back-to-back requests.

import { Agent as UndiciAgent, fetch as undiciFetch, FormData as UndiciFormData } from 'undici'
import { GROQ, REQUEST_TIMEOUT_MS } from './config'
import { getApiKey } from './keyStore'
import { recordSttUsage, recordLlmUsage } from './usageTracker'

const agent = new UndiciAgent({
  keepAliveTimeout: 120_000,
  keepAliveMaxTimeout: 120_000,
  connections: 4,
  pipelining: 1,
})

/** Thrown when no Groq API key is configured. Callers should prompt the user. */
export class NoApiKeyError extends Error {
  constructor() {
    super('No Groq API key set. Add your key in Settings.')
    this.name = 'NoApiKeyError'
  }
}

function requireKey(): string {
  const key = getApiKey()
  if (!key) throw new NoApiKeyError()
  return key
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TranscribeOptions {
  /** 'transcriptions' (default) or 'translations' (force English output) */
  endpoint?: 'transcriptions' | 'translations'
  /** ISO language hint, or 'auto' to omit and let Whisper detect */
  language?: string
}

/** Combine an optional caller signal with an internal timeout. */
function withTimeout(signal?: AbortSignal): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

/** Transcribe audio via Groq Whisper. Returns the raw transcript text. */
export async function groqTranscribe(
  audioBuffer: Buffer,
  options: TranscribeOptions = {},
  signal?: AbortSignal,
): Promise<string> {
  const key = requireKey()
  const url = options.endpoint === 'translations' ? GROQ.sttTranslationsUrl : GROQ.sttUrl

  const form = new UndiciFormData()
  form.append('file', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/webm' }), 'audio.webm')
  form.append('model', GROQ.sttModel)
  form.append('response_format', GROQ.sttResponseFormat)
  form.append('temperature', '0')
  // No `prompt`: Whisper treats it as preceding text and parrots it back on
  // silence/noise (e.g. "What is the spoken audio?"). Omitting it avoids that.
  const lang = options.language ?? GROQ.sttDefaultLanguage
  if (lang && lang !== 'auto') form.append('language', lang)

  const t0 = Date.now()
  const { signal: timed, clear } = withTimeout(signal)
  try {
    const res = await undiciFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: timed,
      dispatcher: agent,
    } as any)
    const body = await res.text()
    if (!res.ok) {
      throw new Error(`Groq transcription failed (${res.status}): ${body.substring(0, 200)}`)
    }
    const result = JSON.parse(body) as { text?: string; duration?: number }
    // `verbose_json` reports the billed audio duration (seconds) — feed the
    // local usage estimate. Best-effort; never blocks the transcript.
    if (typeof result.duration === 'number') recordSttUsage(GROQ.sttModel, result.duration)
    console.log(`[groq:stt] ${Date.now() - t0}ms | ${(result.text || '').length} chars`)
    return result.text || ''
  } finally {
    clear()
  }
}

/** Run a chat completion via Groq. Returns the assistant message content. */
export async function groqChat(
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number } = {},
  signal?: AbortSignal,
): Promise<string> {
  const key = requireKey()
  const body = JSON.stringify({
    model: GROQ.chatModel,
    messages,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens ?? GROQ.chatMaxTokens,
  })

  const t0 = Date.now()
  const { signal: timed, clear } = withTimeout(signal)
  try {
    const res = await undiciFetch(GROQ.chatUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body,
      signal: timed,
      dispatcher: agent,
    } as any)
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`Groq chat failed (${res.status}): ${text.substring(0, 200)}`)
    }
    const result = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = result.choices?.[0]?.message?.content || ''
    // Token counts feed the local usage estimate. Best-effort.
    if (result.usage) {
      recordLlmUsage(GROQ.chatModel, result.usage.prompt_tokens || 0, result.usage.completion_tokens || 0)
    }
    console.log(`[groq:chat] ${Date.now() - t0}ms | ${content.length} chars`)
    return content
  } finally {
    clear()
  }
}

/**
 * Validate a candidate API key with a lightweight GET /models call.
 * Used by the Settings "Test key" button. Does not persist the key.
 */
export async function validateApiKey(key: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = key.trim()
  if (!trimmed) return { ok: false, error: 'Key is empty' }
  try {
    const res = await undiciFetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${trimmed}` },
      dispatcher: agent,
    } as any)
    if (res.ok) return { ok: true }
    if (res.status === 401) return { ok: false, error: 'Invalid API key' }
    return { ok: false, error: `Groq returned ${res.status}` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}
