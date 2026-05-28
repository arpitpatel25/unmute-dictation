import { useState } from 'react'
import unmuteLogo from '../assets/unmute-logo.png'

interface OnboardingProps {
  onComplete: () => void
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0)
  const [micGranted, setMicGranted] = useState(false)

  function next() {
    if (step < steps.length - 1) {
      setStep(step + 1)
    } else {
      onComplete()
    }
  }

  async function requestMicPermission() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
      setMicGranted(true)
    } catch {
      setMicGranted(false)
    }
  }

  function openAccessibilitySettings() {
    window.open('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
  }

  const steps = [
    // Step 0: Welcome
    <div key="welcome" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <img src={unmuteLogo} alt="Unmute" className="w-56 mb-8" />
      <h1 className="font-display text-2xl font-medium text-ink mb-3 tracking-tight flex items-center justify-center gap-2">
        Typing sucks. Just unmute.
        <span className="w-[8px] h-[8px] rounded-full bg-accent shrink-0" style={{ animation: 'brand-dot-breathe 3s ease-in-out infinite' }} />
      </h1>
      <p className="text-ink-60 text-[15px] mb-10 max-w-sm leading-relaxed">
        Voice-first text manipulation for your desktop. Dictate, transform, and translate — all without leaving your workflow.
      </p>
      <button onClick={next} className="px-10 py-3.5 rounded-full bg-accent text-white font-display font-semibold text-[15px] hover:bg-accent-hover transition-all duration-200 shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]">
        Get Started
      </button>
    </div>,

    // Step 1: Plan Selection
    <div key="plan" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <div className="w-20 h-20 rounded-2xl bg-accent/[0.06] flex items-center justify-center mb-6">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <h2 className="font-display text-2xl font-extrabold text-ink mb-2 tracking-tight">Your Plan</h2>
      <p className="text-ink-60 text-[14px] mb-8 max-w-sm leading-relaxed">
        You're on the Free plan. Upgrade anytime for more daily usage.
      </p>

      <div className="flex gap-4 mb-8 w-full max-w-[420px]">
        {/* Free plan card */}
        <div className="flex-1 p-5 rounded-2xl border-2 border-accent bg-white text-left relative shadow-sm">
          <div className="absolute -top-2.5 left-4">
            <span className="text-[10px] font-bold text-white bg-accent px-2.5 py-[3px] rounded-full uppercase tracking-wider">Current</span>
          </div>
          <p className="font-display text-[22px] font-extrabold text-ink mt-1">Free</p>
          <p className="text-[11px] text-ink-35 font-medium mb-4">Always free</p>
          <ul className="space-y-2">
            <PlanFeature text="Daily usage allowance" />
            <PlanFeature text="~30 min dictation/day" />
            <PlanFeature text="All features" />
            <PlanFeature text="All languages" />
          </ul>
        </div>

        {/* Pro plan card */}
        <div className="flex-1 p-5 rounded-2xl border border-border bg-surface-2 text-left relative overflow-hidden opacity-75">
          <div className="absolute inset-0 bg-cream/50 backdrop-blur-[1px] flex items-center justify-center z-10">
            <span className="px-4 py-2 rounded-full bg-ink text-white text-[11px] font-bold shadow-md">
              Coming Soon
            </span>
          </div>
          <p className="font-display text-[22px] font-extrabold text-ink mt-1">&#8377;499</p>
          <p className="text-[11px] text-ink-35 font-medium mb-4">per month</p>
          <ul className="space-y-2">
            <PlanFeature text="4.5x more daily usage" />
            <PlanFeature text="~2+ hrs dictation/day" />
            <PlanFeature text="All features" />
            <PlanFeature text="Priority support" />
          </ul>
        </div>
      </div>

      <button onClick={next} className="px-10 py-3.5 rounded-full bg-accent text-white font-display font-semibold text-[14px] hover:bg-accent-hover transition-all duration-200 shadow-sm hover:shadow-md">
        Continue with Free
      </button>
    </div>,

    // Step 3: Microphone Permission
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
        Unmute needs microphone access to transcribe your voice.
      </p>
      <p className="text-ink-35 text-[12px] mb-8 max-w-sm">
        You'll see a macOS prompt asking to allow microphone access. Click Allow to continue.
      </p>
      {micGranted ? (
        <div className="flex flex-col items-center gap-4">
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
      ) : (
        <button onClick={requestMicPermission} className="px-10 py-3.5 rounded-full bg-accent text-white font-display font-semibold text-[14px] hover:bg-accent-hover transition-all duration-200 shadow-sm hover:shadow-md">
          Grant Microphone Access
        </button>
      )}
    </div>,

    // Step 4: Accessibility Permission (macOS)
    <div key="accessibility" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <div className="w-20 h-20 rounded-2xl bg-warm-soft flex items-center justify-center mb-6">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FF8C42" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </div>
      <h2 className="font-display text-2xl font-extrabold text-ink mb-2 tracking-tight">Accessibility Permission</h2>
      <p className="text-ink-60 text-[14px] mb-2 max-w-sm leading-relaxed">
        Unmute needs Accessibility access to detect keyboard shortcuts and paste text at your cursor.
      </p>
      <p className="text-ink-35 text-[12px] mb-8 max-w-sm">
        Click "Open System Settings" below. Find Unmute in the list and toggle it on. You may need to unlock the settings with your password first.
      </p>
      <div className="flex gap-3">
        <button onClick={openAccessibilitySettings} className="px-6 py-3 rounded-full border border-border text-[13px] font-semibold text-ink-60 hover:bg-cream-mid hover:border-border-md transition-all duration-200">
          Open System Settings
        </button>
        <button onClick={next} className="px-8 py-3 rounded-full bg-accent text-white font-display font-semibold text-[13px] hover:bg-accent-hover transition-all duration-200 shadow-sm">
          Continue
        </button>
      </div>
    </div>,

    // Step 5: Keyboard Shortcuts
    <div key="shortcuts" className="flex flex-col items-center justify-center text-center animate-fade-up-in">
      <h2 className="font-display text-2xl font-extrabold text-ink mb-6 tracking-tight">How it works</h2>
      <div className="flex flex-col gap-3 mb-8 w-full max-w-[340px]">
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
          description="Tap Caps Lock to give voice instructions, tap again to stop"
          accentColor="bg-accent"
          textColor="text-white"
        />
        <ShortcutCard
          keyLabel="⌥ ␣"
          title="Quick Chat"
          description="Press Option+Space to open Quick Chat for voice conversations"
          accentColor="bg-ink"
          textColor="text-white"
        />
      </div>
      <div className="px-5 py-3 rounded-xl bg-accent/[0.04] border border-accent/[0.08] mb-8 max-w-[340px]">
        <p className="text-[12px] text-ink-60 leading-relaxed">
          <span className="font-display font-bold text-accent">Pro tip:</span> You can chain them — dictate first with Fn, then immediately tap Caps Lock to give an instruction.
        </p>
      </div>
      <button onClick={next} className="px-10 py-3.5 rounded-full bg-accent text-white font-display font-semibold text-[14px] hover:bg-accent-hover transition-all duration-200 shadow-sm hover:shadow-md">
        Continue
      </button>
    </div>,

    // Step 6: Ready!
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
          <div
            key={i}
            className="h-[3px] flex-1 rounded-full overflow-hidden bg-ink-07"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                i < step
                  ? 'bg-accent w-full'
                  : i === step
                    ? 'bg-accent w-full'
                    : 'w-0'
              }`}
            />
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

function PlanFeature({ text }: { text: string }) {
  return (
    <li className="flex items-center gap-2 text-[12px] text-ink-60">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-accent shrink-0">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      {text}
    </li>
  )
}
