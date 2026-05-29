export default function Privacy() {
  return (
    <div className="max-w-lg">
      <h2 className="font-display text-[22px] font-bold text-ink tracking-tight mb-1">Privacy</h2>
      <p className="text-[14px] font-semibold text-ink-60 mb-6">Local-first. No unmute account, no unmute server.</p>

      {/* Dictation */}
      <div className="mb-4 p-4 rounded-2xl border border-border bg-surface-2">
        <div className="flex items-center gap-2 mb-1.5">
          <MicIcon />
          <h3 className="text-[13px] font-bold text-ink">Your dictations stay on your Mac</h3>
        </div>
        <p className="text-[12px] text-ink-35 leading-relaxed">
          Today's dictations are stored locally so you can revisit them, then cleared automatically the next day. Your Groq API key is encrypted in the macOS Keychain and never leaves this device.
        </p>
      </div>

      {/* Where audio goes */}
      <div className="mb-4 p-4 rounded-2xl border border-border bg-surface-2">
        <div className="flex items-center gap-2 mb-1.5">
          <ShieldIcon />
          <h3 className="text-[13px] font-bold text-ink">Where your audio goes</h3>
        </div>
        <p className="text-[12px] text-ink-35 leading-relaxed">
          Audio is sent only to Groq for transcription, using your own API key over an encrypted connection — or processed fully on-device when no key is set. It never passes through any server of ours, because there isn't one.
        </p>
      </div>

      {/* No accounts, no tracking */}
      <div className="p-4 rounded-2xl border border-border bg-surface-2">
        <div className="flex items-center gap-2 mb-1.5">
          <ShieldIcon />
          <h3 className="text-[13px] font-bold text-ink">No accounts. No tracking. Open source.</h3>
        </div>
        <p className="text-[12px] text-ink-35 leading-relaxed">
          unmute has no sign-up, no analytics, and no telemetry. We never see your audio or transcripts. The full source is public, so you can verify all of this yourself.
        </p>
      </div>
    </div>
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
