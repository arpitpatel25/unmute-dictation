export default function Privacy() {
  return (
    <div className="max-w-lg">
      <h2 className="font-display text-[22px] font-bold text-ink tracking-tight mb-1">Privacy</h2>
      <p className="text-[14px] font-semibold text-ink-60 mb-6">Unmute is completely incognito.</p>

      {/* Quick Chat */}
      <div className="mb-4 p-4 rounded-2xl border border-border bg-surface-2">
        <div className="flex items-center gap-2 mb-1.5">
          <ChatIcon />
          <h3 className="text-[13px] font-bold text-ink">Quick Chat</h3>
        </div>
        <p className="text-[12px] text-ink-35 leading-relaxed">
          Never stored. When you close the Quick Chat window, the entire conversation is gone — nothing is saved anywhere, not on your device, not on our servers.
        </p>
      </div>

      {/* Dictation */}
      <div className="mb-4 p-4 rounded-2xl border border-border bg-surface-2">
        <div className="flex items-center gap-2 mb-1.5">
          <MicIcon />
          <h3 className="text-[13px] font-bold text-ink">Dictation</h3>
        </div>
        <p className="text-[12px] text-ink-35 leading-relaxed">
          Today's dictations are stored locally on your device so you can come back to them. They get cleared the next day automatically. Nothing leaves your computer.
        </p>
      </div>

      {/* No cloud, no training */}
      <div className="p-4 rounded-2xl border border-border bg-surface-2">
        <div className="flex items-center gap-2 mb-1.5">
          <ShieldIcon />
          <h3 className="text-[13px] font-bold text-ink">No cloud. No training. Ever.</h3>
        </div>
        <p className="text-[12px] text-ink-35 leading-relaxed">
          We don't store anything on our database — not your audio, not your transcriptions, not your AI responses. Nothing is used for training or any other purpose.
        </p>
      </div>
    </div>
  )
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-ink-60">
      <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 3V3z" />
    </svg>
  )
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-ink-60">
      <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" />
      <line x1="8" y1="12" x2="8" y2="14" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-ink-60">
      <path d="M8 14.5s5.5-2.5 5.5-7V3.5L8 1.5 2.5 3.5V7.5c0 4.5 5.5 7 5.5 7z" />
      <polyline points="5.5 8 7 9.5 10.5 6" />
    </svg>
  )
}
