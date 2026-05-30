import { useState, useEffect } from 'react'
import unmuteLogo from '../assets/unmute-logo.png'
import History from './History'
import Voice from './Voice'
import Settings from './Settings'
import Privacy from './Privacy'
import Onboarding from './Onboarding'

type Tab = 'history' | 'voice' | 'settings' | 'privacy'

type AppView = 'loading' | 'onboarding' | 'main'

export default function App() {
  const [view, setView] = useState<AppView | 'loading'>('loading')
  const [activeTab, setActiveTab] = useState<Tab>('history')
  const [dictationKey, setDictationKey] = useState<'fn' | 'right-option'>('fn')
  const [pendingUpdate, setPendingUpdate] = useState<string | null>(null)

  useEffect(() => {
    // Load dictation key setting (for the pro-tip hint)
    window.electronAPI?.getDictationKey().then((key: string) => {
      if (key === 'fn' || key === 'right-option') setDictationKey(key)
    }).catch(() => {})

    // Onboarding gate — no sign-in in local BYO-key mode
    const onboardingDone = localStorage.getItem('unmute_onboarding_complete')
    setView(onboardingDone ? 'main' : 'onboarding')

    // Listen for downloaded updates and surface a "Restart" banner.
    window.electronAPI?.onUpdateDownloaded((version) => setPendingUpdate(version))
  }, [])

  function handleOnboardingComplete() {
    localStorage.setItem('unmute_onboarding_complete', 'true')
    setView('main')
  }

  if (view === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-cream">
        <div className="titlebar-drag absolute top-0 left-0 right-0 h-8" />
        <div className="flex items-center gap-2">
          <div className="w-[5px] h-[5px] rounded-full bg-ink/30 animate-dot-bounce" />
          <div className="w-[5px] h-[5px] rounded-full bg-ink/30 animate-dot-bounce" style={{ animationDelay: '0.15s' }} />
          <div className="w-[5px] h-[5px] rounded-full bg-ink/30 animate-dot-bounce" style={{ animationDelay: '0.3s' }} />
        </div>
      </div>
    )
  }

  if (view === 'onboarding') {
    return <Onboarding onComplete={handleOnboardingComplete} />
  }

  return (
    <div className="flex h-screen bg-cream">
      {/* Titlebar drag region */}
      <div className="titlebar-drag absolute top-0 left-0 right-0 h-8 z-10" />

      {/* Update-ready banner */}
      {pendingUpdate && (
        <div className="absolute top-8 left-0 right-0 z-20 flex justify-center pointer-events-none">
          <div className="pointer-events-auto mt-2 flex items-center gap-3 px-4 py-2.5 rounded-full bg-ink text-white shadow-lg border border-black/30 animate-fade-up-in">
            <span className="text-[12px] font-medium">
              <span className="font-bold">unmute {pendingUpdate}</span> ready to install.
            </span>
            <button
              onClick={() => window.electronAPI.restartToUpdate()}
              className="text-[12px] font-semibold px-3 py-1 rounded-full bg-white text-ink hover:opacity-90 transition-opacity"
            >
              Restart now
            </button>
            <button
              onClick={() => setPendingUpdate(null)}
              className="text-[16px] leading-none text-white/60 hover:text-white px-1"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <nav className="w-[220px] min-w-[220px] border-r border-border pt-12 px-2 flex flex-col bg-cream-mid">
        {/* Brand */}
        <div className="px-3 mb-5 pb-5 border-b border-border flex flex-col items-center">
          <div className="relative">
            <img src={unmuteLogo} alt="Unmute" className="h-[54px] w-auto" />
          </div>
          <p className="text-[10px] text-ink-60 font-medium -mt-0.5">
            Typing sucks. Just unmute.
          </p>
        </div>

        {/* Nav items */}
        <div className="flex flex-col gap-0.5 px-1">
          <SidebarButton
            icon={<HistoryIcon />}
            label="History"
            active={activeTab === 'history'}
            onClick={() => setActiveTab('history')}
          />
          <SidebarButton
            icon={<VoiceIcon />}
            label="Features"
            active={activeTab === 'voice'}
            onClick={() => setActiveTab('voice')}
          />
          <SidebarButton
            icon={<SettingsIcon />}
            label="Settings"
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
          />
          <SidebarButton
            icon={<PrivacyIcon />}
            label="Privacy"
            active={activeTab === 'privacy'}
            onClick={() => setActiveTab('privacy')}
          />
        </div>

        <div className="mt-auto pb-4 px-1">
          {/* Pro tip */}
          <div className="px-1 mt-3">
            <div className="p-3 rounded-xl bg-surface-2 border border-border shadow-sm">
              <p className="text-[11px] font-bold text-ink mb-1.5 flex items-center gap-1.5">
                <span className="text-[8px] text-gold">✦</span> Pro tip
              </p>
              <p className="text-[11px] text-ink-60 leading-relaxed">
                Press{' '}
                <kbd className="inline-flex px-1.5 py-0.5 rounded-md bg-gradient-to-b from-white to-cream-dark text-[9px] font-bold text-ink border border-border-md shadow-[0_2px_0_rgba(26,23,20,0.22),0_1px_3px_rgba(0,0,0,0.10)]">{dictationKey === 'fn' ? 'Fn' : 'Right Opt'}</kbd>
                {' '}to dictate,{' '}
                <kbd className="inline-flex px-1.5 py-0.5 rounded-md bg-gradient-to-b from-[#2E2A25] to-ink text-[9px] font-bold text-white/90 border border-black/50 shadow-[0_2px_0_rgba(0,0,0,0.55),0_1px_3px_rgba(0,0,0,0.25)]">Caps Lock</kbd>
                {' '}for instructions.
              </p>
            </div>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 pt-10 px-10 overflow-y-auto">
        <div className="max-w-2xl mx-auto pb-8">
          {activeTab === 'history' && <History />}
          {activeTab === 'voice' && <Voice />}
          {activeTab === 'settings' && <Settings onDictationKeyChange={setDictationKey} />}
          {activeTab === 'privacy' && <Privacy />}
        </div>
      </main>
    </div>
  )
}

function SidebarButton({
  icon,
  label,
  active,
  onClick
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`titlebar-no-drag flex items-center gap-2.5 text-left px-3 py-2.5 rounded-[10px] text-[13px] font-medium transition-all duration-150 select-none ${
        active
          ? 'bg-surface-2 text-ink shadow-sm'
          : 'text-ink-60 hover:bg-ink-07 hover:text-ink'
      }`}
    >
      <span className={`transition-colors ${active ? 'text-ink' : 'text-ink-35'}`}>
        {icon}
      </span>
      {label}
    </button>
  )
}

function HistoryIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <polyline points="8,5 8,8 10,10" />
    </svg>
  )
}

function VoiceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0" />
      <line x1="8" y1="12" x2="8" y2="14.5" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.22 3.22l1.41 1.41M11.37 11.37l1.41 1.41M3.22 12.78l1.41-1.41M11.37 4.63l1.41-1.41" />
    </svg>
  )
}

function PrivacyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14.5s5.5-2.5 5.5-7V3.5L8 1.5 2.5 3.5V7.5c0 4.5 5.5 7 5.5 7z" />
      <polyline points="5.5 8 7 9.5 10.5 6" />
    </svg>
  )
}
