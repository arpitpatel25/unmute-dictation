import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  // Recording control
  onRecordingStart: (callback: (mode: 'dictation' | 'instruction') => void) => {
    ipcRenderer.on('recording:start', (_event, mode) => callback(mode))
  },
  onRecordingStop: (callback: () => void) => {
    ipcRenderer.on('recording:stop', () => callback())
  },
  sendAudioReady: (buffer: ArrayBuffer, duration: number, mode: 'dictation' | 'instruction') => {
    ipcRenderer.send('audio:ready', buffer, duration, mode)
  },
  sendAudioChunk: (buffer: ArrayBuffer, chunkIndex: number, mode: 'dictation' | 'instruction') => {
    ipcRenderer.send('audio:chunk', buffer, chunkIndex, mode)
  },
  sendAudioFinalChunk: (buffer: ArrayBuffer, chunkIndex: number, totalChunks: number, duration: number, mode: 'dictation' | 'instruction') => {
    ipcRenderer.send('audio:final-chunk', buffer, chunkIndex, totalChunks, duration, mode)
  },

  // Output
  onOutputReady: (callback: (text: string, sessionId: string) => void) => {
    ipcRenderer.on('output:ready', (_event, text, sessionId) => callback(text, sessionId))
  },
  onOutputFallback: (callback: (text: string, sessionId: string) => void) => {
    ipcRenderer.on('output:fallback', (_event, text, sessionId) => callback(text, sessionId))
  },
  onOutputError: (callback: (error: string, sessionId: string) => void) => {
    ipcRenderer.on('output:error', (_event, error, sessionId) => callback(error, sessionId))
  },

  // Sessions
  getSessions: (): Promise<unknown[]> => ipcRenderer.invoke('session:list'),
  retrySession: (sessionId: string) => {
    ipcRenderer.send('session:retry', sessionId)
  },
  onRetryStatus: (callback: (sessionId: string, status: 'processing' | 'done' | 'error', data?: Record<string, unknown>) => void) => {
    ipcRenderer.on('session:retry-status', (_event, sessionId, status, data) => callback(sessionId, status, data))
  },

  // Widget
  cancelSession: () => {
    ipcRenderer.send('widget:cancel')
  },
  undoCancel: () => {
    ipcRenderer.send('widget:undo-cancel')
  },
  onSessionCancelled: (callback: () => void) => {
    ipcRenderer.on('session:cancelled', () => callback())
  },
  onProcessingDiscardHint: (callback: () => void) => {
    ipcRenderer.on('processing:show-discard-hint', () => callback())
  },
  onSessionTooShort: (callback: () => void) => {
    ipcRenderer.on('session:too-short', () => callback())
  },
  sendAudioDiscarded: (mode: 'dictation' | 'instruction') => {
    ipcRenderer.send('audio:discarded', mode)
  },
  sendQuotaBlocked: () => {
    ipcRenderer.send('quota:blocked')
  },

  // Groq API key (BYO-key)
  getGroqKeyStatus: (): Promise<{ hasKey: boolean; masked: string | null }> => ipcRenderer.invoke('groq-key:status'),
  setGroqKey: (key: string): Promise<{ success: boolean; masked?: string | null; error?: string }> => ipcRenderer.invoke('groq-key:set', key),
  testGroqKey: (key: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('groq-key:test', key),
  clearGroqKey: () => {
    ipcRenderer.send('groq-key:clear')
  },

  // Auth
  sendAuthToken: (token: string) => {
    ipcRenderer.send('auth:token', token)
  },
  openExternal: (url: string) => {
    ipcRenderer.send('open-external', url)
  },
  onAuthCallback: (callback: (url: string) => void) => {
    ipcRenderer.on('auth:callback', (_event, url) => callback(url))
  },

  // Settings
  setLLMProvider: (provider: 'cloud' | 'local-llm') => {
    ipcRenderer.send('settings:llm-provider', provider)
  },
  getLLMProvider: (): Promise<string> => ipcRenderer.invoke('settings:get-llm-provider'),

  // STT Settings
  setSTTProvider: (provider: 'cloud' | 'local' | 'faster-whisper' | 'cartesia' | 'dual-whisper') => {
    ipcRenderer.send('settings:stt-provider', provider)
  },
  getSTTProvider: (): Promise<string> => ipcRenderer.invoke('settings:get-stt-provider'),

  // STT Endpoint & Language (dev-only)
  setSTTEndpoint: (endpoint: string) => {
    ipcRenderer.send('settings:stt-endpoint', endpoint)
  },
  getSTTEndpoint: (): Promise<string> => ipcRenderer.invoke('settings:get-stt-endpoint'),
  setSTTLanguage: (language: string) => {
    ipcRenderer.send('settings:stt-language', language)
  },
  getSTTLanguage: (): Promise<string> => ipcRenderer.invoke('settings:get-stt-language'),

  // Backend is always Cloudflare — no toggle needed

  // Whisper model management
  getWhisperModelStatus: (): Promise<boolean> => ipcRenderer.invoke('whisper:model-status'),
  getWhisperBinaryStatus: (): Promise<boolean> => ipcRenderer.invoke('whisper:binary-status'),
  downloadWhisperModel: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('whisper:download-model'),
  onWhisperDownloadProgress: (callback: (progress: number) => void) => {
    ipcRenderer.on('whisper:download-progress', (_event, progress) => callback(progress))
  },

  // Faster-whisper management
  getFasterWhisperStatus: (): Promise<boolean> => ipcRenderer.invoke('faster-whisper:status'),
  setupFasterWhisper: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('faster-whisper:setup'),

  // Local LLM management
  getLocalLLMModelStatus: (): Promise<boolean> => ipcRenderer.invoke('local-llm:model-status'),
  getLocalLLMBinaryStatus: (): Promise<boolean> => ipcRenderer.invoke('local-llm:binary-status'),
  getLocalLLMServerStatus: (): Promise<boolean> => ipcRenderer.invoke('local-llm:server-status'),
  downloadLocalLLMModel: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('local-llm:download-model'),
  onLocalLLMDownloadProgress: (callback: (progress: number) => void) => {
    ipcRenderer.on('local-llm:download-progress', (_event, progress) => callback(progress))
  },

  // Widget position
  setWidgetPosition: (position: 'center' | 'right') => {
    ipcRenderer.send('settings:widget-position', position)
  },
  getWidgetPosition: (): Promise<string> => ipcRenderer.invoke('settings:get-widget-position'),

  // Sound feedback
  setSoundFeedback: (enabled: boolean) => {
    ipcRenderer.send('settings:sound-feedback', enabled)
  },
  getSoundFeedback: (): Promise<boolean> => ipcRenderer.invoke('settings:get-sound-feedback'),

  // Chunked transcription setting
  setChunkedTranscription: (enabled: boolean) => {
    ipcRenderer.send('settings:chunked-transcription', enabled)
  },
  getChunkedTranscription: (): Promise<boolean> => ipcRenderer.invoke('settings:get-chunked-transcription'),

  // Chunk min duration override (dev-only, in ms; 0 = use server default)
  setChunkMinDuration: (ms: number) => {
    ipcRenderer.send('settings:chunk-min-duration', ms)
  },
  getChunkMinDuration: (): Promise<number> => ipcRenderer.invoke('settings:get-chunk-min-duration'),

  // Input language (user-facing: English / Hinglish)
  setInputLanguage: (language: 'en' | 'hinglish') => {
    ipcRenderer.send('settings:input-language', language)
  },
  getInputLanguage: (): Promise<string> => ipcRenderer.invoke('settings:get-input-language'),

  // Dictation key + activation mode
  setDictationKey: (key: 'fn' | 'right-option') => {
    ipcRenderer.send('settings:dictation-key', key)
  },
  getDictationKey: (): Promise<string> => ipcRenderer.invoke('settings:get-dictation-key'),
  setActivationMode: (mode: 'tap-toggle' | 'push-to-talk' | 'double-tap-push') => {
    ipcRenderer.send('settings:activation-mode', mode)
  },
  getActivationMode: (): Promise<string> => ipcRenderer.invoke('settings:get-activation-mode'),

  // Server config
  getServerConfig: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('config:get'),

  // Quota
  getQuota: (): Promise<Record<string, unknown> | null> => ipcRenderer.invoke('quota:get'),
  onQuotaUpdated: (callback: (quota: Record<string, unknown>) => void) => {
    ipcRenderer.on('quota:updated', (_event, quota) => callback(quota))
  },

  // Feature flags
  getLocalModelsEnabled: (): Promise<boolean> => ipcRenderer.invoke('config:local-models-enabled'),

  // Cleanup
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
