import { useState, useEffect } from 'react'
import type { Session } from '../shared/types'

const FLOW_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  dictation: { label: 'Dictation', color: 'text-ink', bg: 'bg-ink-07' },
  transform: { label: 'Instruction', color: 'text-accent', bg: 'bg-accent/[0.08]' },
  quote: { label: 'Quote', color: 'text-success', bg: 'bg-success/[0.08]' },
  context: { label: 'Context', color: 'text-gold', bg: 'bg-gold/[0.08]' }
}

export default function History() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadSessions()

    // Listen for retry status updates from main process
    window.electronAPI.onRetryStatus((sessionId, status, data) => {
      if (status === 'processing') {
        setRetryingIds(prev => new Set(prev).add(sessionId))
      } else {
        // Remove from retrying set
        setRetryingIds(prev => {
          const next = new Set(prev)
          next.delete(sessionId)
          return next
        })

        // Update the session in-place with new data
        if (data) {
          setSessions(prev => prev.map(s =>
            s.id === sessionId ? { ...s, ...data } : s
          ))
        }
      }
    })

    return () => {
      window.electronAPI.removeAllListeners('session:retry-status')
    }
  }, [])

  async function loadSessions() {
    try {
      const data = await window.electronAPI.getSessions()
      setSessions(data)
    } catch (err) {
      console.error('Failed to load sessions:', err)
    } finally {
      setLoading(false)
    }
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  function copyOutput(text: string, sessionId: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(sessionId)
    setTimeout(() => setCopiedId(null), 1500)
  }

  function retrySession(sessionId: string) {
    window.electronAPI.retrySession(sessionId)
  }

  if (loading) {
    return (
      <div>
        <h2 className="font-display text-[22px] font-bold text-ink tracking-tight mb-6">History</h2>
        <div className="flex items-center gap-3 py-20 justify-center">
          <div className="w-[5px] h-[5px] rounded-full bg-accent animate-dot-bounce" />
          <div className="w-[5px] h-[5px] rounded-full bg-accent animate-dot-bounce" style={{ animationDelay: '0.15s' }} />
          <div className="w-[5px] h-[5px] rounded-full bg-accent animate-dot-bounce" style={{ animationDelay: '0.3s' }} />
        </div>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div>
        <h2 className="font-display text-[22px] font-bold text-ink tracking-tight mb-6">History</h2>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-2xl bg-ink-07 flex items-center justify-center mb-5">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-35">
              <rect x="9" y="1" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <p className="font-display font-bold text-ink text-lg mb-1">No dictations yet</p>
          <p className="text-ink-35 text-sm max-w-[260px] leading-relaxed">
            Press{' '}
            <kbd className="inline-flex px-1.5 py-0.5 rounded-md bg-gradient-to-b from-[#2E2A25] to-ink text-[10px] font-bold text-white/90 border border-black/50 shadow-[0_2px_0_rgba(0,0,0,0.55),0_1px_3px_rgba(0,0,0,0.25)]">Fn</kbd>
            {' '}to start your first dictation.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="font-display text-[22px] font-bold text-ink tracking-tight">Today</h2>
        <p className="text-[11px] text-ink-35 mt-1">
          Only today's sessions are shown. Audio is kept for the last 5 recordings.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {sessions.map((session, index) => {
          const flow = FLOW_CONFIG[session.flowType] || FLOW_CONFIG.dictation
          const isCopied = copiedId === session.id
          const isRetrying = retryingIds.has(session.id)
          const hasAudio = !!session.audioFilePath

          return (
            <div
              key={session.id}
              className={`group relative p-4 rounded-2xl border transition-all duration-200 hover:shadow-md animate-slide-in-up ${
                isRetrying
                  ? 'border-accent/25 bg-accent/[0.03]'
                  : session.status === 'error'
                    ? 'border-error/15 bg-error-soft hover:border-error/25'
                    : 'border-border bg-surface-2 hover:border-border-md'
              }`}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Header row */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] text-ink-35 font-medium">{formatTime(session.createdAt)}</span>
                    <span className={`text-[10px] font-semibold ${flow.color} ${flow.bg} px-2 py-0.5 rounded-full`}>
                      {flow.label}
                    </span>
                    {isRetrying ? (
                      <span className="text-[10px] font-semibold text-accent bg-accent/[0.08] px-2 py-0.5 rounded-full">
                        Retrying...
                      </span>
                    ) : session.status === 'error' ? (
                      <span className="text-[10px] font-semibold text-error bg-error/[0.08] px-2 py-0.5 rounded-full">
                        Failed
                      </span>
                    ) : null}
                  </div>

                  {/* Output text or retrying animation */}
                  {isRetrying ? (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-[3px]">
                        {[6, 14, 10, 18, 8, 16, 12, 20].map((h, i) => (
                          <div
                            key={i}
                            className="w-[2.5px] rounded-sm bg-accent animate-dot-bounce"
                            style={{ height: `${h}px`, animationDelay: `${i * 0.1}s` }}
                          />
                        ))}
                      </div>
                      <span className="text-[13px] text-accent font-medium">Re-processing audio...</span>
                    </div>
                  ) : (
                    <p className="text-[13px] text-ink leading-relaxed line-clamp-2">
                      {session.output || session.dictationTranscript || session.errorMessage || 'No output'}
                    </p>
                  )}
                </div>

                {/* Waveform decoration — hidden while retrying */}
                {!isRetrying && (
                  <div className="flex items-center gap-[2px] h-[28px] opacity-[0.06] shrink-0 mr-1">
                    {[6, 14, 10, 18, 8, 16, 12, 20].map((h, i) => (
                      <div key={i} className="w-[2.5px] rounded-sm bg-ink" style={{ height: `${h}px` }} />
                    ))}
                  </div>
                )}

                {/* Actions — hidden while retrying */}
                {!isRetrying && (
                  <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200 shrink-0 translate-y-1 group-hover:translate-y-0">
                    {session.output && (
                      <button
                        onClick={() => copyOutput(session.output!, session.id)}
                        className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${
                          isCopied
                            ? 'bg-success/10 text-success'
                            : 'bg-ink-07 text-ink-35 hover:bg-accent/10 hover:text-accent'
                        }`}
                        title="Copy"
                      >
                        {isCopied ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                    )}
                    {hasAudio && (
                      <button
                        onClick={() => retrySession(session.id)}
                        className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${
                          session.status === 'error'
                            ? 'bg-accent/[0.08] text-accent hover:bg-accent/15'
                            : 'bg-ink-07 text-ink-35 hover:bg-accent/10 hover:text-accent'
                        }`}
                        title="Re-process from saved audio"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10" />
                          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
