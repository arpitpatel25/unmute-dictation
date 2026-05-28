// Prevent EPIPE crashes when writing to broken pipes
process.stdout?.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return
})
process.stderr?.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') return
})

import { app, BrowserWindow, ipcMain, globalShortcut, shell } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { keyboardManager, KeyboardEvent } from './keyboard'
import { sessionManager, cleanTranscript } from './sessionManager'
import { whisperManager } from './whisper'
import { fasterWhisperManager } from './fasterWhisper'
import { localLLMManager } from './localLLM'
import { initDB, saveSession, getSessions, getSession, updateSessionResult, clearAllSessions, closeDB } from './db'
import { getAudioFilePath, loadAudioFile, clearAllAudioFiles } from './audio'
import { pipelineTranscribe, fetchServerConfig, isConfigStale, getCachedConfig, type QuotaInfo } from './api'
import { createTray } from './tray'
import { features, updateFeaturesFromConfig } from './featureFlags'
import { initErrorLogger, broadcastError } from './errorLogger'
import { setApiKey, clearApiKey, hasApiKey, getMaskedKey } from './keyStore'
import { validateApiKey } from './groq'
import {
  createMainWindow,
  createWidgetWindow,
  showMainWindow,
  getMainWindow,
  setHUDPosition
} from './windowManager'

// Simple JSON settings persistence
function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(getSettingsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function saveSetting(key: string, value: unknown): void {
  const settings = loadSettings()
  settings[key] = value
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2))
}

function restoreSettings(): void {
  const settings = loadSettings()
  if (typeof settings.llmProvider === 'string') {
    // Normalize legacy provider values (groq, cerebras, etc.) → 'cloud'
    let normalized = settings.llmProvider === 'local-llm' ? 'local-llm' as const : 'cloud' as const
    if (!features.localModels && normalized === 'local-llm') {
      console.log('[main] features.localModels=false — normalizing LLM provider local-llm → cloud')
      normalized = 'cloud'
      saveSetting('llmProvider', 'cloud')
    }
    sessionManager.setLLMProvider(normalized)
    console.log('[main] Restored LLM provider from settings:', settings.llmProvider, '→', normalized)
  }
  if (settings.sttProvider === 'cloud' || settings.sttProvider === 'local' || settings.sttProvider === 'faster-whisper' || settings.sttProvider === 'cartesia' || settings.sttProvider === 'sarvam' || settings.sttProvider === 'dual-whisper') {
    let sttValue = settings.sttProvider
    if (!features.localModels && (sttValue === 'local' || sttValue === 'faster-whisper')) {
      console.log(`[main] features.localModels=false — normalizing STT provider ${sttValue} → cloud`)
      sttValue = 'cloud'
      saveSetting('sttProvider', 'cloud')
    }
    sessionManager.setSTTProvider(sttValue as 'cloud' | 'local' | 'faster-whisper' | 'cartesia' | 'sarvam' | 'dual-whisper')
    console.log('[main] Restored STT provider from settings:', settings.sttProvider, '→', sttValue)
  }
  // Backend is always Cloudflare — no toggle needed
  // Pipeline is always on (default true in sessionManager)
  // Restore widget position
  if (settings.widgetPosition === 'center' || settings.widgetPosition === 'right') {
    setHUDPosition(settings.widgetPosition)
    console.log('[main] Restored widget position from settings:', settings.widgetPosition)
  }
  // Restore STT endpoint (dev-only)
  if (settings.sttEndpoint === 'transcriptions' || settings.sttEndpoint === 'translations') {
    sessionManager.setSTTEndpoint(settings.sttEndpoint)
    console.log('[main] Restored STT endpoint from settings:', settings.sttEndpoint)
  }
  // Restore STT language (dev-only)
  if (typeof settings.sttLanguage === 'string' && ['auto', 'en', 'hi', 'gu', 'ar'].includes(settings.sttLanguage)) {
    sessionManager.setSTTLanguage(settings.sttLanguage)
    console.log('[main] Restored STT language from settings:', settings.sttLanguage)
  }
  // Restore chunk min duration override (dev-only, persisted for convenience)
  // No runtime action needed — value is read by renderer at recording start via IPC
  if (typeof settings.chunkMinDuration === 'number' && settings.chunkMinDuration > 0) {
    console.log('[main] Restored chunkMinDuration from settings:', settings.chunkMinDuration)
  }
  // Restore input language (user-facing)
  if (settings.inputLanguage === 'en' || settings.inputLanguage === 'hinglish') {
    sessionManager.setInputLanguage(settings.inputLanguage)
    console.log('[main] Restored inputLanguage from settings:', settings.inputLanguage)
  }
  // Restore dictation key preference
  if (settings.dictationKey === 'fn' || settings.dictationKey === 'right-option') {
    keyboardManager.setDictationKey(settings.dictationKey)
    console.log('[main] Restored dictationKey from settings:', settings.dictationKey)
  }
  // Restore activation mode preference
  if (settings.activationMode === 'tap-toggle' || settings.activationMode === 'push-to-talk' || settings.activationMode === 'double-tap-push') {
    keyboardManager.setActivationMode(settings.activationMode)
    console.log('[main] Restored activationMode from settings:', settings.activationMode)
  }
}

// Developer access flag — set after server-side whitelist verification
let isDevVerified = false

// Background config refresh interval
let configRefreshInterval: ReturnType<typeof setInterval> | null = null

/** Fetch server config using the stored auth token, update sessionManager. Non-blocking. */
async function refreshServerConfig(): Promise<void> {
  const authToken = sessionManager.getAuthToken()
  if (!authToken) return

  try {
    const config = await fetchServerConfig(authToken)
    updateFeaturesFromConfig(config)
    sessionManager.setServerConfig(config)

    // Broadcast quota update to renderer if quota data is present
    if (config.quota) {
      try {
        const wins = BrowserWindow.getAllWindows()
        for (const win of wins) {
          win.webContents.send('quota:updated', config.quota)
        }
      } catch { /* ignore broadcast errors */ }
    }
  } catch (err) {
    console.warn('[main] Config refresh failed:', err instanceof Error ? err.message : err)
  }
}

/** Start the background config refresh loop (every 5 minutes). */
function startConfigRefresh(): void {
  if (configRefreshInterval) return
  configRefreshInterval = setInterval(() => {
    if (isConfigStale()) {
      refreshServerConfig()
    }
  }, 60_000) // Check every 60s, only fetch if stale (5-min TTL)
}

function stopConfigRefresh(): void {
  if (configRefreshInterval) {
    clearInterval(configRefreshInterval)
    configRefreshInterval = null
  }
}

// ─── Retry session from saved audio ───
const retryingSessionIds = new Set<string>()

async function retrySessionFromAudio(sessionId: string): Promise<void> {
  const mainWindow = getMainWindow()
  if (!mainWindow?.webContents) return

  if (retryingSessionIds.has(sessionId)) {
    console.log('[retry] Already retrying session:', sessionId)
    return
  }

  retryingSessionIds.add(sessionId)

  try {
    // 1. Load session from DB
    const dbSession = getSession(sessionId)
    if (!dbSession) throw new Error('Session not found')

    // 2. Load audio buffer (try dictation first, then instruction)
    const audioBuffer = loadAudioFile(sessionId + '-dictation')
      || loadAudioFile(sessionId + '-instruction')
    if (!audioBuffer) throw new Error('Audio file not found or unreadable')

    // 3. Notify renderer: retry started
    mainWindow.webContents.send('session:retry-status', sessionId, 'processing')

    // 4. Require a Groq API key
    if (!hasApiKey()) throw new Error('No Groq API key set. Add your key in Settings.')
    const authToken = sessionManager.getAuthToken()

    // 5. Transcribe audio using current STT provider
    const sttProvider = sessionManager.getSTTProvider()
    const backendProvider = sessionManager.getBackendProvider()
    const llmProvider = sessionManager.getLLMProvider()

    console.log('[retry] Transcribing audio, STT:', sttProvider, 'backend:', backendProvider)

    let transcript: string
    const useFasterWhisper = features.localModels && sttProvider === 'faster-whisper' && fasterWhisperManager.isReady()
    const useLocalWhisper = features.localModels && sttProvider === 'local' && whisperManager.isModelReady() && whisperManager.isBinaryReady()
    const useCartesia = sttProvider === 'cartesia'
    const useSarvam = sttProvider === 'sarvam'

    if (useFasterWhisper) {
      transcript = await fasterWhisperManager.transcribe(audioBuffer)
    } else if (useLocalWhisper) {
      transcript = await whisperManager.transcribe(audioBuffer)
    } else {
      const cloudProvider = useSarvam ? 'sarvam' as const : useCartesia ? 'cartesia' as const : 'groq' as const
      transcript = await pipelineTranscribe(audioBuffer, authToken, {
        sttProvider: cloudProvider,
        sttEndpoint: sessionManager.getSTTEndpoint(),
        sttLanguage: sessionManager.getEffectiveSTTLanguage(),
        inputLanguage: sessionManager.getInputLanguage(),
      })
    }

    console.log('[retry] Transcript:', transcript)

    if (!transcript || transcript.trim() === '' || transcript === '[BLANK_AUDIO]') {
      throw new Error('Audio could not be transcribed (empty or blank)')
    }

    // 6. Raw-by-default: retry just re-transcribes and cleans (no LLM)
    const output = cleanTranscript(transcript)
    const errorMessage: string | null = null

    // 7. Update DB
    updateSessionResult(sessionId, {
      dictationTranscript: transcript,
      output,
      status: 'done',
      errorMessage,
      flowType: 'dictation'
    })

    // 8. Notify renderer: done
    mainWindow.webContents.send('session:retry-status', sessionId, 'done', {
      dictationTranscript: transcript,
      output,
      status: 'done',
      errorMessage,
      flowType: 'dictation'
    })

    console.log('[retry] ✅ Session retried successfully:', sessionId)

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Retry failed'
    console.error('[retry] ❌ Error:', errorMsg)

    broadcastError('session/retry', errorMsg)

    updateSessionResult(sessionId, {
      dictationTranscript: null,
      output: null,
      status: 'error',
      errorMessage: errorMsg
    })

    const mainWindow = getMainWindow()
    mainWindow?.webContents.send('session:retry-status', sessionId, 'error', {
      status: 'error',
      errorMessage: errorMsg
    })
  } finally {
    retryingSessionIds.delete(sessionId)
  }
}

function setupKeyboard(): void {
  keyboardManager.on('keyboard', (event: KeyboardEvent) => {
    console.log('[main] Keyboard event:', event)

    switch (event.type) {
      case 'session-start':
        sessionManager.startSession(event.mode)
        break
      case 'chain-start':
        sessionManager.chainSession(event.mode)
        break
      case 'session-stop':
        sessionManager.stopRecording(event.mode)
        break
      case 'chain-expired':
        if (sessionManager.processing) {
          console.log('[main] Ignoring chain-expired — still processing previous session')
          break
        }
        sessionManager.processSession()
        break
    }
  })

  // Escape key shortcut — registered during recording AND processing
  // During recording: Escape cancels with undo window
  // During processing: Escape discards the in-flight API calls
  sessionManager.onRecordingStarted = () => {
    if (escapeOwner === 'none') {
      try {
        globalShortcut.register('Escape', () => {
          if (sessionManager.processing) {
            console.log('[main] Escape during processing — cancelling session')
            sessionManager.cancelSession()
          } else {
            sessionManager.cancelSessionWithUndo()
          }
        })
        escapeOwner = 'dictation'
      } catch (err) {
        console.warn('[main] Failed to register Escape shortcut:', err)
      }
    }
  }

  sessionManager.onRecordingStopped = () => {
    // Don't unregister Escape here — keep it registered through processing
    // so user can press Esc to discard during API calls.
    // Escape will be unregistered in onSessionEnded instead.
  }

  // When a session ends (cancel, Escape, processing done), reset keyboard state
  // and unregister the Escape shortcut
  sessionManager.onSessionEnded = () => {
    keyboardManager.resetState()
    if (escapeOwner === 'dictation') {
      try {
        globalShortcut.unregister('Escape')
      } catch {
        // Ignore — may not be registered
      }
      escapeOwner = 'none'
    }
  }

  // When a session-start/chain/stop is rejected (during processing),
  // reset keyboard toggle state so it doesn't get stuck.
  // Don't unregister Escape — it should stay active during processing.
  sessionManager.onSessionRejected = () => {
    keyboardManager.resetState()
  }

  keyboardManager.start()
}

// Escape-key ownership (registered only during an active dictation session)
let escapeOwner: 'none' | 'dictation' = 'none'

function setupSessionPersistence(): void {
  sessionManager.onSessionComplete = (session) => {
    const audioPath = getAudioFilePath(session.sessionId + '-dictation') || getAudioFilePath(session.sessionId + '-instruction')
    saveSession({
      sessionId: session.sessionId,
      flowType: session.flowType,
      dictationTranscript: session.dictationTranscript,
      instructionTranscript: session.instructionTranscript,
      selectedText: session.selectedText,
      selectedTextRole: session.selectedTextRole,
      output: session.output,
      audioFilePath: audioPath,
      status: session.status,
      errorMessage: session.errorMessage,
      createdAt: session.createdAt
    })
    console.log('[main] Session saved:', session.sessionId, session.status)
  }
}

function setupIPC(): void {
  ipcMain.on('widget:cancel', () => {
    console.log('[main] Session cancelled')
    sessionManager.cancelSession()
  })

  ipcMain.on('widget:undo-cancel', () => {
    console.log('[main] Undo cancel requested')
    sessionManager.undoCancel()
  })

  ipcMain.on('audio:discarded', (_event, mode: string) => {
    console.log('[main] Audio discarded (too short), mode:', mode)
    sessionManager.discardSession()
  })

  ipcMain.on('quota:blocked', () => {
    console.log('[main] Recording blocked — daily quota exhausted')
    sessionManager.quotaBlocked()
  })

  ipcMain.on('audio:ready', (_event, buffer: ArrayBuffer, duration: number, mode: 'dictation' | 'instruction') => {
    console.log('[main] Audio received, mode:', mode, 'duration:', duration, 'bytes:', buffer.byteLength)
    sessionManager.receiveAudio(Buffer.from(buffer), duration, mode)
  })

  ipcMain.on('audio:chunk', (_event, buffer: ArrayBuffer, chunkIndex: number, mode: 'dictation' | 'instruction') => {
    console.log(`[main] Audio chunk ${chunkIndex} received (${buffer.byteLength} bytes, mode: ${mode})`)
    sessionManager.receiveAudioChunk(Buffer.from(buffer), chunkIndex, mode)
  })

  ipcMain.on('audio:final-chunk', (_event, buffer: ArrayBuffer, chunkIndex: number, totalChunks: number, duration: number, mode: 'dictation' | 'instruction') => {
    console.log(`[main] Final audio chunk ${chunkIndex} received (${buffer.byteLength} bytes, totalChunks: ${totalChunks}, mode: ${mode})`)
    sessionManager.receiveAudioFinalChunk(Buffer.from(buffer), chunkIndex, totalChunks, duration, mode)
  })

  ipcMain.on('session:retry', (_event, sessionId: string) => {
    console.log('[main] Retry session:', sessionId)
    retrySessionFromAudio(sessionId)
  })

  ipcMain.on('auth:token', (_event, token: string) => {
    sessionManager.setAuthToken(token)
    saveSetting('authToken', token)

    // Reset dev access on token change (will be re-verified by renderer)
    isDevVerified = false

    // On sign-out (empty token): clear all local session data
    if (!token) {
      console.log('[main] Sign-out detected — clearing local session data')
      clearAllSessions()
      clearAllAudioFiles()
    }

    // Fetch server config on login (non-blocking)
    refreshServerConfig()
    startConfigRefresh()
  })

  // ─── Groq API key (BYO-key) ───
  ipcMain.handle('groq-key:status', () => {
    return { hasKey: hasApiKey(), masked: getMaskedKey() }
  })

  ipcMain.handle('groq-key:set', (_event, key: string) => {
    try {
      setApiKey(key)
      return { success: true, masked: getMaskedKey() }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to save key' }
    }
  })

  ipcMain.handle('groq-key:test', async (_event, key: string) => {
    return validateApiKey(key)
  })

  ipcMain.on('groq-key:clear', () => {
    clearApiKey()
  })

  // Server config — renderer can read cached config
  ipcMain.handle('config:get', () => {
    return getCachedConfig()
  })

  // Quota — renderer can read cached quota
  ipcMain.handle('quota:get', (): QuotaInfo | null => {
    return getCachedConfig().quota || null
  })

  ipcMain.on('settings:llm-provider', (_event, provider: string) => {
    if (!isDevVerified) return  // Developer-only setting
    if (!features.localModels && provider === 'local-llm') return
    console.log('[main] LLM provider changed to:', provider)
    if (provider === 'cloud' || provider === 'local-llm') {
      sessionManager.setLLMProvider(provider)
      saveSetting('llmProvider', provider)

      // Start/stop local LLM server based on provider selection
      if (provider === 'local-llm') {
        if (localLLMManager.isModelReady() && localLLMManager.isBinaryReady()) {
          localLLMManager.startServer().catch((err) => {
            console.warn('[main] Failed to start local LLM server:', err instanceof Error ? err.message : err)
          })
        }
      } else {
        localLLMManager.stopServer()
      }
    }
  })

  ipcMain.handle('settings:get-llm-provider', () => {
    return sessionManager.getLLMProvider()
  })

  // STT provider settings
  ipcMain.on('settings:stt-provider', (_event, provider: string) => {
    if (!isDevVerified) return  // Developer-only setting
    if (!features.localModels && (provider === 'local' || provider === 'faster-whisper')) return
    console.log('[main] STT provider changed to:', provider)
    if (provider === 'cloud' || provider === 'local' || provider === 'faster-whisper' || provider === 'cartesia' || provider === 'sarvam' || provider === 'dual-whisper') {
      sessionManager.setSTTProvider(provider)
      saveSetting('sttProvider', provider)

      // Start/stop faster-whisper server based on provider selection
      if (provider === 'faster-whisper') {
        fasterWhisperManager.startServer().catch((err) => {
          console.warn('[main] Failed to start faster-whisper server:', err instanceof Error ? err.message : err)
        })
      } else {
        fasterWhisperManager.stopServer()
      }
    }
  })

  ipcMain.handle('settings:get-stt-provider', () => {
    return sessionManager.getSTTProvider()
  })

  // STT Endpoint (dev-only): transcriptions vs translations
  ipcMain.on('settings:stt-endpoint', (_event, endpoint: string) => {
    if (!isDevVerified) return
    console.log('[main] STT endpoint changed to:', endpoint)
    if (endpoint === 'transcriptions' || endpoint === 'translations') {
      sessionManager.setSTTEndpoint(endpoint)
      saveSetting('sttEndpoint', endpoint)
    }
  })

  ipcMain.handle('settings:get-stt-endpoint', () => {
    return sessionManager.getSTTEndpoint()
  })

  // STT Language (dev-only): auto, en, hi, gu, ar
  ipcMain.on('settings:stt-language', (_event, language: string) => {
    if (!isDevVerified) return
    console.log('[main] STT language changed to:', language)
    if (['auto', 'en', 'hi', 'gu', 'ar'].includes(language)) {
      sessionManager.setSTTLanguage(language)
      saveSetting('sttLanguage', language)
    }
  })

  ipcMain.handle('settings:get-stt-language', () => {
    return sessionManager.getSTTLanguage()
  })

  // Backend is always Cloudflare, pipeline always on — no toggles needed

  // Whisper model management
  ipcMain.handle('whisper:model-status', () => {
    if (!features.localModels) return false
    return whisperManager.isModelReady()
  })

  ipcMain.handle('whisper:binary-status', () => {
    if (!features.localModels) return false
    return whisperManager.isBinaryReady()
  })

  ipcMain.handle('whisper:download-model', async () => {
    if (!features.localModels) return { success: false, error: 'Local models are disabled' }
    try {
      await whisperManager.downloadModel((progress) => {
        const mainWindow = getMainWindow()
        if (mainWindow?.webContents) {
          mainWindow.webContents.send('whisper:download-progress', progress)
        }
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Download failed' }
    }
  })

  // Faster-whisper management
  ipcMain.handle('faster-whisper:status', () => {
    if (!features.localModels) return false
    return fasterWhisperManager.isReady()
  })

  ipcMain.handle('faster-whisper:setup', async () => {
    if (!features.localModels) return { success: false, error: 'Local models are disabled' }
    try {
      const { execSync } = require('child_process')
      const scriptPath = path.join(app.getAppPath(), 'scripts', 'setup-faster-whisper.js')
      execSync(`node "${scriptPath}"`, { timeout: 600_000, stdio: 'inherit' })
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Setup failed' }
    }
  })

  // ─── Local LLM management ───
  ipcMain.handle('local-llm:model-status', () => {
    if (!features.localModels) return false
    return localLLMManager.isModelReady()
  })

  ipcMain.handle('local-llm:binary-status', () => {
    if (!features.localModels) return false
    return localLLMManager.isBinaryReady()
  })

  ipcMain.handle('local-llm:server-status', () => {
    if (!features.localModels) return false
    return localLLMManager.isServerRunning()
  })

  ipcMain.handle('local-llm:download-model', async () => {
    if (!features.localModels) return { success: false, error: 'Local models are disabled' }
    try {
      await localLLMManager.downloadModel((progress) => {
        const mainWindow = getMainWindow()
        if (mainWindow?.webContents) {
          mainWindow.webContents.send('local-llm:download-progress', progress)
        }
      })
      // Auto-start server after download if local-llm is selected
      if (sessionManager.getLLMProvider() === 'local-llm' && localLLMManager.isBinaryReady()) {
        localLLMManager.startServer().catch((err) => {
          console.warn('[main] Failed to start local LLM server after download:', err instanceof Error ? err.message : err)
        })
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Download failed' }
    }
  })

  // ─── Feature flag query ───
  ipcMain.handle('config:local-models-enabled', () => features.localModels)

  // Widget position settings
  ipcMain.on('settings:widget-position', (_event, position: string) => {
    console.log('[main] Widget position changed to:', position)
    if (position === 'center' || position === 'right') {
      setHUDPosition(position)
      saveSetting('widgetPosition', position)
    }
  })

  ipcMain.handle('settings:get-widget-position', () => {
    return loadSettings().widgetPosition || 'center'
  })

  // Sound feedback settings
  ipcMain.on('settings:sound-feedback', (_event, enabled: boolean) => {
    console.log('[main] Sound feedback changed to:', enabled)
    saveSetting('soundFeedback', enabled)
  })

  ipcMain.handle('settings:get-sound-feedback', () => {
    return loadSettings().soundFeedback !== false // default true
  })

  // Input language setting (user-facing, NOT dev-gated)
  ipcMain.on('settings:input-language', (_event, language: string) => {
    console.log('[main] Input language changed to:', language)
    if (language === 'en' || language === 'hinglish') {
      sessionManager.setInputLanguage(language)
      saveSetting('inputLanguage', language)
    }
  })

  ipcMain.handle('settings:get-input-language', () => {
    return loadSettings().inputLanguage || 'en'
  })

  // Dictation key setting
  ipcMain.on('settings:dictation-key', (_event, key: string) => {
    console.log('[main] Dictation key changed to:', key)
    if (key === 'fn' || key === 'right-option') {
      keyboardManager.setDictationKey(key)
      saveSetting('dictationKey', key)
    }
  })

  ipcMain.handle('settings:get-dictation-key', () => {
    return loadSettings().dictationKey || 'fn'
  })

  // Activation mode setting
  ipcMain.on('settings:activation-mode', (_event, mode: string) => {
    console.log('[main] Activation mode changed to:', mode)
    if (mode === 'tap-toggle' || mode === 'push-to-talk' || mode === 'double-tap-push') {
      keyboardManager.setActivationMode(mode)
      saveSetting('activationMode', mode)
    }
  })

  ipcMain.handle('settings:get-activation-mode', () => {
    return loadSettings().activationMode || 'tap-toggle'
  })

  // Chunked transcription setting
  ipcMain.on('settings:chunked-transcription', (_event, enabled: boolean) => {
    if (!isDevVerified) return  // Developer-only setting
    console.log('[main] Chunked transcription changed to:', enabled)
    saveSetting('chunkedTranscription', enabled)
  })

  ipcMain.handle('settings:get-chunked-transcription', () => {
    return loadSettings().chunkedTranscription !== false // default true (chunked on)
  })

  // Chunk min duration override (dev-only, in ms; 0 = use server default)
  ipcMain.on('settings:chunk-min-duration', (_event, ms: number) => {
    if (!isDevVerified) return
    console.log('[main] Chunk min duration changed to:', ms)
    saveSetting('chunkMinDuration', ms)
  })

  ipcMain.handle('settings:get-chunk-min-duration', () => {
    return loadSettings().chunkMinDuration || 0
  })

  ipcMain.handle('session:list', async () => {
    return getSessions()
  })

  // ─── Auth / External Links ───
  ipcMain.on('open-external', (_event, url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

}

// ─── Deep Link Protocol (unmute://) ───
// Register for OAuth callback: unmute://auth/callback#access_token=...
app.setAsDefaultProtocolClient('unmute')

// macOS: handle deep link when app is already running
app.on('open-url', (event, url) => {
  event.preventDefault()
  console.log('[main] Deep link received:', url.substring(0, 60) + '...')
  const mainWin = getMainWindow()
  if (mainWin) {
    mainWin.webContents.send('auth:callback', url)
    mainWin.show()
    mainWin.focus()
  }
})

app.whenReady().then(() => {
  initDB()
  restoreSettings()
  createMainWindow()
  createWidgetWindow()
  createTray()

  // Init error logger with main window reference (must be after createMainWindow)
  initErrorLogger(getMainWindow)

  setupSessionPersistence()
  setupIPC()

  // Setup keyboard AFTER IPC so that a key listener crash doesn't block IPC registration
  try {
    setupKeyboard()
  } catch (err) {
    console.error('[main] setupKeyboard failed (app will still work, but hotkeys disabled):', err instanceof Error ? err.message : err)
  }

  // Pre-download whisper model and start persistent server (only when local models enabled)
  if (features.localModels) {
    const startWhisperServer = async () => {
      try {
        await whisperManager.startServer()
      } catch (err) {
        console.warn('[main] Whisper server start failed (will use CLI fallback):', err instanceof Error ? err.message : err)
      }
    }

    if (!whisperManager.isModelReady()) {
      console.log('[main] Whisper model not found — downloading in background...')
      whisperManager.downloadModel((progress) => {
        if (progress % 25 === 0 || progress === 100) {
          console.log(`[main] Whisper model download: ${progress}%`)
        }
      }).then(() => {
        console.log('[main] Whisper model download complete — starting server...')
        startWhisperServer()
      }).catch((err) => {
        console.warn('[main] Whisper model download failed (will retry on demand):', err instanceof Error ? err.message : err)
      })
    } else {
      console.log('[main] Whisper model already available — starting server...')
      startWhisperServer()
    }

    // Auto-start faster-whisper server if it's the selected STT provider
    if (sessionManager.getSTTProvider() === 'faster-whisper' && fasterWhisperManager.isReady()) {
      console.log('[main] faster-whisper is selected STT provider — starting server...')
      fasterWhisperManager.startServer().catch((err) => {
        console.warn('[main] faster-whisper server start failed:', err instanceof Error ? err.message : err)
      })
    }

    // Auto-start local LLM server if it's the selected LLM provider and model + binary are ready
    if (sessionManager.getLLMProvider() === 'local-llm' && localLLMManager.isModelReady() && localLLMManager.isBinaryReady()) {
      console.log('[main] local-llm is selected LLM provider — starting server...')
      localLLMManager.startServer().catch((err) => {
        console.warn('[main] local LLM server start failed:', err instanceof Error ? err.message : err)
      })
    }
  } else {
    console.log('[main] features.localModels=false — skipping all local model auto-start')
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
      createWidgetWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  keyboardManager.stop()
  whisperManager.stopServer()
  fasterWhisperManager.stopServer()
  localLLMManager.stopServer()
  stopConfigRefresh()
  // Unregister any remaining global shortcuts
  globalShortcut.unregisterAll()
  closeDB()
})
