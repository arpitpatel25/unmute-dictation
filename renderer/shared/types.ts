export interface ServerConfig {
  version: number
  transform: {
    timeout_ms: number
  }
  transcribe: {
    provider: string
  }
  chunking: {
    enabled: boolean
    min_duration_ms: number
    silence_threshold_rms: number
    silence_duration_ms: number
    hard_cap_ms: number
    vad_poll_interval_ms: number
  }
  junk_detection: {
    max_length: number
    pattern: string
  }
  devFeatures?: {
    localModels: boolean
  }
}

/** Estimated cost plus the raw units behind it, for one time window. */
export interface UsageWindow {
  /** Estimated USD spent in this window. */
  cost: number
  inputTokens: number
  outputTokens: number
  /** Seconds of audio transcribed. */
  sttSeconds: number
}

export interface UsageSummary {
  today: UsageWindow
  month: UsageWindow
  allTime: UsageWindow
}

export interface ElectronAPI {
  onRecordingStart: (callback: (mode: 'dictation' | 'instruction', sessionId?: string) => void) => void
  onRecordingStop: (callback: () => void) => void
  sendAudioReady: (buffer: ArrayBuffer, duration: number, mode: 'dictation' | 'instruction', sessionId?: string) => void
  sendAudioChunk: (buffer: ArrayBuffer, chunkIndex: number, mode: 'dictation' | 'instruction', sessionId?: string) => void
  sendAudioFinalChunk: (buffer: ArrayBuffer, chunkIndex: number, totalChunks: number, duration: number, mode: 'dictation' | 'instruction', sessionId?: string) => void
  onOutputReady: (callback: (text: string, sessionId: string) => void) => void
  onOutputFallback: (callback: (text: string, sessionId: string, message?: string) => void) => void
  onOutputError: (callback: (error: string, sessionId: string) => void) => void
  getSessions: () => Promise<Session[]>
  retrySession: (sessionId: string) => void
  onRetryStatus: (callback: (sessionId: string, status: 'processing' | 'done' | 'error', data?: Partial<Session>) => void) => void
  cancelSession: () => void
  undoCancel: () => void
  onSessionCancelled: (callback: () => void) => void
  onProcessingDiscardHint: (callback: () => void) => void
  onSessionTooShort: (callback: () => void) => void
  onEngineNotice: (callback: (reason: string) => void) => void
  sendAudioDiscarded: (mode: 'dictation' | 'instruction', sessionId?: string) => void
  sendQuotaBlocked: () => void
  getUsage: () => Promise<UsageSummary>
  resetUsage: () => Promise<UsageSummary>
  getGroqKeyStatus: () => Promise<{ hasKey: boolean; masked: string | null }>
  setGroqKey: (key: string) => Promise<{ success: boolean; masked?: string | null; error?: string }>
  testGroqKey: (key: string) => Promise<{ ok: boolean; error?: string }>
  clearGroqKey: () => void
  sendAuthToken: (token: string) => void
  openExternal: (url: string) => void
  onAuthCallback: (callback: (url: string) => void) => void
  // Permissions (macOS)
  getMicPermissionStatus: () => Promise<string>
  requestMicPermission: () => Promise<boolean>
  openMicSettings: () => void
  openAccessibilitySettings: () => void
  openKeyboardSettings: () => void
  // Auto-update
  onUpdateDownloaded: (callback: (version: string) => void) => void
  restartToUpdate: () => void
  // Widget mount signal
  widgetReady: () => void
  getAccessibilityStatus: () => Promise<boolean>
  requestAccessibility: () => Promise<boolean>
  setLLMProvider: (provider: 'cloud' | 'local-llm') => void
  getLLMProvider: () => Promise<string>
  setSTTProvider: (provider: 'cloud' | 'local' | 'faster-whisper' | 'cartesia' | 'sarvam' | 'dual-whisper') => void
  getSTTProvider: () => Promise<string>
  // STT Endpoint & Language (dev-only)
  setSTTEndpoint: (endpoint: 'transcriptions' | 'translations') => void
  getSTTEndpoint: () => Promise<string>
  setSTTLanguage: (language: 'auto' | 'en' | 'hi' | 'gu' | 'ar') => void
  getSTTLanguage: () => Promise<string>
  // Backend is always Cloudflare — no toggle needed
  getWhisperModelStatus: () => Promise<boolean>
  getWhisperBinaryStatus: () => Promise<boolean>
  downloadWhisperModel: () => Promise<{ success: boolean; error?: string }>
  onWhisperDownloadProgress: (callback: (progress: number) => void) => void
  getFasterWhisperStatus: () => Promise<boolean>
  setupFasterWhisper: () => Promise<{ success: boolean; error?: string }>
  // Local LLM
  getLocalLLMModelStatus: () => Promise<boolean>
  getLocalLLMBinaryStatus: () => Promise<boolean>
  getLocalLLMServerStatus: () => Promise<boolean>
  downloadLocalLLMModel: () => Promise<{ success: boolean; error?: string }>
  onLocalLLMDownloadProgress: (callback: (progress: number) => void) => void
  // Settings
  setWidgetPosition: (position: 'center' | 'right') => void
  getWidgetPosition: () => Promise<string>
  setSoundFeedback: (enabled: boolean) => void
  getSoundFeedback: () => Promise<boolean>
  // Chunked transcription setting
  setChunkedTranscription: (enabled: boolean) => void
  getChunkedTranscription: () => Promise<boolean>
  // Chunk min duration override (dev-only, in ms; 0 = use server default)
  setChunkMinDuration: (ms: number) => void
  getChunkMinDuration: () => Promise<number>
  // Input language (user-facing: English / Hinglish)
  setInputLanguage: (language: 'en' | 'hinglish') => void
  getInputLanguage: () => Promise<string>
  // Dictation key + activation mode
  setDictationKey: (key: 'fn' | 'right-option') => void
  getDictationKey: () => Promise<string>
  setActivationMode: (mode: 'tap-toggle' | 'push-to-talk' | 'double-tap-push') => void
  getActivationMode: () => Promise<string>
  // Server config
  getServerConfig: () => Promise<ServerConfig>
  // Feature flags
  getLocalModelsEnabled: () => Promise<boolean>
  removeAllListeners: (channel: string) => void
}

export interface Session {
  id: string
  createdAt: number
  flowType: 'dictation' | 'transform' | 'quote' | 'context'
  dictationTranscript: string | null
  instructionTranscript: string | null
  selectedText: string | null
  selectedTextRole: 'quote' | 'context' | null
  output: string | null
  audioFilePath: string | null
  status: 'done' | 'error'
  errorMessage: string | null
}

export type WidgetState =
  | 'hidden'
  | 'dictation-active'
  | 'instruction-active'
  | 'chained'
  | 'processing'
  | 'output'
  | 'output-fallback'
  | 'error'
  | 'cancelled'
  | 'too-short'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
