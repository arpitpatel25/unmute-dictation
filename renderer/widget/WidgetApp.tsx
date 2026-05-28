import { useState, useEffect, useCallback, useRef } from 'react'
import Widget from './Widget'
import { useAudioRecorder } from './useAudioRecorder'
import type { WidgetState } from '../shared/types'

// ─── Sound Feedback (Web Audio API) ───
let soundEnabled = true // default on; loaded from settings on mount

function playClickSound(type: 'start' | 'stop') {
  if (!soundEnabled) return
  try {
    const ctx = new AudioContext()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()

    oscillator.connect(gain)
    gain.connect(ctx.destination)

    // Start: higher pitch pop (880Hz), Stop: lower pitch (660Hz)
    oscillator.frequency.setValueAtTime(type === 'start' ? 880 : 660, ctx.currentTime)
    oscillator.type = 'sine'

    // Subtle vibrato — gentle wobble
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.connect(lfoGain)
    lfoGain.connect(oscillator.frequency)
    lfo.type = 'sine'
    lfo.frequency.setValueAtTime(14, ctx.currentTime)
    lfoGain.gain.setValueAtTime(8, ctx.currentTime)
    lfo.start(ctx.currentTime)
    lfo.stop(ctx.currentTime + 0.08)

    // Softer envelope with slight vibration
    gain.gain.setValueAtTime(0.07, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08)

    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + 0.08)

    // Cleanup
    setTimeout(() => ctx.close(), 200)
  } catch {
    // Silently ignore — sound is non-critical
  }
}

export default function WidgetApp() {
  const [state, setState] = useState<WidgetState>('hidden')
  const [outputPreview, setOutputPreview] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [showDiscardHint, setShowDiscardHint] = useState(false)
  const { analyserNode, maxDurationSeconds, startRecording, stopRecording } = useAudioRecorder()

  // Track auto-hide timer so it can be cancelled when a new recording starts
  const autoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearAutoHide = useCallback(() => {
    if (autoHideRef.current) {
      clearTimeout(autoHideRef.current)
      autoHideRef.current = null
    }
  }, [])

  const scheduleAutoHide = useCallback((delayMs: number) => {
    clearAutoHide()
    autoHideRef.current = setTimeout(() => {
      autoHideRef.current = null
      setState('hidden')
    }, delayMs)
  }, [clearAutoHide])

  useEffect(() => {
    document.body.classList.add('widget-body')
    document.documentElement.style.background = 'transparent'
    return () => {
      document.body.classList.remove('widget-body')
    }
  }, [])

  useEffect(() => {
    const api = window.electronAPI

    // Load sound feedback preference
    api.getSoundFeedback().then((enabled: boolean) => {
      soundEnabled = enabled
    }).catch(() => { /* ignore — default is true */ })

    api.onRecordingStart(async (mode) => {
      // Cancel any pending auto-hide from a previous session
      clearAutoHide()

      // Pre-check quota before showing recording UI
      try {
        const quota = await api.getQuota() as Record<string, unknown> | null
        if (quota && typeof quota.max_recording_seconds === 'number' && quota.max_recording_seconds < 5) {
          playClickSound('stop')
          api.sendQuotaBlocked()
          return
        }
      } catch { /* fail-open — let recording proceed */ }

      playClickSound('start')
      setState(mode === 'dictation' ? 'dictation-active' : 'instruction-active')
      try {
        await startRecording(undefined, mode)
      } catch {
        setErrorMessage('Mic error. Check settings.')
        setState('error')
        scheduleAutoHide(3000)
      }
    })

    api.onRecordingStop(async () => {
      setState('processing')
      setShowDiscardHint(false)
      await stopRecording()
    })

    api.onOutputReady(() => {
      // Raw-by-default: the text is already at the cursor. No preview — a brief
      // success ack, then get out of the way.
      playClickSound('stop')
      setState('output')
      setShowDiscardHint(false)
      scheduleAutoHide(1200)
    })

    api.onOutputFallback((text) => {
      playClickSound('stop')
      const preview = text.length > 50 ? text.slice(0, 50) + '...' : text
      setOutputPreview(preview)
      setState('output-fallback')
      setShowDiscardHint(false)
      scheduleAutoHide(4000)
    })

    api.onOutputError((error) => {
      playClickSound('stop')
      setErrorMessage(error)
      setState('error')
      setShowDiscardHint(false)
      scheduleAutoHide(5000)
    })

    api.onSessionCancelled(() => {
      setState('cancelled')
      setShowDiscardHint(false)
    })

    api.onProcessingDiscardHint(() => {
      setShowDiscardHint(true)
    })

    api.onSessionTooShort(() => {
      setState('too-short')
      setShowDiscardHint(false)
    })

    return () => {
      api.removeAllListeners('recording:start')
      api.removeAllListeners('recording:stop')
      api.removeAllListeners('output:ready')
      api.removeAllListeners('output:fallback')
      api.removeAllListeners('output:error')
      api.removeAllListeners('session:cancelled')
      api.removeAllListeners('processing:show-discard-hint')
      api.removeAllListeners('session:too-short')
    }
  }, [startRecording, stopRecording, clearAutoHide, scheduleAutoHide])

  const handleCancel = useCallback(async () => {
    await stopRecording()
    window.electronAPI.cancelSession()
    setState('hidden')
  }, [stopRecording])

  const handleStop = useCallback(async () => {
    setState('processing')
    await stopRecording()
  }, [stopRecording])

  const handleUndo = useCallback(() => {
    // Undo processes the already-captured audio, so show processing state
    setState('processing')
    window.electronAPI.undoCancel()
  }, [])

  return (
    <div
      className="w-full h-full flex items-start justify-center"
      style={{ background: 'transparent', paddingTop: '8px' }}
    >
      <Widget
        state={state}
        analyserNode={analyserNode}
        maxDurationSeconds={maxDurationSeconds}
        outputPreview={outputPreview}
        errorMessage={errorMessage}
        showDiscardHint={showDiscardHint}
        onCancel={handleCancel}
        onStop={handleStop}
        onUndo={handleUndo}
      />
    </div>
  )
}
