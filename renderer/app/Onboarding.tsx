import { useState, useEffect, useCallback } from 'react'
import unmuteLogo from '../assets/unmute-logo.png'

interface OnboardingProps {
  onComplete: () => void
}

type MicStatus = 'unknown' | 'not-determined' | 'granted' | 'denied' | 'restricted'

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0)

  // ─── Microphone permission ───
  const [micStatus, setMicStatus] = useState<MicStatus>('unknown')
  const micGranted = micStatus === 'granted'

  const refreshMicStatus = useCallback(async () => {
    try {
      const status = (await window.electronAPI.getMicPermissionStatus()) as MicStatus
      setMicStatus(status)
      return status
    } catch {
      return 'unknown' as MicStatus
    }
  }, [])

  // ─── Accessibility permission ───
  const [accessibilityGranted, setAccessibilityGranted] = useState(false)

  const refreshAccessibilityStatus = useCallback(async () => {
    try {
      const granted = await window.electronAPI.getAccessibilityStatus()
      setAccessibilityGranted(granted)
      return granted
    } catch {
      return false
    }
  }, [])

  async function requestAccessibility() {
    // prompt=true adds the app to the Accessibility list and surfaces the
    // system prompt, then we deep-link to the pane so they can flip the toggle.
    const granted = await window.electronAPI.requestAccessibility()
    setAccessibilityGranted(granted)
    if (!granted) window.electronAPI.openAccessibilitySettings()
  }

  // Check both permissions on mount, and re-check whenever the window regains
  // focus (e.g. the user just toggled a permission in System Settings).
  useEffect(() => {
    refreshMicStatus()
    refreshAccessibilityStatus()
    const onFocus = () => {
      refreshMicStatus()
      refreshAccessibilityStatus()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshMicStatus, refreshAccessibilityStatus])

  async function requestMicPermission() {
    // askForMediaAccess shows the native prompt only when status is
    // 'not-determined'. If it was previously denied, it resolves false without
    // prompting — so we deep-link the user straight to the Microphone pane.
    const granted = await window.electronAPI.requestMicPermission()
    if (granted) {
      setMicStatus('granted')
      return
    }
    const status = await refreshMicStatus()
    if (status === 'denied' || status === 'restricted') {
      window.electronAPI.openMicSettings()
    }
  }

  // ─── Groq API key ───
  const [keyInput, setKeyInput] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const [keySkipped, setKeySkipped] = useState(false)
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI.getGroqKeyStatus().then((s) => {
      if (s.hasKey) setKeySaved(true)
    }).catch(() => { /* ignore */ })
  }, [])

  async function saveKey() {
    const key = keyInput.trim()
    if (!key || keyBusy) return
    setKeyBusy(true)
    setKeyError(null)
    try {
      const test = await window.electronAPI.testGroqKey(key)
      if (!test.ok) {
        setKeyError(test.error || 'That key didn’t work. Double-check and try again.')
        return
      }
      const res = await window.electronAPI.setGroqKey(key)
      if (res.success) {
        setKeySaved(true)
        setKeySkipped(false)
        setKeyInput('')
      } else {
        setKeyError(res.error || 'Couldn’t save the key.')
      }
    } catch {
      setKeyError('Something went wrong saving the key.')
    } finally {
      setKeyBusy(false)
    }
  }

  function next() {
    if (step < steps.length - 1) setStep(step + 1)
    else onComplete()
  }

  const steps = [
    // ── Step 0: Welcome ──
    <div key="welcome" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <img src={unmuteLogo} alt="Unmute" className="w-56 mb-8" />
      <h1 className="font-display text-2xl font-medium text-ink mb-3 tracking-tight flex items-center justify-center gap-2">
        Typing sucks. Just unmute.
        <span className="w-[8px] h-[8px] rounded-full bg-accent shrink-0" style={{ animation: 'brand-dot-breathe 3s ease-in-out infinite' }} />
      </h1>
      <p className="text-ink-60 text-[15px] mb-10 max-w-sm leading-relaxed">
        Voice-first dictation for your whole Mac. Speak anywhere, and your words appear at the cursor — no window-switching, no cleanup.
      </p>
      <button onClick={next} className="px-10 py-3.5 rounded-full bg-accent text-white font-display font-semibold text-[15px] hover:bg-accent-hover transition-all duration-200 shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]">
        Get Started
      </button>
    </div>,

    // ── Step 1: How it works ──
    <div key="how" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <h2 className="font-display text-2xl font-extrabold text-ink mb-2 tracking-tight">How it works</h2>
      <p className="text-ink-60 text-[14px] mb-8 max-w-sm leading-relaxed">
        Two ways to use your voice, anywhere on your Mac.
      </p>
      <div className="flex flex-col gap-3 mb-8 w-full max-w-[380px]">
        <FeatureCard
          icon={<MicGlyph />}
          title="Dictate"
          description="Tap your dictation key, speak, tap again. Raw text lands exactly where your cursor is — never auto-formatted unless you ask."
        />
        <FeatureCard
          icon={<WandGlyph />}
          title="Instruct"
          description="Select text and give a voice instruction — “make this formal”, “turn into bullets”, “translate to Hindi”. unmute rewrites it in place."
        />
      </div>
      <button onClick={next} className="px-10 py-3.5 rounded-full bg-accent text-white font-display font-semibold text-[14px] hover:bg-accent-hover transition-all duration-200 shadow-sm hover:shadow-md">
        Continue
      </button>
    </div>,

    // ── Step 2: Privacy / local-first ──
    <div key="privacy" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <div className="w-20 h-20 rounded-2xl bg-success-soft flex items-center justify-center mb-6">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-success">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <polyline points="9 12 11 14 15 10" />
        </svg>
      </div>
      <h2 className="font-display text-2xl font-extrabold text-ink mb-2 tracking-tight">Your words stay yours</h2>
      <p className="text-ink-60 text-[14px] mb-8 max-w-sm leading-relaxed">
        unmute is local-first and open source. There&apos;s no unmute account, no server, and nothing to sign up for.
      </p>
      <div className="flex flex-col gap-2.5 mb-8 w-full max-w-[400px] text-left">
        <PrivacyBullet text="No data is ever stored anywhere except your own computer." />
        <PrivacyBullet text="Audio is sent only to Groq using your own key — or processed fully on-device. Nothing passes through us." />
        <PrivacyBullet text="No accounts, no tracking, no telemetry. The full source is public on GitHub." />
      </div>
      <button onClick={next} className="px-10 py-3.5 rounded-full bg-accent text-white font-display font-semibold text-[14px] hover:bg-accent-hover transition-all duration-200 shadow-sm hover:shadow-md">
        Continue
      </button>
    </div>,

    // ── Step 3: Groq API key (or skip → on-device) ──
    <div key="key" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <div className="w-20 h-20 rounded-2xl bg-accent/[0.06] flex items-center justify-center mb-6">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" />
        </svg>
      </div>
      <h2 className="font-display text-2xl font-extrabold text-ink mb-2 tracking-tight">Add your Groq key</h2>
      <p className="text-ink-60 text-[14px] mb-1 max-w-sm leading-relaxed">
        unmute uses Groq for fast, accurate transcription. The key is free and stays encrypted on this Mac.
      </p>

      {keySaved ? (
        <div className="flex flex-col items-center gap-4 mt-6">
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-success-soft border border-success/15">
            <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <span className="text-success font-semibold text-[13px]">Key saved &amp; verified</span>
          </div>
          <button onClick={next} className="px-10 py-3.5 rounded-full bg-accent text-white font-display font-semibold text-[14px] hover:bg-accent-hover transition-all duration-200 shadow-sm hover:shadow-md">
            Continue
          </button>
        </div>
      ) : (
        <>
          <div className="w-full max-w-[400px] mt-6">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => { setKeyInput(e.target.value); setKeyError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') saveKey() }}
              placeholder="gsk_..."
              className="w-full px-4 py-3 rounded-xl border border-border bg-white text-[14px] text-ink font-mono placeholder:text-ink-35 focus:outline-none focus:border-accent transition-colors"
            />
            {keyError && <p className="text-[12px] text-error mt-2 text-left">{keyError}</p>}
            <div className="flex items-center justify-between mt-3">
              <button
                onClick={() => window.electronAPI.openExternal('https://console.groq.com/keys')}
                className="text-[12px] text-accent font-semibold hover:underline"
              >
                Get a free API key &rarr;
              </button>
              <button
                onClick={saveKey}
                disabled={!keyInput.trim() || keyBusy}
                className="px-6 py-2.5 rounded-full bg-accent text-white font-display font-semibold text-[13px] hover:bg-accent-hover transition-all duration-200 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {keyBusy ? 'Verifying…' : 'Save key'}
              </button>
            </div>
          </div>

          <div className="w-full max-w-[400px] mt-7 pt-6 border-t border-border">
            {keySkipped ? (
              <div className="flex flex-col items-center gap-3">
                <div className="px-4 py-3 rounded-xl bg-ink-07 text-left">
                  <p className="text-[12px] text-ink-60 leading-relaxed">
                    No problem — unmute will run on a built-in <span className="font-semibold text-ink">on-device model</span>. It works fully offline and is completely private, just a little slower. You can add a Groq key anytime in Settings for faster results.
                  </p>
                </div>
                <button onClick={next} className="px-10 py-3 rounded-full bg-ink text-white font-display font-semibold text-[13px] hover:opacity-90 transition-all duration-200 shadow-sm">
                  Continue on-device
                </button>
              </div>
            ) : (
              <button
                onClick={() => setKeySkipped(true)}
                className="text-[13px] text-ink-35 font-medium hover:text-ink-60 transition-colors"
              >
                Skip for now &mdash; use the on-device model
              </button>
            )}
          </div>
        </>
      )}
    </div>,

    // ── Step 4: Microphone permission ──
    <div key="mic" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <div className="w-20 h-20 rounded-2xl bg-ink-07 flex items-center justify-center mb-6">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-35">
          <rect x="9" y="1" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      </div>
      <h2 className="font-display text-2xl font-extrabold text-ink mb-2 tracking-tight">Microphone Access</h2>
      <p className="text-ink-60 text-[14px] mb-2 max-w-sm leading-relaxed">
        unmute needs your microphone to hear what you say. Audio is processed for transcription only — never recorded or stored.
      </p>

      {micGranted ? (
        <div className="flex flex-col items-center gap-4 mt-4">
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-success-soft border border-success/15">
            <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <span className="text-success font-semibold text-[13px]">Microphone access granted</span>
          </div>
          <button onClick={next} className="px-10 py-3.5 rounded-full bg-accent text-white font-display font-semibold text-[14px] hover:bg-accent-hover transition-all duration-200 shadow-sm hover:shadow-md">
            Continue
          </button>
        </div>
      ) : micStatus === 'denied' || micStatus === 'restricted' ? (
        <div className="flex flex-col items-center gap-3 mt-4">
          <p className="text-ink-60 text-[12px] mb-1 max-w-sm">
            Microphone access is currently turned off. Open System Settings, find <span className="font-semibold">unmute</span> under Microphone and toggle it on — then come back.
          </p>
          <div className="flex gap-3">
            <button onClick={() => window.electronAPI.openMicSettings()} className="px-6 py-3 rounded-full border border-border text-[13px] font-semibold text-ink-60 hover:bg-cream-mid hover:border-border-md transition-all duration-200">
              Open System Settings
            </button>
            <button onClick={refreshMicStatus} className="px-8 py-3 rounded-full bg-accent text-white font-display font-semibold text-[13px] hover:bg-accent-hover transition-all duration-200 shadow-sm">
              I&apos;ve enabled it
            </button>
          </div>
        </div>
      ) : (
        <button onClick={requestMicPermission} className="mt-4 px-10 py-3.5 rounded-full bg-accent text-white font-display font-semibold text-[14px] hover:bg-accent-hover transition-all duration-200 shadow-sm hover:shadow-md">
          Grant Microphone Access
        </button>
      )}
    </div>,

    // ── Step 5: Accessibility permission ──
    <div key="accessibility" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <div className="w-20 h-20 rounded-2xl bg-warm-soft flex items-center justify-center mb-6">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FF8C42" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </div>
      <h2 className="font-display text-2xl font-extrabold text-ink mb-2 tracking-tight">Accessibility Permission</h2>
      <p className="text-ink-60 text-[14px] mb-2 max-w-sm leading-relaxed">
        unmute needs Accessibility access to detect your shortcut keys and paste text at the cursor. Without it, nothing will happen when you press your key.
      </p>

      {accessibilityGranted ? (
        <div className="flex flex-col items-center gap-4 mt-4">
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-success-soft border border-success/15">
            <div className="w-5 h-5 rounded-full bg-success flex items-center justify-center">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <span className="text-success font-semibold text-[13px]">Accessibility access granted</span>
          </div>
          <button onClick={next} className="px-10 py-3.5 rounded-full bg-accent text-white font-display font-semibold text-[14px] hover:bg-accent-hover transition-all duration-200 shadow-sm hover:shadow-md">
            Continue
          </button>
        </div>
      ) : (
        <>
          <p className="text-ink-35 text-[12px] mb-6 max-w-sm">
            Click below, find <span className="font-semibold">unmute</span> in the list and toggle it on. You may need to unlock with your password first. This screen updates automatically once you do.
          </p>
          <div className="flex gap-3">
            <button onClick={requestAccessibility} className="px-6 py-3 rounded-full border border-border text-[13px] font-semibold text-ink-60 hover:bg-cream-mid hover:border-border-md transition-all duration-200">
              Open System Settings
            </button>
            <button onClick={refreshAccessibilityStatus} className="px-8 py-3 rounded-full bg-accent text-white font-display font-semibold text-[13px] hover:bg-accent-hover transition-all duration-200 shadow-sm">
              I&apos;ve enabled it
            </button>
          </div>
          <button onClick={next} className="mt-5 text-[12px] text-ink-35 font-medium hover:text-ink-60 transition-colors">
            Skip for now
          </button>
        </>
      )}
    </div>,

    // ── Step 6: Shortcuts ──
    <div key="shortcuts" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <h2 className="font-display text-2xl font-extrabold text-ink mb-6 tracking-tight">Your shortcuts</h2>
      <div className="flex flex-col gap-3 mb-8 w-full max-w-[360px]">
        <ShortcutCard
          keyLabel="Fn"
          title="Dictation"
          description="Tap Fn to start dictating, tap again to stop"
          accentColor="bg-surface-2"
          textColor="text-ink"
        />
        <ShortcutCard
          keyLabel="⇪"
          title="Instruction"
          description="Select text, tap Caps Lock, speak an instruction"
          accentColor="bg-accent"
          textColor="text-white"
        />
      </div>
      <div className="px-5 py-3 rounded-xl bg-accent/[0.04] border border-accent/[0.08] mb-8 max-w-[360px]">
        <p className="text-[12px] text-ink-60 leading-relaxed">
          <span className="font-display font-bold text-accent">Pro tip:</span> chain them — dictate with Fn, then immediately tap Caps Lock to refine what you just said.
        </p>
      </div>
      <button onClick={next} className="px-10 py-3.5 rounded-full bg-accent text-white font-display font-semibold text-[14px] hover:bg-accent-hover transition-all duration-200 shadow-sm hover:shadow-md">
        Continue
      </button>
    </div>,

    // ── Step 7: Ready ──
    <div key="ready" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <img src={unmuteLogo} alt="Unmute" className="w-48 mb-8 animate-success-pop" />
      <h2 className="font-display text-3xl font-extrabold text-ink mb-3 tracking-tight">You&apos;re all set!</h2>
      <p className="text-ink-60 text-[15px] mb-10 max-w-sm leading-relaxed">
        Press{' '}
        <kbd className="inline-flex px-2 py-1 rounded-lg bg-gradient-to-b from-[#2E2A25] to-ink text-[12px] font-bold text-white/90 border border-black/50 shadow-[0_2px_0_rgba(0,0,0,0.55),0_1px_3px_rgba(0,0,0,0.25)]">Fn</kbd>
        {' '}anywhere to start dictating. Your voice, your words, everywhere.
      </p>
      <button onClick={onComplete} className="px-10 py-3.5 rounded-full bg-accent text-white font-display font-semibold text-[15px] hover:bg-accent-hover transition-all duration-200 shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]">
        Start Using Unmute
      </button>
    </div>
  ]

  return (
    <div className="h-screen bg-cream flex flex-col">
      {/* Titlebar drag region */}
      <div className="titlebar-drag absolute top-0 left-0 right-0 h-8" />

      {/* Progress bar */}
      <div className="flex gap-1.5 px-10 pt-10">
        {steps.map((_, i) => (
          <div key={i} className="h-[3px] flex-1 rounded-full overflow-hidden bg-ink-07">
            <div className={`h-full rounded-full transition-all duration-500 ease-out ${i <= step ? 'bg-accent w-full' : 'w-0'}`} />
          </div>
        ))}
      </div>

      {/* Step counter */}
      <div className="px-10 mt-4">
        <span className="text-[11px] text-ink-35 font-medium">
          {step + 1} of {steps.length}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-10">
        {steps[step]}
      </div>
    </div>
  )
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-4 p-4 rounded-2xl border border-border bg-surface-2 text-left">
      <div className="w-11 h-11 rounded-xl bg-accent/[0.06] flex items-center justify-center shrink-0 text-accent">
        {icon}
      </div>
      <div>
        <p className="text-[14px] font-semibold text-ink">{title}</p>
        <p className="text-[12px] text-ink-60 mt-0.5 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}

function PrivacyBullet({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-surface-2 border border-border">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success shrink-0 mt-0.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span className="text-[12px] text-ink-60 leading-relaxed">{text}</span>
    </div>
  )
}

function ShortcutCard({
  keyLabel,
  title,
  description,
  accentColor,
  textColor
}: {
  keyLabel: string
  title: string
  description: string
  accentColor: string
  textColor: string
}) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-2xl border border-border bg-surface-2 text-left hover:shadow-sm transition-all duration-200">
      <div className={`w-12 h-12 rounded-xl ${accentColor} ${accentColor === 'bg-surface-2' ? 'border border-border' : ''} flex items-center justify-center shrink-0 shadow-sm`}>
        <span className={`${textColor} font-mono text-[18px] font-bold`}>{keyLabel}</span>
      </div>
      <div>
        <p className="text-[14px] font-semibold text-ink">{title}</p>
        <p className="text-[12px] text-ink-35 mt-0.5">{description}</p>
      </div>
    </div>
  )
}

function MicGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="1" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

function WandGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" />
    </svg>
  )
}
