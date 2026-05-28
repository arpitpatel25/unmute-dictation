import { useState, useEffect, useRef } from 'react'
import type { WidgetState } from '../shared/types'

interface WidgetProps {
  state: WidgetState
  analyserNode: AnalyserNode | null
  maxDurationSeconds?: number
  outputPreview?: string
  errorMessage?: string
  showDiscardHint?: boolean
  onCancel: () => void
  onStop: () => void
  onUndo: () => void
}

export default function Widget({
  state,
  maxDurationSeconds = 300,
  outputPreview,
  errorMessage,
  showDiscardHint = false,
  onStop,
  onUndo
}: WidgetProps) {
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [exiting, setExiting] = useState(false)
  const prevStateRef = useRef<WidgetState>('hidden')

  const isRecording =
    state === 'dictation-active' ||
    state === 'instruction-active' ||
    state === 'chained'

  const isDictation = state === 'dictation-active'
  const isInstruction = state === 'instruction-active' || state === 'chained'

  // Entry/Exit animation
  useEffect(() => {
    const wasHidden = prevStateRef.current === 'hidden'
    const isNowHidden = state === 'hidden'

    if (!wasHidden && isNowHidden) {
      setExiting(true)
      const timeout = setTimeout(() => setExiting(false), 200)
      prevStateRef.current = state
      return () => clearTimeout(timeout)
    }
    prevStateRef.current = state
  }, [state])

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((p) => p + 1), 1000)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [isRecording])

  function formatTime(s: number): string {
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
  }

  if (state === 'hidden' && !exiting) return null

  const MAX_DURATION = maxDurationSeconds
  const WARN_THRESHOLD = 30
  const timeRemaining = MAX_DURATION - elapsed
  const isNearLimit = isRecording && timeRemaining <= WARN_THRESHOLD

  const dotClass = isDictation ? 'unmute-pill-dot--white' : 'unmute-pill-dot--red'
  const dotPulseClass = isDictation ? 'animate-dot-pulse-white' : 'animate-dot-pulse-red'
  const stopIconClass = isDictation ? 'unmute-pill-stop-icon--white' : 'unmute-pill-stop-icon--red'

  return (
    <div className={exiting ? 'animate-hud-exit' : 'animate-hud-enter'}>

      {/* ══════ RECORDING (pill) ══════ */}
      {isRecording && (
        <div className="unmute-pill">
          <div className={`unmute-pill-dot ${dotClass} ${dotPulseClass}`} />
          <span className={`unmute-pill-timer ${isNearLimit ? 'unmute-pill-timer--warn' : ''}`}>
            {isNearLimit ? `-${formatTime(timeRemaining)}` : formatTime(elapsed)}
          </span>
          <button className="unmute-pill-stop" onClick={onStop} aria-label="Stop recording">
            <div className={`unmute-pill-stop-icon ${stopIconClass}`} />
          </button>
        </div>
      )}

      {/* ══════ PROCESSING (pill) ══════ */}
      {state === 'processing' && (
        <div className="unmute-pill">
          <div className="unmute-pill-dot unmute-pill-dot--processing animate-dot-pulse-processing" />
          <span className="unmute-pill-label">Processing</span>
          <div className="unmute-pill-dots unmute-pill-dots--processing">
            <span className="animate-dot-bounce" />
            <span className="animate-dot-bounce" />
            <span className="animate-dot-bounce" />
          </div>
          {showDiscardHint && (
            <span className="unmute-pill-helper animate-fade-up-in">Esc to discard</span>
          )}
        </div>
      )}

      {/* ══════ OUTPUT — silent success ack (text is already at the cursor) ══════ */}
      {state === 'output' && (
        <div className="unmute-pill animate-success-pop">
          <div className="unmute-pill-success-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="#00C896" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        </div>
      )}

      {/* ══════ OUTPUT FALLBACK (pill) ══════ */}
      {state === 'output-fallback' && (
        <div className="unmute-pill unmute-pill--fallback animate-success-pop">
          <div className="unmute-pill-fallback-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="#FFAA33" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <span className="unmute-pill-fallback-text">Raw — formatting failed</span>
          <span className="unmute-pill-output-text">{outputPreview}</span>
        </div>
      )}

      {/* ══════ ERROR (pill) ══════ */}
      {state === 'error' && (
        <div className="unmute-pill unmute-pill--error animate-fade-up-in">
          <div className="unmute-pill-error-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="#FF4444" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
          <div className="unmute-pill-error-content">
            <span className="unmute-pill-error-text">{errorMessage || 'Something went wrong'}</span>
            {!errorMessage?.includes('limit reached') && (
              <span className="unmute-pill-error-hint">Retry from History to regenerate</span>
            )}
          </div>
        </div>
      )}

      {/* ══════ NOTHING CAPTURED — too short or silent (no API call made) ══════ */}
      {state === 'too-short' && (
        <div className="unmute-pill unmute-pill--muted animate-fade-up-in">
          <span className="unmute-pill-muted-text">Didn't catch that</span>
        </div>
      )}

      {/* ══════ CANCELLED (pill) ══════ */}
      {state === 'cancelled' && (
        <div className="unmute-pill animate-fade-up-in">
          <span className="unmute-pill-cancel-text">Cancelled</span>
          <button className="unmute-pill-undo animate-undo-appear" onClick={onUndo}>
            Undo
          </button>
        </div>
      )}
    </div>
  )
}
