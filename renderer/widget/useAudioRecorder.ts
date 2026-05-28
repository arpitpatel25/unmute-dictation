import { useState, useRef, useCallback } from 'react'

type RecordingMode = 'dictation' | 'instruction'

interface UseAudioRecorderReturn {
  isRecording: boolean
  analyserNode: AnalyserNode | null
  maxDurationSeconds: number
  startRecording: (deviceId?: string, mode?: RecordingMode) => Promise<void>
  stopRecording: () => Promise<void>
}

const MIN_DURATION_MS = 500
const DEFAULT_MAX_DURATION_MS = 5 * 60 * 1000 // 5 minutes
const MIN_BUDGET_SECONDS = 5 // Don't start recording if budget < 5 seconds

// ─── VAD Chunking Defaults (overridden by server config at recording start) ───
const DEFAULT_CHUNK_MIN_MS = 30_000
const DEFAULT_SILENCE_THRESHOLD_RMS = 0.015
const DEFAULT_SILENCE_DURATION_MS = 400
const DEFAULT_HARD_CHUNK_CAP_MS = 45_000
const DEFAULT_VAD_POLL_INTERVAL_MS = 100

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)
  const [maxDurationSeconds, setMaxDurationSeconds] = useState(300)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number>(0)
  const maxTimerRef = useRef<NodeJS.Timeout | null>(null)
  // Mode is frozen at recording start — survives even if startRecording is called again
  const frozenModeRef = useRef<RecordingMode>('dictation')
  // Guard against double-sending audio
  const audioSentRef = useRef<boolean>(false)

  // ─── VAD Chunking Refs ───
  const chunkIndexRef = useRef<number>(0)
  const chunkStartTimeRef = useRef<number>(0)
  const macroBlobsRef = useRef<Blob[]>([])  // Micro-chunks for current macro chunk
  const silenceStartRef = useRef<number | null>(null)
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const vadActivatedRef = useRef<boolean>(false)
  const chunkedModeEnabledRef = useRef<boolean>(false)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const vadDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track if we're in the middle of emitting a chunk (MediaRecorder stop/restart cycle)
  const isEmittingChunkRef = useRef<boolean>(false)
  // Whether any speech (RMS above the silence threshold) was heard this recording.
  // If false on stop, we skip STT entirely — no wasted API call.
  const heardSpeechRef = useRef<boolean>(false)

  // ─── Server-config-driven chunking params (loaded at recording start) ───
  const chunkMinMsRef = useRef<number>(DEFAULT_CHUNK_MIN_MS)
  const silenceThresholdRef = useRef<number>(DEFAULT_SILENCE_THRESHOLD_RMS)
  const silenceDurationMsRef = useRef<number>(DEFAULT_SILENCE_DURATION_MS)
  const hardChunkCapMsRef = useRef<number>(DEFAULT_HARD_CHUNK_CAP_MS)
  const vadPollIntervalMsRef = useRef<number>(DEFAULT_VAD_POLL_INTERVAL_MS)

  const cleanupStream = useCallback(() => {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current)
      maxTimerRef.current = null
    }
    // Clean up VAD
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current)
      vadIntervalRef.current = null
    }
    if (vadDelayTimerRef.current) {
      clearTimeout(vadDelayTimerRef.current)
      vadDelayTimerRef.current = null
    }
    vadActivatedRef.current = false
    isEmittingChunkRef.current = false

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    analyserRef.current = null
    setAnalyserNode(null)
  }, [])

  /**
   * Emit a macro chunk: stop MediaRecorder → assemble valid WebM blob → send via IPC → restart.
   * The gap falls on a detected silence period, so no audible audio loss.
   */
  const emitChunk = useCallback(async (reason: 'silence' | 'hard-cap'): Promise<void> => {
    const recorder = mediaRecorderRef.current
    const stream = streamRef.current
    if (!recorder || recorder.state === 'inactive' || !stream) return
    if (isEmittingChunkRef.current) return // Prevent re-entrance

    isEmittingChunkRef.current = true
    const chunkIdx = chunkIndexRef.current
    const elapsed = Date.now() - chunkStartTimeRef.current
    const mode = frozenModeRef.current

    // Pause VAD monitoring during the stop/restart cycle
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current)
      vadIntervalRef.current = null
    }

    // Stop MediaRecorder — triggers final ondataavailable then onstop
    const existingOnStop = recorder.onstop
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      recorder.stop()
    })

    // Assemble all accumulated micro-chunks into a valid WebM blob
    const macroBlobs = [...macroBlobsRef.current]
    macroBlobsRef.current = []

    if (macroBlobs.length === 0) {
      console.log(`[audio:vad] Chunk ${chunkIdx} has no data, skipping`)
      isEmittingChunkRef.current = false
      return
    }

    const blob = new Blob(macroBlobs, { type: 'audio/webm' })
    const buffer = await blob.arrayBuffer()

    console.log(`[audio:vad] ${reason === 'silence' ? 'Silence detected' : 'Hard cap'}, cutting chunk ${chunkIdx} at ${elapsed}ms (${buffer.byteLength} bytes)`)

    // Send chunk to main process
    window.electronAPI.sendAudioChunk(buffer, chunkIdx, mode)

    // Increment chunk index and reset chunk start time
    chunkIndexRef.current = chunkIdx + 1
    chunkStartTimeRef.current = Date.now()
    silenceStartRef.current = null

    // Restart MediaRecorder on the same live stream (stream is still active)
    if (stream.active) {
      const newRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      })
      mediaRecorderRef.current = newRecorder

      newRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data) // Full recording backup
          macroBlobsRef.current.push(e.data) // Current macro chunk
        }
      }

      newRecorder.start(250)

      // Resume VAD monitoring
      startVADMonitoring()
    }

    isEmittingChunkRef.current = false
  }, [])

  /**
   * Start VAD monitoring interval — checks audio levels every 100ms.
   */
  const startVADMonitoring = useCallback(() => {
    if (vadIntervalRef.current) return // Already running

    const analyser = analyserRef.current
    if (!analyser) return

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    vadIntervalRef.current = setInterval(() => {
      if (isEmittingChunkRef.current) return

      analyser.getByteTimeDomainData(dataArray)

      // Compute RMS
      let sumSquares = 0
      for (let i = 0; i < bufferLength; i++) {
        const normalized = (dataArray[i] - 128) / 128
        sumSquares += normalized * normalized
      }
      const rms = Math.sqrt(sumSquares / bufferLength)

      // Track speech across the whole recording (independent of chunk VAD activation)
      if (rms >= silenceThresholdRef.current) heardSpeechRef.current = true

      // Chunk-splitting logic only runs once VAD is activated (long recordings)
      if (!vadActivatedRef.current) return

      const chunkElapsed = Date.now() - chunkStartTimeRef.current

      // Check hard cap first
      if (chunkElapsed >= hardChunkCapMsRef.current) {
        console.log(`[audio:vad] Hard cap at ${chunkElapsed}ms, force-cutting chunk ${chunkIndexRef.current}`)
        emitChunk('hard-cap')
        return
      }

      // Only look for silence after minimum chunk duration
      if (chunkElapsed < chunkMinMsRef.current) return

      if (rms < silenceThresholdRef.current) {
        if (silenceStartRef.current === null) {
          silenceStartRef.current = Date.now()
        } else if (Date.now() - silenceStartRef.current >= silenceDurationMsRef.current) {
          // Sustained silence — cut chunk
          emitChunk('silence')
        }
      } else {
        // Audio detected — reset silence timer
        silenceStartRef.current = null
      }
    }, vadPollIntervalMsRef.current)
  }, [emitChunk])

  /**
   * Flush the current recorder: stop it, collect chunks, send audio with correct mode.
   * Returns true if audio was sent, false if not (too short / no chunks / already sent).
   * After calling this, the recorder is inactive and refs are cleaned up.
   */
  const flushRecorder = useCallback(async (): Promise<boolean> => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      return false
    }

    // Mark as sent to prevent double-send from onstop handler
    if (audioSentRef.current) {
      console.log('[audio] Audio already sent for this recording, skipping flush')
      return false
    }
    audioSentRef.current = true

    const duration = Date.now() - startTimeRef.current
    const mode = frozenModeRef.current

    // Detach any existing onstop handler to prevent double-send
    recorder.onstop = null

    // Stop the recorder — this triggers a final ondataavailable then onstop
    // We wait for onstop so the final chunk is added to chunksRef.current
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      recorder.stop()
    })

    // Check if we were in chunked mode and chunks were emitted
    if (chunkedModeEnabledRef.current && chunkIndexRef.current > 0) {
      // Send the remaining micro-chunks as the final chunk
      const macroBlobs = [...macroBlobsRef.current]
      macroBlobsRef.current = []

      if (macroBlobs.length > 0) {
        const blob = new Blob(macroBlobs, { type: 'audio/webm' })
        const buffer = await blob.arrayBuffer()
        const totalChunks = chunkIndexRef.current + 1
        console.log(`[audio] Flushed FINAL chunk ${chunkIndexRef.current}/${totalChunks}, size: ${buffer.byteLength}, duration: ${duration}ms`)
        window.electronAPI.sendAudioFinalChunk(buffer, chunkIndexRef.current, totalChunks, duration, mode)
      } else {
        // No remaining data — send totalChunks based on what was already sent
        const totalChunks = chunkIndexRef.current
        console.log(`[audio] No remaining data for final chunk, totalChunks: ${totalChunks}`)
        // Send a minimal final chunk signal so sessionManager knows we're done
        const emptyBuffer = new ArrayBuffer(0)
        window.electronAPI.sendAudioFinalChunk(emptyBuffer, chunkIndexRef.current, totalChunks, duration, mode)
      }

      cleanupStream()
      return true
    }

    // Non-chunked path (original behavior)
    const chunks = [...chunksRef.current]

    // Clean up stream/context
    cleanupStream()

    // Discard if too short, empty, or silent (no speech) — no STT call
    if (duration < MIN_DURATION_MS || chunks.length === 0 || !heardSpeechRef.current) {
      console.log('[audio] Discarding (short/empty/silent). Duration:', duration, 'heardSpeech:', heardSpeechRef.current)
      window.electronAPI.sendAudioDiscarded(frozenModeRef.current)
      return false
    }

    // Assemble and send
    const blob = new Blob(chunks, { type: 'audio/webm' })
    const buffer = await blob.arrayBuffer()
    console.log('[audio] Flushed audio, mode:', mode, 'size:', buffer.byteLength, 'duration:', duration)
    window.electronAPI.sendAudioReady(buffer, duration, mode)
    return true
  }, [cleanupStream])

  const startRecording = useCallback(async (deviceId?: string, mode?: RecordingMode) => {
    // If there's an active recorder, flush it first (sends its audio with correct mode)
    const existingRecorder = mediaRecorderRef.current
    if (existingRecorder && existingRecorder.state !== 'inactive') {
      console.log('[audio] Flushing previous recording before starting new one (mode was:', frozenModeRef.current, ')')
      await flushRecorder()
    }

    // Reset state for new recording
    frozenModeRef.current = mode || 'dictation'
    audioSentRef.current = false
    heardSpeechRef.current = false
    chunksRef.current = []

    // Reset chunking state
    chunkIndexRef.current = 0
    chunkStartTimeRef.current = 0
    macroBlobsRef.current = []
    silenceStartRef.current = null
    vadActivatedRef.current = false
    chunkedModeEnabledRef.current = false
    isEmittingChunkRef.current = false

    // Check if chunked transcription is enabled (only for dictation mode)
    if (frozenModeRef.current === 'dictation') {
      try {
        const chunkedEnabled = await window.electronAPI.getChunkedTranscription()
        chunkedModeEnabledRef.current = chunkedEnabled
        console.log('[audio] Chunked transcription:', chunkedEnabled ? 'ENABLED' : 'DISABLED')
      } catch {
        console.log('[audio] Could not query chunked transcription setting, defaulting to disabled')
      }
    }

    // Load server-driven chunking params (non-blocking — falls back to defaults)
    try {
      const config = await window.electronAPI.getServerConfig()
      if (config?.chunking) {
        chunkMinMsRef.current = config.chunking.min_duration_ms ?? DEFAULT_CHUNK_MIN_MS
        silenceThresholdRef.current = config.chunking.silence_threshold_rms ?? DEFAULT_SILENCE_THRESHOLD_RMS
        silenceDurationMsRef.current = config.chunking.silence_duration_ms ?? DEFAULT_SILENCE_DURATION_MS
        hardChunkCapMsRef.current = config.chunking.hard_cap_ms ?? DEFAULT_HARD_CHUNK_CAP_MS
        vadPollIntervalMsRef.current = config.chunking.vad_poll_interval_ms ?? DEFAULT_VAD_POLL_INTERVAL_MS
        console.log(`[audio] Loaded chunking config v${config.version}: min=${chunkMinMsRef.current}ms, silence=${silenceThresholdRef.current}, hardCap=${hardChunkCapMsRef.current}ms`)
      }
    } catch {
      console.log('[audio] Could not load server config, using default chunking params')
    }

    // Dev-only override: chunk min duration (0 = use server config)
    try {
      const overrideMs = await window.electronAPI.getChunkMinDuration()
      if (overrideMs > 0) {
        chunkMinMsRef.current = overrideMs
        console.log(`[audio] Dev override: chunkMinMs=${overrideMs}ms`)
      }
    } catch {
      // Ignore — not critical
    }

    // Fixed max recording duration (no quota in local/BYO-key mode)
    setMaxDurationSeconds(Math.round(DEFAULT_MAX_DURATION_MS / 1000))

    // Sarvam has a 30s limit — force chunked mode and cap hard chunk at 28s
    try {
      const sttProvider = await window.electronAPI.getSTTProvider()
      if (sttProvider === 'sarvam' && frozenModeRef.current === 'dictation') {
        chunkedModeEnabledRef.current = true
        hardChunkCapMsRef.current = Math.min(hardChunkCapMsRef.current, 28_000)
        console.log(`[audio] Sarvam detected — forced chunked mode, hardCap=${hardChunkCapMsRef.current}ms`)
      }
    } catch {
      // Ignore — not critical
    }

    console.log('[audio] Starting NEW recording, mode:', frozenModeRef.current)

    const constraints: MediaStreamConstraints = {
      audio: deviceId
        ? { deviceId: { exact: deviceId }, sampleRate: 16000 }
        : { sampleRate: 16000 }
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    streamRef.current = stream

    // Set up audio context for waveform analysis
    const audioContext = new AudioContext()
    audioContextRef.current = audioContext
    const source = audioContext.createMediaStreamSource(stream)
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 128
    source.connect(analyser)
    analyserRef.current = analyser
    setAnalyserNode(analyser)

    // Set up MediaRecorder
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    })
    mediaRecorderRef.current = mediaRecorder

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data)
        // If chunked mode, also push to current macro chunk buffer
        if (chunkedModeEnabledRef.current) {
          macroBlobsRef.current.push(e.data)
        }
      }
    }

    mediaRecorder.start(250) // Collect data every 250ms
    startTimeRef.current = Date.now()
    chunkStartTimeRef.current = Date.now()
    setIsRecording(true)

    // If chunked mode, schedule VAD activation after chunkMinMs
    if (chunkedModeEnabledRef.current) {
      const minMs = chunkMinMsRef.current
      console.log(`[audio:vad] Chunked mode active — VAD will activate after ${minMs}ms`)
      vadDelayTimerRef.current = setTimeout(() => {
        vadDelayTimerRef.current = null
        vadActivatedRef.current = true
        console.log('[audio:vad] VAD monitoring activated')
        startVADMonitoring()
      }, minMs)
    }

    // Auto-stop at max duration
    maxTimerRef.current = setTimeout(() => {
      stopRecording()
    }, DEFAULT_MAX_DURATION_MS)
  }, [flushRecorder, startVADMonitoring])

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      // Already stopped (might have been flushed by startRecording)
      console.log('[audio] stopRecording called but recorder already inactive')
      cleanupStream()
      setIsRecording(false)
      return
    }

    // Check if audio was already sent (by startRecording's flush)
    if (audioSentRef.current) {
      console.log('[audio] stopRecording: audio already sent by flush, cleaning up')
      recorder.onstop = null
      try { recorder.stop() } catch { /* ignore */ }
      cleanupStream()
      setIsRecording(false)
      return
    }

    audioSentRef.current = true
    const duration = Date.now() - startTimeRef.current
    const mode = frozenModeRef.current

    // Stop VAD monitoring
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current)
      vadIntervalRef.current = null
    }
    if (vadDelayTimerRef.current) {
      clearTimeout(vadDelayTimerRef.current)
      vadDelayTimerRef.current = null
    }

    return new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        setIsRecording(false)

        // Discard if too short, or silent with no chunks emitted (no speech) — no STT call
        const wasChunked = chunkedModeEnabledRef.current && chunkIndexRef.current > 0
        if (duration < MIN_DURATION_MS || (!heardSpeechRef.current && !wasChunked)) {
          console.log('[audio] Discarding (short/silent). Duration:', duration, 'heardSpeech:', heardSpeechRef.current)
          window.electronAPI.sendAudioDiscarded(mode)
          cleanupStream()
          resolve()
          return
        }

        // Check if chunks were emitted during recording (chunked mode)
        if (chunkedModeEnabledRef.current && chunkIndexRef.current > 0) {
          // Send remaining micro-chunks as final chunk
          const macroBlobs = [...macroBlobsRef.current]
          macroBlobsRef.current = []

          const totalChunks = chunkIndexRef.current + (macroBlobs.length > 0 ? 1 : 0)

          if (macroBlobs.length > 0) {
            const blob = new Blob(macroBlobs, { type: 'audio/webm' })
            const buffer = await blob.arrayBuffer()
            console.log(`[audio] Sending FINAL chunk ${chunkIndexRef.current}/${totalChunks}, size: ${buffer.byteLength}, duration: ${duration}ms`)
            window.electronAPI.sendAudioFinalChunk(buffer, chunkIndexRef.current, totalChunks, duration, mode)
          } else {
            // No remaining data — all audio was already sent in previous chunks
            console.log(`[audio] No remaining data — all ${chunkIndexRef.current} chunks already sent`)
            // Still send final signal so sessionManager knows total count
            const emptyBuffer = new ArrayBuffer(0)
            window.electronAPI.sendAudioFinalChunk(emptyBuffer, chunkIndexRef.current, chunkIndexRef.current, duration, mode)
          }

          cleanupStream()
          resolve()
          return
        }

        // Non-chunked path — send full audio as single buffer (original behavior)
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const buffer = await blob.arrayBuffer()
        console.log('[audio] Sending audio to main process, mode:', mode, 'size:', buffer.byteLength, 'duration:', duration)
        window.electronAPI.sendAudioReady(buffer, duration, mode)

        cleanupStream()
        resolve()
      }

      recorder.stop()
    })
  }, [cleanupStream])

  return { isRecording, analyserNode, maxDurationSeconds, startRecording, stopRecording }
}
