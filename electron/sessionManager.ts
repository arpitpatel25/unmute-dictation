import { v4 as uuidv4 } from 'uuid'
import { pipelineTranscribe, pipelineDualTranscribe, pipelineProcess, pipelineTransform, localTransformText, getCachedConfig, QuotaExceededError, type ServerConfig, type TransformResult, type PipelineResult } from './api'
import { whisperManager } from './whisper'
import { fasterWhisperManager } from './fasterWhisper'
import { captureSelectedText, injectOutput, copyToClipboard } from './clipboard'
import { saveAudioFile, saveAudioChunk } from './audio'
import { getWidgetWindow, showHUD, hideHUD } from './windowManager'
import { setTrayRecording, setTrayIdle } from './tray'
import { broadcastError } from './errorLogger'
import { simplifyError } from './errorUtils'
import { features } from './featureFlags'
import { hasApiKey } from './keyStore'

type FlowType = 'dictation' | 'transform' | 'quote' | 'context' | 'instruction'

/**
 * Detect LLM refusal responses — safety guardrails that refuse to process
 * the user's dictation. In a voice-to-text app, the user is dictating their
 * own words and the LLM should never censor them. If it does, we fall back
 * to the raw Whisper transcript.
 */
function isLLMRefusal(text: string): boolean {
  // Normalize smart/curly quotes to straight quotes — LLMs often return Unicode quotes
  const lower = text.toLowerCase().trim()
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
  const refusalPatterns = [
    /i('m| am) sorry.{0,20}(can't|cannot|can not|unable to)/,
    /i('m| am) not able to/,
    /i (can't|cannot|can not) (help|assist|process|generate|create|produce|write|provide)/,
    /as an ai.{0,30}(can't|cannot|can not|unable)/,
    /i('m| am) unable to (help|assist|process|fulfill|comply)/,
    /this (content|text|request|input) (is|contains|includes|involves).{0,30}(inappropriate|harmful|offensive|violent|abusive)/,
    /i (can't|cannot|won't|will not) (fulfill|comply|process) (this|that|your)/,
    /against my (guidelines|policy|programming|principles)/,
    /not (appropriate|something i can|able to assist)/,
    /i (must|have to) (decline|refuse|refrain)/,
  ]
  return refusalPatterns.some(pattern => pattern.test(lower))
}

/**
 * Lightweight deterministic cleanup for raw dictation output — no LLM.
 * Trims, normalises whitespace, and strips trailing Whisper hallucinations
 * that commonly appear on terminal silence (e.g. "Thank you.",
 * "Thanks for watching.", "Please subscribe.").
 */
export function cleanTranscript(text: string): string {
  if (!text) return ''
  let t = text.replace(/\r/g, '').trim()
  if (t === '[BLANK_AUDIO]') return ''
  // normalise runs of spaces/tabs and excessive blank lines
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n')
  // strip well-known trailing STT hallucinations on silence
  t = t.replace(/[\s]*(?:thanks? for watching[.!]?|please subscribe[.!]?|thank you[.!]?)\s*$/i, '').trim()
  return t
}

/** Join per-chunk transcripts into one clean block (deterministic, no LLM). */
function stitchChunks(transcripts: string[]): string {
  return cleanTranscript(transcripts.map((t) => t.trim()).filter(Boolean).join(' '))
}

interface SessionState {
  sessionId: string
  dictationAudio: Buffer | null
  instructionAudio: Buffer | null
  selectedText: string | null
  selectedTextRole: 'quote' | 'context' | null
  dictationTranscript: string | null
  instructionTranscript: string | null
  output: string | null
  flowType: FlowType
  status: 'recording' | 'processing' | 'done' | 'error'
  errorMessage: string | null
  createdAt: number
}

function sendToWidget(channel: string, ...args: unknown[]): void {
  const widget = getWidgetWindow()
  if (widget?.webContents) {
    widget.webContents.send(channel, ...args)
  }
}

class SessionManager {
  private currentSession: SessionState | null = null
  private authToken: string | null = null
  private outputMode: 'paste' | 'clipboard' = 'paste'
  private llmProvider: 'cloud' | 'local-llm' = 'cloud'
  private sttProvider: 'cloud' | 'local' | 'faster-whisper' | 'cartesia' | 'sarvam' | 'dual-whisper' = 'cloud'
  private backendProvider: 'supabase' | 'cloudflare' = 'cloudflare'
  private usePipeline = true  // Combined STT+LLM pipeline worker (default: on)
  private sttEndpoint: 'transcriptions' | 'translations' = 'transcriptions'  // Dev-only: Whisper endpoint
  private sttLanguage: string = 'en'  // Dev-only: Whisper language hint
  private inputLanguage: 'en' | 'hinglish' = 'en'  // User-facing input language setting
  private serverConfig: ServerConfig | null = null

  // Processing lock — prevents new sessions during API calls
  private isProcessing = false
  private abortController: AbortController | null = null

  // True once we've told the user this session is using the on-device model
  // (so the notice fires once, not per chunk).
  private fallbackNotified = false

  // Tracks whether an instruction recording was started in this session.
  // Used by processSession() to know it should wait for instruction audio IPC
  // before determining flow type and processing.
  private expectingInstructionAudio = false

  // Undo cancel state
  private cancelledSession: SessionState | null = null
  private undoTimer: ReturnType<typeof setTimeout> | null = null

  // Auto-hide timer — tracks the delayed hideHUD() call so it can be cancelled
  // when a new session starts (prevents old timer from killing new session's HUD)
  private autoHideTimer: ReturnType<typeof setTimeout> | null = null

  // ─── Chunked transcription state ───
  private chunkTracker: Map<number, {
    buffer: Buffer
    transcript: string | null
    translation: string | null
    transcriptionPromise: Promise<string> | null
    startedAt: number
    completedAt: number | null
    error: string | null
  }> = new Map()
  private totalChunksExpected: number | null = null
  private isChunkedSession = false

  // Callback to save session to DB (set from main.ts after DB is initialized)
  public onSessionComplete: ((session: SessionState) => void) | null = null

  // Callbacks for Escape shortcut lifecycle (set from main.ts)
  public onRecordingStarted: (() => void) | null = null
  public onRecordingStopped: (() => void) | null = null

  // Called when a session is fully terminated (cancel, Escape, processing done)
  // Used to reset keyboard state so it doesn't get stuck
  public onSessionEnded: (() => void) | null = null

  // Called when a session-start is rejected (e.g. during processing)
  // Used to reset keyboard toggle state without unregistering Escape
  public onSessionRejected: (() => void) | null = null

  /** Whether a session is currently being processed (API calls in flight) */
  get processing(): boolean {
    return this.isProcessing
  }

  /** Tell the HUD this session switched to the on-device model (once per session). */
  private notifyEngineFallback(reason: string): void {
    if (this.fallbackNotified) return
    this.fallbackNotified = true
    console.log('[session] 🟡 Using on-device model —', reason)
    sendToWidget('session:engine-notice', reason)
  }

  /**
   * User-facing reason shown when an instruction/transform fell back to raw
   * text. Formatting runs on Groq, so it's unavailable without a key or while
   * offline — make that explicit instead of a vague "formatting failed".
   */
  private formattingNotice(): string {
    return hasApiKey()
      ? 'Formatting needs internet — pasted raw'
      : 'Formatting needs a Groq key — pasted raw'
  }

  getAuthToken(): string | null {
    return this.authToken
  }

  setAuthToken(token: string): void {
    if (this.authToken !== token) {
      console.log('[session] Auth token updated, length:', token?.length, 'prefix:', token?.substring(0, 20) + '...')
    }
    this.authToken = token
  }

  setServerConfig(config: ServerConfig): void {
    console.log('[session] Server config updated, version:', config.version)
    this.serverConfig = config
  }

  getServerConfig(): ServerConfig | null {
    return this.serverConfig
  }

  setOutputMode(mode: 'paste' | 'clipboard'): void {
    this.outputMode = mode
  }

  setLLMProvider(provider: 'cloud' | 'local-llm'): void {
    // Map any legacy provider values to 'cloud'; force cloud when local models disabled
    const normalized = (!features.localModels || provider !== 'local-llm') ? 'cloud' : 'local-llm'
    console.log('[session] LLM provider set to:', normalized)
    this.llmProvider = normalized
  }

  getLLMProvider(): 'cloud' | 'local-llm' {
    return this.llmProvider
  }

  setSTTProvider(provider: 'cloud' | 'local' | 'faster-whisper' | 'cartesia' | 'sarvam' | 'dual-whisper'): void {
    // Force cloud when local models disabled
    const effective = (!features.localModels && (provider === 'local' || provider === 'faster-whisper')) ? 'cloud' : provider
    console.log('[session] STT provider set to:', effective)
    this.sttProvider = effective
  }

  getSTTProvider(): 'cloud' | 'local' | 'faster-whisper' | 'cartesia' | 'sarvam' | 'dual-whisper' {
    return this.sttProvider
  }

  setSTTEndpoint(endpoint: 'transcriptions' | 'translations'): void {
    console.log('[session] STT endpoint set to:', endpoint)
    this.sttEndpoint = endpoint
  }

  getSTTEndpoint(): 'transcriptions' | 'translations' {
    return this.sttEndpoint
  }

  setSTTLanguage(language: string): void {
    console.log('[session] STT language set to:', language)
    this.sttLanguage = language
  }

  getSTTLanguage(): string {
    return this.sttLanguage
  }

  setInputLanguage(language: 'en' | 'hinglish'): void {
    console.log('[session] Input language set to:', language)
    this.inputLanguage = language
  }

  getInputLanguage(): 'en' | 'hinglish' {
    return this.inputLanguage
  }

  /**
   * Compute the effective STT language, accounting for dev overrides.
   * Priority: dev sttLanguage override > inputLanguage-derived > default 'en'
   */
  getEffectiveSTTLanguage(): string {
    // Dev override wins if it's been changed from default 'en'
    if (this.sttLanguage !== 'en') {
      return this.sttLanguage
    }
    // User-facing inputLanguage: hinglish → 'hi' for Whisper
    if (this.inputLanguage === 'hinglish') {
      return 'hi'
    }
    return 'en'
  }

  /**
   * Compute the effective STT provider, accounting for dev overrides and input language.
   * Priority: dev sttProvider override > inputLanguage-based auto-routing > default 'cloud'
   */
  getEffectiveSTTProvider(): 'cloud' | 'local' | 'faster-whisper' | 'cartesia' | 'sarvam' | 'dual-whisper' {
    // Dev override: if explicitly set to non-cloud, use that
    if (this.sttProvider !== 'cloud') return this.sttProvider
    // Auto-route: non-English input → Sarvam (auto-detects all 22 Indian languages)
    if (this.inputLanguage !== 'en') return 'sarvam'
    return 'cloud'
  }

  setBackendProvider(provider: 'supabase' | 'cloudflare'): void {
    console.log('[session] Backend provider set to:', provider)
    this.backendProvider = provider
  }

  getBackendProvider(): 'supabase' | 'cloudflare' {
    return this.backendProvider
  }


  setPipeline(enabled: boolean): void {
    console.log('[session] Pipeline mode set to:', enabled)
    this.usePipeline = enabled
  }

  getPipeline(): boolean {
    return this.usePipeline
  }

  startSession(mode: 'dictation' | 'instruction'): void {
    console.log('[session] startSession called, mode:', mode, '| isProcessing:', this.isProcessing, '| currentSession:', this.currentSession?.sessionId || 'null')
    if (this.isProcessing) {
      console.log('[session] ⛔ BLOCKED — Fn pressed during processing — showing discard hint')
      sendToWidget('processing:show-discard-hint')
      // Reset keyboard toggle state so dictationActive/instructionActive
      // don't get stuck as true (the session was rejected, not started)
      this.onSessionRejected?.()
      return
    }

    console.log('╔══════════════════════════════════════════╗')
    console.log('║  SESSION START                           ║')
    console.log('╚══════════════════════════════════════════╝')
    console.log('[session] Mode:', mode)
    console.log('[session] Has auth token:', !!this.authToken)

    // Clear any pending undo state and cancel old auto-hide timers
    this.clearUndoState()
    this.cancelAutoHide()
    this.expectingInstructionAudio = false

    if (!this.currentSession) {
      const sessionId = uuidv4()
      this.currentSession = {
        sessionId,
        dictationAudio: null,
        instructionAudio: null,
        selectedText: null,
        selectedTextRole: null,
        dictationTranscript: null,
        instructionTranscript: null,
        output: null,
        flowType: 'dictation',
        status: 'recording',
        errorMessage: null,
        createdAt: Date.now()
      }
      console.log('[session] New session created:', sessionId)
    } else {
      console.log('[session] Reusing existing session:', this.currentSession.sessionId)
    }

    // Show HUD FIRST — before clipboard capture, which runs osascript Cmd+C
    // and can briefly interfere with macOS window focus/ordering
    showHUD()
    setTrayRecording(mode)
    sendToWidget('recording:start', mode, this.currentSession.sessionId)
    console.log('[session] HUD shown, recording:start sent for mode:', mode)

    // Capture selected text AFTER HUD is shown — delay to let macOS
    // finish rendering the window before osascript Cmd+C fires,
    // which can disrupt window ordering
    if (!this.currentSession.selectedText) {
      setTimeout(() => this.captureSelection(mode), 50)
    }

    // Notify main process (for Escape shortcut registration)
    this.onRecordingStarted?.()
  }

  chainSession(mode: 'dictation' | 'instruction'): void {
    console.log('[session] chainSession called, mode:', mode, '| isProcessing:', this.isProcessing)
    if (this.isProcessing) {
      console.log('[session] ⛔ BLOCKED chainSession — still processing')
      sendToWidget('processing:show-discard-hint')
      this.onSessionRejected?.()
      return
    }

    console.log('[session] CHAIN session, mode:', mode)
    console.log('[session]   Current session:', this.currentSession?.sessionId)
    console.log('[session]   Has dictation audio:', !!this.currentSession?.dictationAudio)
    console.log('[session]   Has instruction audio:', !!this.currentSession?.instructionAudio)

    // Track that we're expecting instruction audio — processSession must wait for it
    if (mode === 'instruction') {
      this.expectingInstructionAudio = true
      console.log('[session]   expectingInstructionAudio = TRUE')
    }

    this.cancelAutoHide()
    showHUD()
    setTrayRecording(mode)
    sendToWidget('recording:start', mode, this.currentSession?.sessionId)

    this.onRecordingStarted?.()
  }

  /**
   * True when an audio buffer is tagged with a session ID that belongs to
   * neither the active nor the cancelled (undo) session — i.e. a late buffer
   * from a dictation that already ended. Lenient: an absent ID is accepted, so
   * this can never reject a clip on the normal path.
   */
  private isForeignSessionAudio(sessionId?: string): boolean {
    if (!sessionId) return false
    return sessionId !== this.currentSession?.sessionId &&
           sessionId !== this.cancelledSession?.sessionId
  }

  async stopRecording(mode: 'dictation' | 'instruction'): Promise<void> {
    console.log('[session] stopRecording called, mode:', mode, '| isProcessing:', this.isProcessing)
    if (this.isProcessing) {
      console.log('[session] ⛔ BLOCKED stopRecording — already processing')
      this.onSessionRejected?.()
      return
    }

    console.log('[session] STOP recording, mode:', mode)
    sendToWidget('recording:stop')

    // Notify main process (for Escape shortcut unregistration)
    this.onRecordingStopped?.()
    // Audio will arrive via IPC 'audio:ready'
  }

  // ─── Chunked transcription methods ───

  receiveAudioChunk(buffer: Buffer, chunkIndex: number, mode: 'dictation' | 'instruction', sessionId?: string): void {
    if (this.isForeignSessionAudio(sessionId)) {
      console.warn(`[session] ⏭️ Dropping stale chunk ${chunkIndex} for ended session ${sessionId} (current: ${this.currentSession?.sessionId || 'none'})`)
      return
    }
    const session = this.currentSession
    if (!session) {
      console.warn('[session] receiveAudioChunk called but no current session!')
      return
    }

    this.isChunkedSession = true
    const chunkState = {
      buffer,
      transcript: null as string | null,
      translation: null as string | null,
      transcriptionPromise: null as Promise<string> | null,
      startedAt: Date.now(),
      completedAt: null as number | null,
      error: null as string | null,
    }
    this.chunkTracker.set(chunkIndex, chunkState)

    console.log(`[session] 📦 Chunk ${chunkIndex} received (${buffer.byteLength} bytes, mode: ${mode}) — starting parallel transcription`)

    // Persist chunk to disk so a mid-session cancel doesn't lose the audio
    try {
      saveAudioChunk(session.sessionId, chunkIndex, buffer, false)
    } catch (err) {
      console.error('[session] Failed to save audio chunk', chunkIndex, err)
    }

    // Fire off transcription immediately (parallel)
    chunkState.transcriptionPromise = this.transcribeChunk(buffer, chunkIndex)
  }

  receiveAudioFinalChunk(buffer: Buffer, chunkIndex: number, totalChunks: number, duration: number, mode: 'dictation' | 'instruction', sessionId?: string): void {
    if (this.isForeignSessionAudio(sessionId)) {
      console.warn(`[session] ⏭️ Dropping stale final chunk ${chunkIndex} for ended session ${sessionId} (current: ${this.currentSession?.sessionId || 'none'})`)
      return
    }
    const session = this.currentSession
    if (!session) {
      console.warn('[session] receiveAudioFinalChunk called but no current session!')
      return
    }

    this.isChunkedSession = true
    this.totalChunksExpected = totalChunks

    const chunkState = {
      buffer,
      transcript: null as string | null,
      translation: null as string | null,
      transcriptionPromise: null as Promise<string> | null,
      startedAt: Date.now(),
      completedAt: null as number | null,
      error: null as string | null,
    }
    this.chunkTracker.set(chunkIndex, chunkState)

    console.log(`[session] 📦 Final chunk ${chunkIndex}/${totalChunks} received (${buffer.byteLength} bytes, duration: ${duration}ms, mode: ${mode})`)

    // Skip transcription for tiny final chunks (< 10KB) — almost certainly trailing silence
    // that causes Whisper to hallucinate phrases like "Thank you." or "Thanks for watching."
    const MIN_FINAL_CHUNK_BYTES = 10_000
    if (buffer.byteLength < MIN_FINAL_CHUNK_BYTES) {
      console.log(`[session] ⏭️ Final chunk too small (${buffer.byteLength} < ${MIN_FINAL_CHUNK_BYTES} bytes) — skipping transcription to avoid hallucination`)
      chunkState.transcript = ''
      chunkState.completedAt = Date.now()
    } else {
      chunkState.transcriptionPromise = this.transcribeChunk(buffer, chunkIndex)
    }

    // Store the full duration on the dictation audio slot so processSession sees it has audio
    // Use the final chunk buffer as a placeholder — the real transcripts come from chunkTracker
    session.dictationAudio = buffer

    // Save audio file for debugging (concatenate all chunks conceptually — use final for file save)
    saveAudioFile(session.sessionId + '-dictation-final', buffer)

    // Also persist the final chunk under the chunk-naming scheme so reassembly
    // (chunks 0..N in order) is straightforward.
    try {
      saveAudioChunk(session.sessionId, chunkIndex, buffer, true)
    } catch (err) {
      console.error('[session] Failed to save final audio chunk', chunkIndex, err)
    }
  }

  private async transcribeChunk(buffer: Buffer, chunkIndex: number): Promise<string> {
    const t0 = Date.now()
    const effectiveSTT = this.getEffectiveSTTProvider()
    const useLocalWhisper = features.localModels && effectiveSTT === 'local' && whisperManager.isModelReady() && whisperManager.isBinaryReady()
    const useFasterWhisper = features.localModels && effectiveSTT === 'faster-whisper' && fasterWhisperManager.isReady()
    const useCartesia = effectiveSTT === 'cartesia'
    const useSarvam = effectiveSTT === 'sarvam'
    const useDualWhisper = effectiveSTT === 'dual-whisper'

    try {
      let transcript: string

      if (useDualWhisper) {
        // Dual whisper: parallel transcription + translation via worker
        if (!hasApiKey()) throw new Error('No Groq API key set. Add your key in Settings.')
        const dualResult = await pipelineDualTranscribe(buffer, this.authToken)
        transcript = dualResult.transcription

        // Store translation alongside transcript
        const chunk = this.chunkTracker.get(chunkIndex)
        if (chunk) {
          chunk.translation = dualResult.translation
        }
      } else if (useFasterWhisper) {
        transcript = await fasterWhisperManager.transcribe(buffer)
      } else if (useLocalWhisper) {
        transcript = await whisperManager.transcribe(buffer)
      } else {
        // pipelineTranscribe handles cloud→on-device fallback (and no-key→on-device)
        const cloudProvider = useSarvam ? 'sarvam' as const : useCartesia ? 'cartesia' as const : 'groq' as const
        transcript = await pipelineTranscribe(buffer, this.authToken, {
          sttProvider: cloudProvider,
          sttEndpoint: this.sttEndpoint,
          sttLanguage: this.getEffectiveSTTLanguage(),
          onFallback: (reason) => this.notifyEngineFallback(reason),
        })
      }

      const elapsed = Date.now() - t0
      const chunk = this.chunkTracker.get(chunkIndex)
      if (chunk) {
        chunk.transcript = transcript
        chunk.completedAt = Date.now()
      }

      const sttLabel = useDualWhisper ? 'dual-whisper' : useSarvam ? 'sarvam' : useCartesia ? 'cartesia' : useFasterWhisper ? 'faster-whisper' : useLocalWhisper ? 'local' : 'cloud'
      const preview = transcript.length > 80 ? transcript.substring(0, 80) + '...' : transcript
      console.log(`[session] ✅ Chunk ${chunkIndex} transcribed in ${elapsed}ms (${sttLabel}): "${preview}"`)
      if (useDualWhisper) {
        const chunk = this.chunkTracker.get(chunkIndex)
        const translationPreview = chunk?.translation ? (chunk.translation.length > 80 ? chunk.translation.substring(0, 80) + '...' : chunk.translation) : '(empty)'
        console.log(`[session]    Translation: "${translationPreview}"`)
      }
      return transcript
    } catch (err) {
      const elapsed = Date.now() - t0
      const errorMsg = err instanceof Error ? err.message : 'Transcription failed'
      const chunk = this.chunkTracker.get(chunkIndex)
      if (chunk) {
        chunk.error = errorMsg
        chunk.completedAt = Date.now()
      }
      console.error(`[session] ❌ Chunk ${chunkIndex} transcription failed after ${elapsed}ms:`, errorMsg)
      return '' // Return empty — we'll still assemble what we have
    }
  }

  private resetChunkState(): void {
    this.chunkTracker.clear()
    this.totalChunksExpected = null
    this.isChunkedSession = false
  }

  receiveAudio(buffer: Buffer, duration: number, mode: 'dictation' | 'instruction', sessionId?: string): void {
    // Reject a late buffer from a dictation that already ended — it would
    // otherwise land in (and overwrite) the slot of whatever session is current.
    if (this.isForeignSessionAudio(sessionId)) {
      console.warn(`[session] ⏭️ Dropping stale audio for ended session ${sessionId} (current: ${this.currentSession?.sessionId || 'none'}, cancelled: ${this.cancelledSession?.sessionId || 'none'})`)
      return
    }
    // Audio may arrive after cancel (since IPC is async) — check cancelledSession too
    const session = this.currentSession || this.cancelledSession
    if (!session) {
      console.warn('[session] receiveAudio called but no current or cancelled session!')
      return
    }

    const isCancelled = !this.currentSession && !!this.cancelledSession
    console.log('┌─ AUDIO RECEIVED ─────────────────────────')
    console.log('│ Session:', session.sessionId, isCancelled ? '(from cancelled session)' : '')
    console.log('│ Mode (from IPC):', mode)
    console.log('│ Buffer size:', buffer.byteLength, 'bytes')
    console.log('│ Duration:', duration, 'ms')
    console.log('│ Has dictation audio already:', !!session.dictationAudio)
    console.log('│ Has instruction audio already:', !!session.instructionAudio)
    console.log('│ Selected text role:', session.selectedTextRole)

    if (mode === 'dictation') {
      if (session.dictationAudio) {
        console.log('│ → WARNING: Dictation slot already filled, overwriting!')
      }
      session.dictationAudio = buffer
      console.log('│ → Assigned to: DICTATION audio slot')
    } else if (mode === 'instruction') {
      if (session.instructionAudio) {
        console.log('│ → WARNING: Instruction slot already filled, overwriting!')
      }
      session.instructionAudio = buffer
      console.log('│ → Assigned to: INSTRUCTION audio slot')
    } else {
      console.warn('│ → WARNING: Unknown mode "' + mode + '", ignoring!')
    }

    const audioPath = saveAudioFile(session.sessionId + '-' + mode, buffer)
    console.log('│ Audio file saved:', audioPath)
    console.log('└───────────────────────────────────────────')
  }

  async processSession(): Promise<void> {
    const session = this.currentSession
    if (!session) {
      console.warn('[session] processSession called but no current session!')
      return
    }

    // Lock processing IMMEDIATELY — blocks new sessions, chains, and duplicate processSession calls
    // This must happen before the grace period to prevent concurrent entry
    if (this.isProcessing) {
      console.log('[session] ⛔ processSession already running, ignoring duplicate call')
      return
    }
    this.isProcessing = true
    this.fallbackNotified = false
    console.log('[session] 🔒 isProcessing = TRUE')

    // Guard: no audio received (rapid double-press or too-short recording)
    // Audio IPC from the renderer may still be in-flight — poll until it arrives (up to 200ms)
    if (!session.dictationAudio && !session.instructionAudio) {
      console.log('[session] No audio yet — polling for IPC (up to 200ms)...')
      const t0 = Date.now()
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 10))
        if (session.dictationAudio || session.instructionAudio) break
      }

      if (!session.dictationAudio && !session.instructionAudio) {
        console.log('[session] No audio received after grace period — showing too-short feedback')
        this.currentSession = null
        this.isProcessing = false
        this.expectingInstructionAudio = false
        console.log('[session] 🔓 isProcessing = FALSE (no audio)')
        sendToWidget('session:too-short')
        this.scheduleAutoHide(1500)
        this.onSessionEnded?.()
        return
      }
      console.log(`[session] ✓ Audio arrived during grace period (${Date.now() - t0}ms), continuing`)
    }

    // Guard: instruction audio expected but not yet received (chain flow race condition)
    // In a chain flow (Fn→speak→Control→speak→Control), the chain-expired event fires on the
    // final key press, but the instruction audio IPC from the renderer hasn't arrived yet.
    // We must wait for it, otherwise the session gets processed as dictation-only.
    if (this.expectingInstructionAudio && !session.instructionAudio) {
      console.log('[session] Instruction audio expected but not received — waiting up to 500ms...')
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 50))
        if (session.instructionAudio) {
          console.log('[session] ✓ Instruction audio arrived after', (i + 1) * 50, 'ms')
          break
        }
      }
      if (!session.instructionAudio) {
        console.log('[session] ⚠️ Instruction audio never arrived after 500ms — proceeding without it')
      }
      this.expectingInstructionAudio = false
    }

    const pipelineStart = Date.now()
    console.log('╔══════════════════════════════════════════╗')
    console.log('║  PROCESSING SESSION                      ║')
    console.log('╚══════════════════════════════════════════╝')
    console.log('[session] Session ID:', session.sessionId)
    console.log('[session] Has dictation audio:', !!session.dictationAudio, session.dictationAudio ? `(${session.dictationAudio.byteLength} bytes)` : '')
    console.log('[session] Has instruction audio:', !!session.instructionAudio, session.instructionAudio ? `(${session.instructionAudio.byteLength} bytes)` : '')
    console.log('[session] Selected text:', session.selectedText ? `"${session.selectedText.substring(0, 80)}..."` : 'none')
    console.log('[session] Selected text role:', session.selectedTextRole)
    console.log('[session] Auth token available:', !!this.authToken)
    session.status = 'processing'
    sendToWidget('recording:stop')

    // Create AbortController with config-driven timeout for API calls
    // Using 'let' so the pipeline fallback can replace with a fresh controller/timeout
    let controller = new AbortController()
    this.abortController = controller
    const config = this.serverConfig || getCachedConfig()
    const timeoutMs = config.transform.timeout_ms
    let apiTimeout = setTimeout(() => {
      console.log(`[session] API timeout (${timeoutMs}ms) — aborting`)
      controller.abort()
    }, timeoutMs)

    try {
      if (!hasApiKey() && !whisperManager.isAvailable()) {
        throw new Error('Add a Groq key in Settings, or wait for the on-device model to finish downloading.')
      }

      session.flowType = this.determineFlowType(session)
      console.log('[session] Determined flow type:', session.flowType)

      // ═══════════════════════════════════════════════════════════════
      // PIPELINE FAST PATH: Combined STT + LLM in one request
      // Conditions: pipeline enabled, cloudflare backend, cloud LLM, non-chunked, has dictation audio
      // ═══════════════════════════════════════════════════════════════
      const canUsePipeline = this.usePipeline
        && this.backendProvider === 'cloudflare'
        && this.llmProvider !== 'local-llm'
        && !this.isChunkedSession
        && session.dictationAudio  // Need audio to send

      if (canUsePipeline) {
        const effectiveSTT = this.getEffectiveSTTProvider()
        const sttProvider = (effectiveSTT === 'dual-whisper' ? 'dual-whisper' : effectiveSTT === 'sarvam' ? 'sarvam' : effectiveSTT === 'cartesia' ? 'cartesia' : 'groq') as 'groq' | 'cartesia' | 'sarvam' | 'dual-whisper'
        // Raw-by-default: pure dictation never goes through the LLM.
        // Only flows with an explicit instruction (transform/context/instruction) use it.
        const skipLLM = session.flowType === 'dictation'

        if (skipLLM) {
          console.log('[session] 🚀 STT-only (raw dictation, no LLM)')
        } else {
          console.log('[session] 🚀 PIPELINE MODE — single request for STT + LLM')
        }

        try {
          const tPreFetch = Date.now()
          console.log(`[session] ⏱ Pre-fetch setup: ${tPreFetch - pipelineStart}ms (flow type determination + prep)`)

          // Pure dictation → transcribe only, clean deterministically, no LLM
          if (skipLLM) {
            const transcript = await pipelineTranscribe(
              session.dictationAudio!,
              this.authToken,
              { sttProvider, sttEndpoint: this.sttEndpoint, sttLanguage: this.getEffectiveSTTLanguage(), onFallback: (r) => this.notifyEngineFallback(r) },
              controller.signal
            )
            const tPostFetch = Date.now()
            console.log(`[session] ⏱ Pipeline STT-only returned: ${tPostFetch - tPreFetch}ms`)

            session.dictationTranscript = transcript
            const output = cleanTranscript(transcript)

            if (!output || output === '[BLANK_AUDIO]') {
              console.log('[session] Pipeline STT-only: empty/blank transcript, skipping output')
              session.status = 'done'
              session.output = null
              this.scheduleAutoHide(1500)
              clearTimeout(apiTimeout)
              this.abortController = null
              this.isProcessing = false
              this.resetChunkState()

              console.log('[session] 🔓 isProcessing = FALSE (pipeline STT-only junk)')
              try { this.onSessionComplete?.(session) } catch { /* ignore */ }
              this.currentSession = null
              this.onSessionEnded?.()
              return
            }

            session.output = output
            session.status = 'done'
            console.log('[session] ✅ FINAL OUTPUT (raw transcript):', JSON.stringify(output))

            // Inject output
            const tInjectStart = Date.now()
            if (this.outputMode === 'paste') {
              console.log('[session] Injecting output via paste...')
              await injectOutput(output)
            } else {
              console.log('[session] Copying output to clipboard...')
              copyToClipboard(output)
            }
            const tInjectEnd = Date.now()
            console.log(`[session] ⏱ Output injection: ${tInjectEnd - tInjectStart}ms`)

            sendToWidget('output:ready', output, session.sessionId)
            this.scheduleAutoHide(2500)

            clearTimeout(apiTimeout)
            this.abortController = null
            this.isProcessing = false
            this.resetChunkState()
            const totalEnd = Date.now()
            console.log(`[session] ⏱ PIPELINE STT-ONLY END-TO-END: ${totalEnd - pipelineStart}ms`)
            console.log('[session] 🔓 isProcessing = FALSE (pipeline STT-only done)')
            try { this.onSessionComplete?.(session) } catch { /* ignore */ }
            this.currentSession = null
            this.onSessionEnded?.()
            return
          }

          const pipelineResult = await pipelineProcess(
            session.dictationAudio!,
            this.authToken,
            session.flowType as 'dictation' | 'transform' | 'quote' | 'context' | 'instruction',
            {
              sttProvider,
              chunked: false,
              context: session.selectedText || null,
              instruction: session.instructionTranscript || null,
              instructionAudio: session.instructionAudio || null,
              sttEndpoint: this.sttEndpoint,
              sttLanguage: this.getEffectiveSTTLanguage(),
              inputLanguage: this.inputLanguage,
              onFallback: (r) => this.notifyEngineFallback(r),
            },
            controller.signal
          )
          const tPostFetch = Date.now()
          console.log(`[session] ⏱ Pipeline API returned: ${tPostFetch - tPreFetch}ms`)

          // Store transcript for history/logging
          session.dictationTranscript = pipelineResult.transcript
          if (pipelineResult.instructionTranscript) {
            session.instructionTranscript = pipelineResult.instructionTranscript
          }

          // Handle the output
          let output = pipelineResult.output

          // If pipeline returned empty/skipped and we have a transcript, use it as fallback
          if (pipelineResult.skippedLLM || (!output && pipelineResult.transcript)) {
            output = pipelineResult.transcript
            if (pipelineResult.skippedLLM && !pipelineResult.output) {
              // Junk transcript — skip output entirely
              console.log('[session] Pipeline: junk transcript, skipping output')
              session.status = 'done'
              session.output = null
              this.scheduleAutoHide(1500)

              // Still save session and cleanup
              clearTimeout(apiTimeout)
              this.abortController = null
              this.isProcessing = false
              this.resetChunkState()

              console.log('[session] 🔓 isProcessing = FALSE (pipeline junk)')
              try { this.onSessionComplete?.(session) } catch { /* ignore */ }
              this.currentSession = null
              this.onSessionEnded?.()
              return
            }
          }

          if (pipelineResult.usedFallback) {
            console.log(`[session] Pipeline used fallback (${pipelineResult.fallbackReason})`)
            session.errorMessage = 'formatting-fallback'
          }

          session.output = output
          session.status = 'done'

          const transformMs = Date.now() - pipelineStart
          const tResultProcessing = Date.now()
          console.log(`[session] ⏱ Result processing (transcript store + fallback check): ${tResultProcessing - tPostFetch}ms`)
          console.log(`[session] ⏱ Pipeline total so far: ${transformMs}ms`)
          console.log('[session] ✅ FINAL OUTPUT:', JSON.stringify(output))

          // Inject output (same logic as below)
          const tInjectStart = Date.now()
          if (this.outputMode === 'paste') {
            console.log('[session] Injecting output via paste...')
            await injectOutput(output)
          } else {
            console.log('[session] Copying output to clipboard...')
            copyToClipboard(output)
          }
          const tInjectEnd = Date.now()
          console.log(`[session] ⏱ Output injection (clipboard + paste): ${tInjectEnd - tInjectStart}ms`)

          // Show widget feedback
          if (session.errorMessage === 'formatting-fallback') {
            sendToWidget('output:fallback', output, session.sessionId, this.formattingNotice())
            this.scheduleAutoHide(4000)
          } else if (output) {
            sendToWidget('output:ready', output, session.sessionId)
            this.scheduleAutoHide(2500)
          } else {
            this.scheduleAutoHide(1500)
          }

          // Cleanup and return — skip the old sequential path entirely
          const tCleanupStart = Date.now()
          clearTimeout(apiTimeout)
          this.abortController = null
          this.isProcessing = false
          this.resetChunkState()
          const totalEnd = Date.now()
          console.log(`[session] ⏱ PIPELINE END-TO-END: ${totalEnd - pipelineStart}ms`)
          console.log(`[session]   ├─ Pre-fetch setup:    ${tPreFetch - pipelineStart}ms`)
          console.log(`[session]   ├─ API call:           ${tPostFetch - tPreFetch}ms`)
          console.log(`[session]   ├─ Result processing:  ${tResultProcessing - tPostFetch}ms`)
          console.log(`[session]   ├─ Output injection:   ${tInjectEnd - tInjectStart}ms`)
          console.log(`[session]   └─ Cleanup + widget:   ${totalEnd - tCleanupStart}ms`)
          console.log('[session] 🔓 isProcessing = FALSE (pipeline done)')
          try { this.onSessionComplete?.(session) } catch { /* ignore */ }
          this.currentSession = null
          this.onSessionEnded?.()
          return

        } catch (pipelineErr) {
          // Quota exceeded — do NOT fall through, show error immediately
          if (pipelineErr instanceof QuotaExceededError) {
            console.log('[session] 🚫 Quota exceeded:', pipelineErr.message)
            session.status = 'error'
            session.errorMessage = pipelineErr.message
            sendToWidget('output:error', "Today's limit reached. Resets at midnight.", session.sessionId)
            this.scheduleAutoHide(4000)
            clearTimeout(apiTimeout)
            this.abortController = null
            this.isProcessing = false
            this.resetChunkState()
            console.log('[session] 🔓 isProcessing = FALSE (quota exceeded)')
            this.currentSession = null
            this.onSessionEnded?.()
            return
          }

          // Pipeline failed — fall through to the old sequential path
          console.log('[session] ⚠️ Pipeline failed, falling back to sequential path:', pipelineErr instanceof Error ? pipelineErr.message : pipelineErr)
          broadcastError('pipeline', `Pipeline failed: ${pipelineErr instanceof Error ? pipelineErr.message : pipelineErr}`)

          // The old AbortController is already aborted (timeout fired).
          // Create a fresh one so the fallback path can actually make requests.
          clearTimeout(apiTimeout)
          controller = new AbortController()
          this.abortController = controller
          const fallbackTimeoutMs = Math.max(timeoutMs, 10_000) // At least 10s for fallback (STT + LLM separately)
          apiTimeout = setTimeout(() => {
            console.log(`[session] Fallback timeout (${fallbackTimeoutMs}ms) — aborting`)
            controller.abort()
          }, fallbackTimeoutMs)
          console.log(`[session] 🔄 Fresh AbortController for fallback (timeout: ${fallbackTimeoutMs}ms)`)
          // Don't return — let the old code handle it as a graceful fallback
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // SEQUENTIAL PATH: Separate STT then LLM (original behavior)
      // Used when: pipeline disabled, local STT, local LLM, chunked, or pipeline failed
      // ═══════════════════════════════════════════════════════════════

      // Transcribe audio(s) — cloud (groq/cartesia/sarvam), local whisper.cpp, or faster-whisper
      const effectiveSTT = this.getEffectiveSTTProvider()
      const useLocalWhisper = features.localModels && effectiveSTT === 'local' && whisperManager.isModelReady() && whisperManager.isBinaryReady()
      const useFasterWhisper = features.localModels && effectiveSTT === 'faster-whisper' && fasterWhisperManager.isReady()
      const useCartesia = effectiveSTT === 'cartesia'
      const useSarvam = effectiveSTT === 'sarvam'
      console.log('[session] STT provider:', this.sttProvider, '(effective:', effectiveSTT, ') | Using local whisper:', useLocalWhisper, '| Using faster-whisper:', useFasterWhisper, '| Using cartesia:', useCartesia, '| Using sarvam:', useSarvam)

      let transcribeMs = 0

      if (this.isChunkedSession && session.dictationAudio) {
        // ─── CHUNKED TRANSCRIPTION PATH ───
        // Chunks were already sent for transcription in parallel. Wait for all to complete.
        console.log('[session] 🧩 CHUNKED TRANSCRIPTION MODE — waiting for parallel chunk transcriptions...')

        // Wait for totalChunksExpected to be set (final chunk IPC may be slightly delayed)
        for (let i = 0; i < 20; i++) {
          if (this.totalChunksExpected !== null) break
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        if (this.totalChunksExpected === null) {
          console.warn('[session] ⚠️ totalChunksExpected never set — using chunkTracker size:', this.chunkTracker.size)
          this.totalChunksExpected = this.chunkTracker.size
        }

        console.log(`[session] Expecting ${this.totalChunksExpected} chunks, have ${this.chunkTracker.size} in tracker`)

        // Wait for all transcription promises to settle
        const t0 = Date.now()
        const promises: Promise<string>[] = []
        for (const [idx, chunk] of this.chunkTracker) {
          if (chunk.transcriptionPromise) {
            promises.push(chunk.transcriptionPromise)
          }
        }
        await Promise.all(promises)
        transcribeMs = Date.now() - t0

        // Assemble ordered transcripts
        const orderedTranscripts: string[] = []
        for (let i = 0; i < this.totalChunksExpected; i++) {
          const chunk = this.chunkTracker.get(i)
          if (chunk?.transcript) {
            orderedTranscripts.push(chunk.transcript)
          }
        }

        // Log chunk summary table
        console.log('[session] ┌─── CHUNK SUMMARY ───')
        for (let i = 0; i < this.totalChunksExpected; i++) {
          const chunk = this.chunkTracker.get(i)
          if (chunk) {
            const elapsed = chunk.completedAt ? chunk.completedAt - chunk.startedAt : '?'
            const preview = chunk.transcript ? (chunk.transcript.length > 60 ? chunk.transcript.substring(0, 60) + '...' : chunk.transcript) : '(empty)'
            console.log(`[session] │ Chunk ${i}: ${chunk.buffer.byteLength} bytes | ${elapsed}ms | ${chunk.error ? '❌ ' + chunk.error : '✅'} | "${preview}"`)
          } else {
            console.log(`[session] │ Chunk ${i}: MISSING`)
          }
        }
        console.log(`[session] └─── Total transcribe wait: ${transcribeMs}ms for ${this.totalChunksExpected} chunks ───`)

        // Deterministic stitching in code — chunks are cut at silence, so a plain
        // ordered join produces clean continuous text. No markers, no LLM merge.
        session.dictationTranscript = stitchChunks(orderedTranscripts)
        console.log(`[session] 🧩 Stitched ${orderedTranscripts.length} chunk(s) in code (no LLM)`)

        console.log('[session] Dictation transcript (chunked):', JSON.stringify(session.dictationTranscript))

      } else if (session.dictationAudio) {
        // ─── SINGLE BUFFER TRANSCRIPTION PATH (original) ───
        console.log('[session] Transcribing DICTATION audio (single buffer)...')
        const t0 = Date.now()
        if (useFasterWhisper) {
          session.dictationTranscript = await fasterWhisperManager.transcribe(session.dictationAudio)
        } else if (useLocalWhisper) {
          session.dictationTranscript = await whisperManager.transcribe(session.dictationAudio)
        } else {
          const cloudProvider = useSarvam ? 'sarvam' as const : useCartesia ? 'cartesia' as const : 'groq' as const
          session.dictationTranscript = await pipelineTranscribe(session.dictationAudio, this.authToken, {
            sttProvider: cloudProvider,
            sttEndpoint: this.sttEndpoint,
            sttLanguage: this.getEffectiveSTTLanguage(),
            onFallback: (r) => this.notifyEngineFallback(r),
          }, controller.signal)
        }
        transcribeMs += Date.now() - t0
        const sttLabel = useSarvam ? 'sarvam' : useCartesia ? 'cartesia' : useFasterWhisper ? 'faster-whisper' : useLocalWhisper ? 'local' : 'cloud'
        console.log(`[session] ⏱ Dictation transcribe: ${Date.now() - t0}ms (${sttLabel})`)
        console.log('[session] Dictation transcript:', JSON.stringify(session.dictationTranscript))
      } else {
        console.log('[session] No dictation audio to transcribe')
      }

      if (session.instructionAudio) {
        console.log('[session] Transcribing INSTRUCTION audio...')
        const t0 = Date.now()
        if (useFasterWhisper) {
          session.instructionTranscript = await fasterWhisperManager.transcribe(session.instructionAudio)
        } else if (useLocalWhisper) {
          session.instructionTranscript = await whisperManager.transcribe(session.instructionAudio)
        } else {
          const cloudProvider = useSarvam ? 'sarvam' as const : useCartesia ? 'cartesia' as const : 'groq' as const
          session.instructionTranscript = await pipelineTranscribe(session.instructionAudio, this.authToken, {
            sttProvider: cloudProvider,
            sttEndpoint: this.sttEndpoint,
            sttLanguage: this.getEffectiveSTTLanguage(),
          }, controller.signal)
        }
        transcribeMs += Date.now() - t0
        const sttLabel2 = useSarvam ? 'sarvam' : useCartesia ? 'cartesia' : useFasterWhisper ? 'faster-whisper' : useLocalWhisper ? 'local' : 'cloud'
        console.log(`[session] ⏱ Instruction transcribe: ${Date.now() - t0}ms (${sttLabel2})`)
        console.log('[session] Instruction transcript:', JSON.stringify(session.instructionTranscript))
      } else {
        console.log('[session] No instruction audio to transcribe')
      }

      // Guard: if all transcripts are empty/junk (e.g. just punctuation from silence),
      // skip the LLM call and treat as no-op to avoid pasting garbage
      const dictationText = (session.dictationTranscript || '').trim()
      const instructionText = (session.instructionTranscript || '').trim()
      const junkMaxLen = config.junk_detection.max_length
      const junkPattern = new RegExp(config.junk_detection.pattern)
      const isJunkTranscript = (text: string) => text.length <= junkMaxLen && junkPattern.test(text)

      if (isJunkTranscript(dictationText) && isJunkTranscript(instructionText)) {
        console.log('[session] ⚠️ Empty/junk transcript detected, skipping output. Dictation:', JSON.stringify(dictationText), 'Instruction:', JSON.stringify(instructionText))
        session.status = 'done'
        session.output = null
        this.scheduleAutoHide(1500)
      } else {
        let output: string
        const transformStart = Date.now()
        console.log('[session] Running flow:', session.flowType)

        switch (session.flowType) {
          case 'quote':
            output = `> ${session.selectedText}\n\n${session.dictationTranscript || ''}`
            console.log('[session] Quote flow output (no LLM):', JSON.stringify(output))
            break

          case 'dictation':
            // Raw-by-default: dictation is never sent to the LLM. The transcript
            // is cleaned deterministically in code. Formatting is on-demand only
            // (via a Control instruction → transform/instruction flows).
            console.log('[session] Dictation flow — raw transcript (no LLM)')
            output = cleanTranscript(session.dictationTranscript || '')
            break

          case 'context':
            console.log('[session] Context flow — sending to LLM (provider:', this.llmProvider, ', backend:', this.backendProvider, ')')
            try {
              if (this.llmProvider === 'local-llm') {
                const localOutput = await localTransformText(
                  null,
                  session.selectedText,
                  session.instructionTranscript,
                  'context',
                  false,
                  controller.signal
                )
                output = localOutput
                // Client-side fallback for local LLM only
                if ((!output || output.trim() === '') && session.instructionTranscript) {
                  console.log('[session] ⚠️ Local LLM returned empty for context flow — using raw instruction transcript')
                  output = session.instructionTranscript
                  session.errorMessage = 'formatting-fallback'
                } else if (isLLMRefusal(output) && session.instructionTranscript) {
                  console.log('[session] ⚠️ Local LLM refused context flow — using raw instruction transcript')
                  output = session.instructionTranscript
                }
              } else {
                const result = await pipelineTransform(
                  session.instructionTranscript || '',
                  this.authToken,
                  'context',
                  { context: session.selectedText, instruction: session.instructionTranscript },
                  controller.signal
                )
                output = result.output
                if (result.usedFallback) {
                  console.log(`[session] Server used fallback (${result.fallbackReason}) for context flow`)
                  session.errorMessage = 'formatting-fallback'
                }
              }
            } catch (transformErr) {
              console.log('[session] ⚠️ Context transform failed, falling back to raw transcript:', transformErr instanceof Error ? transformErr.message : transformErr)
              output = session.instructionTranscript || ''
              if (output) session.errorMessage = 'formatting-fallback'
            }
            break

          case 'transform':
            console.log('[session] Transform flow — sending to LLM (provider:', this.llmProvider, ', backend:', this.backendProvider, ')')
            try {
              if (this.llmProvider === 'local-llm') {
                const localOutput = await localTransformText(
                  session.dictationTranscript,
                  session.selectedTextRole === 'context' ? session.selectedText : null,
                  session.instructionTranscript,
                  'transform',
                  false,
                  controller.signal
                )
                output = localOutput
                // Client-side fallback for local LLM only
                if ((!output || output.trim() === '') && session.dictationTranscript) {
                  console.log('[session] ⚠️ Local LLM returned empty for transform flow — using raw dictation transcript')
                  output = session.dictationTranscript
                  session.errorMessage = 'formatting-fallback'
                } else if (isLLMRefusal(output) && session.dictationTranscript) {
                  console.log('[session] ⚠️ Local LLM refused transform flow — using raw dictation transcript')
                  output = session.dictationTranscript
                }
              } else {
                const result = await pipelineTransform(
                  session.dictationTranscript || '',
                  this.authToken,
                  'transform',
                  {
                    context: session.selectedTextRole === 'context' ? session.selectedText : null,
                    instruction: session.instructionTranscript,
                  },
                  controller.signal
                )
                output = result.output
                if (result.usedFallback) {
                  console.log(`[session] Server used fallback (${result.fallbackReason}) for transform flow`)
                  session.errorMessage = 'formatting-fallback'
                }
              }
            } catch (transformErr) {
              console.log('[session] ⚠️ Transform flow failed, falling back to raw transcript:', transformErr instanceof Error ? transformErr.message : transformErr)
              output = session.dictationTranscript || ''
              if (output) session.errorMessage = 'formatting-fallback'
            }
            break

          case 'instruction':
            console.log('[session] Instruction-only flow — sending to LLM (provider:', this.llmProvider, ', backend:', this.backendProvider, ')')
            try {
              if (this.llmProvider === 'local-llm') {
                const localOutput = await localTransformText(
                  null,
                  null,
                  session.instructionTranscript,
                  'instruction',
                  false,
                  controller.signal
                )
                output = localOutput
                if ((!output || output.trim() === '') && session.instructionTranscript) {
                  console.log('[session] ⚠️ Local LLM returned empty for instruction flow — using raw instruction transcript')
                  output = session.instructionTranscript
                  session.errorMessage = 'formatting-fallback'
                } else if (isLLMRefusal(output) && session.instructionTranscript) {
                  console.log('[session] ⚠️ Local LLM refused instruction flow — using raw instruction transcript')
                  output = session.instructionTranscript
                }
              } else {
                // Send instruction transcript as the main transcript (pipeline expects non-empty transcript)
                const result = await pipelineTransform(
                  session.instructionTranscript || '',
                  this.authToken,
                  'instruction',
                  {},
                  controller.signal
                )
                output = result.output
                if (result.usedFallback) {
                  console.log(`[session] Server used fallback (${result.fallbackReason}) for instruction flow`)
                  session.errorMessage = 'formatting-fallback'
                }
              }
            } catch (transformErr) {
              console.log('[session] ⚠️ Instruction flow failed:', transformErr instanceof Error ? transformErr.message : transformErr)
              output = session.instructionTranscript || ''
              if (output) session.errorMessage = 'formatting-fallback'
            }
            break

          default:
            output = session.dictationTranscript || ''
            console.log('[session] Default flow, using raw transcript')
        }

        const transformMs = Date.now() - transformStart
        session.output = output
        session.status = 'done'

        console.log(`[session] ⏱ Transform: ${transformMs}ms | Transcribe: ${transcribeMs}ms | Pipeline: ${Date.now() - pipelineStart}ms`)
        console.log('[session] ✅ FINAL OUTPUT:', JSON.stringify(output))

        if (this.outputMode === 'paste') {
          console.log('[session] Injecting output via paste...')
          await injectOutput(output)
        } else {
          console.log('[session] Copying output to clipboard...')
          copyToClipboard(output)
        }

        if (session.errorMessage === 'formatting-fallback') {
          sendToWidget('output:fallback', output, session.sessionId, this.formattingNotice())
        } else {
          sendToWidget('output:ready', output, session.sessionId)
        }

        // Auto-hide HUD after showing output (cancellable if new session starts)
        // Give more time for fallback warning so user can read it
        this.scheduleAutoHide(session.errorMessage === 'formatting-fallback' ? 4000 : 2500)
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Processing failed'
      console.error('[session] ❌ ERROR:', errorMessage)
      if (err instanceof Error && err.stack) {
        console.error('[session] Stack:', err.stack)
      }

      session.status = 'error'
      session.errorMessage = errorMessage

      broadcastError('session', errorMessage)
      sendToWidget('output:error', simplifyError(errorMessage), session.sessionId)
      this.scheduleAutoHide(3500)
    } finally {
      // Always clean up processing state
      clearTimeout(apiTimeout)
      this.isProcessing = false
      this.abortController = null
      this.resetChunkState()
      console.log('[session] 🔓 isProcessing = FALSE')
    }

    // Save session and reset
    console.log('[session] Saving session to DB...')
    console.log('[session]   ID:', session.sessionId)
    console.log('[session]   Flow:', session.flowType)
    console.log('[session]   Status:', session.status)
    console.log('[session]   Output:', session.output ? JSON.stringify(session.output.substring(0, 100)) : 'null')
    console.log('[session]   Error:', session.errorMessage)

    if (this.onSessionComplete) {
      this.onSessionComplete(session)
    }

    this.currentSession = null
    this.onSessionEnded?.()
    console.log('═══════════════════════════════════════════')
  }

  /** Process the current session and immediately start a new one.
   *  Used for same-mode restart (e.g. dictation → dictation during chain window).
   *  This is atomic — no window for race conditions between process and start. */
  async processAndStartNew(mode: 'dictation' | 'instruction'): Promise<void> {
    if (this.isProcessing) {
      console.log('[session] ⛔ BLOCKED processAndStartNew — already processing')
      sendToWidget('processing:show-discard-hint')
      this.onSessionRejected?.()
      return
    }

    console.log('[session] RESTART — processing old session then starting new, mode:', mode)

    // Process the current session (this will clear currentSession at the end)
    await this.processSession()

    // Now start a fresh session
    this.startSession(mode)
  }

  /** Discard current session immediately (recording was too short, no audio to process).
   *  Shows brief "too short" feedback on HUD then cleans up. */
  discardSession(sessionId?: string): void {
    if (!this.currentSession) return
    if (sessionId && sessionId !== this.currentSession.sessionId) {
      console.warn(`[session] ⏭️ Ignoring stale discard for ended session ${sessionId} (current: ${this.currentSession.sessionId})`)
      return
    }

    console.log('[session] Session DISCARDED (too short):', this.currentSession.sessionId)

    this.currentSession = null
    this.resetChunkState()
    setTrayIdle()

    // Show brief feedback then hide (cancellable if new session starts)
    sendToWidget('session:too-short')
    this.scheduleAutoHide(1500)

    this.onRecordingStopped?.()
    this.onSessionEnded?.()
  }

  /** Recording blocked because daily quota is exhausted. Show error in HUD. */
  quotaBlocked(): void {
    console.log('[session] 🚫 Recording blocked — daily quota exhausted')
    this.currentSession = null
    this.resetChunkState()
    setTrayIdle()
    sendToWidget('output:error', "Daily limit reached. Resets at midnight.")
    this.scheduleAutoHide(4000)
    this.onRecordingStopped?.()
    this.onSessionEnded?.()
  }

  /** Cancel session — simple cancel without undo (used by widget cancel button) */
  cancelSession(): void {
    console.log('[session] Session CANCELLED:', this.currentSession?.sessionId, '| wasProcessing:', this.isProcessing)
    this.abortController?.abort()
    this.isProcessing = false
    this.abortController = null
    this.expectingInstructionAudio = false
    this.resetChunkState()
    console.log('[session] 🔓 isProcessing = FALSE (cancelled)')
    this.currentSession = null
    setTrayIdle()
    this.onRecordingStopped?.()
    this.onSessionEnded?.()
    hideHUD()
  }

  /** Cancel session with 3-second undo window (triggered by Escape key) */
  cancelSessionWithUndo(): void {
    if (!this.currentSession) return

    console.log('[session] Session CANCELLED with undo window:', this.currentSession.sessionId)

    // Abort any in-flight API calls
    this.abortController?.abort()
    this.isProcessing = false
    this.abortController = null
    this.expectingInstructionAudio = false
    this.resetChunkState()

    // Stop recording in the widget
    sendToWidget('recording:stop')

    // Save session state for potential undo
    this.cancelledSession = this.currentSession
    this.currentSession = null

    // Notify main to unregister Escape
    this.onRecordingStopped?.()
    // Reset keyboard state — recording ended externally, not via normal Fn toggle
    this.onSessionEnded?.()

    // Tell widget to show cancelled state with undo button
    sendToWidget('session:cancelled')
    setTrayIdle()

    // 3 second undo window
    this.undoTimer = setTimeout(() => {
      console.log('[session] Undo window expired')
      this.cancelledSession = null
      this.undoTimer = null
      hideHUD()
    }, 3000)
  }

  /** Undo a cancelled session — process the already-captured audio */
  undoCancel(): void {
    if (!this.cancelledSession) {
      console.log('[session] undoCancel called but no cancelled session')
      return
    }

    console.log('[session] UNDO cancel, processing captured audio for session:', this.cancelledSession.sessionId)

    // Clear undo timer
    if (this.undoTimer) {
      clearTimeout(this.undoTimer)
      this.undoTimer = null
    }

    // Restore session as current and process it
    this.currentSession = this.cancelledSession
    this.cancelledSession = null

    // Ensure HUD stays visible during processing
    showHUD()

    // Process the already-captured audio (don't resume recording)
    this.processSession()
  }

  getCurrentSession(): SessionState | null {
    return this.currentSession
  }

  private clearUndoState(): void {
    if (this.undoTimer) {
      clearTimeout(this.undoTimer)
      this.undoTimer = null
    }
    this.cancelledSession = null
  }

  /** Schedule a delayed hideHUD. Cancels any previous auto-hide timer
   *  so old timers don't kill new sessions' HUDs. */
  private scheduleAutoHide(delayMs: number): void {
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer)
    }
    this.autoHideTimer = setTimeout(() => {
      this.autoHideTimer = null
      setTrayIdle()
      hideHUD()
    }, delayMs)
  }

  /** Cancel any pending auto-hide timer (called when a new session starts). */
  private cancelAutoHide(): void {
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer)
      this.autoHideTimer = null
    }
  }

  private async captureSelection(mode: 'dictation' | 'instruction'): Promise<void> {
    console.log('[session] Attempting to capture selected text, mode:', mode)
    try {
      const useClipboardFallback = mode === 'instruction'
      const selectedText = await captureSelectedText(useClipboardFallback)
      if (selectedText && this.currentSession) {
        this.currentSession.selectedText = selectedText
        this.currentSession.selectedTextRole = mode === 'dictation' ? 'quote' : 'context'
        console.log('[session] Captured selected text:', JSON.stringify(selectedText.substring(0, 80)))
        console.log('[session] Selected text role:', this.currentSession.selectedTextRole)
      } else {
        console.log('[session] No text was selected (and no clipboard fallback)')
      }
    } catch (err) {
      console.warn('[session] Failed to capture selected text:', err instanceof Error ? err.message : err)
    }
  }

  private determineFlowType(session: SessionState): FlowType {
    const hasDictation = !!session.dictationAudio
    const hasInstruction = !!session.instructionAudio
    const hasSelection = !!session.selectedText

    console.log('[session] Determining flow type:')
    console.log('[session]   hasDictation:', hasDictation)
    console.log('[session]   hasInstruction:', hasInstruction)
    console.log('[session]   hasSelection:', hasSelection)
    console.log('[session]   selectedTextRole:', session.selectedTextRole)

    if (hasSelection && session.selectedTextRole === 'quote' && hasDictation && !hasInstruction) {
      return 'quote'
    }
    if (hasSelection && session.selectedTextRole === 'context' && hasInstruction && !hasDictation) {
      return 'context'
    }
    if (hasDictation && !hasInstruction && !hasSelection) {
      return 'dictation'
    }
    if (hasInstruction && !hasDictation && !hasSelection) {
      return 'instruction'
    }
    return 'transform'
  }
}

export const sessionManager = new SessionManager()
