import { useState, useEffect, useCallback } from 'react'
import type { UsageSummary } from '../shared/types'

interface AudioDevice {
  deviceId: string
  label: string
}

interface SettingsProps {
  onDictationKeyChange?: (key: 'fn' | 'right-option') => void
}

export default function Settings({ onDictationKeyChange }: SettingsProps = {}) {
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string>('')
  const [outputMode, setOutputMode] = useState<'paste' | 'clipboard'>('paste')
  const [launchAtLogin, setLaunchAtLogin] = useState(true)
  const [soundFeedback, setSoundFeedback] = useState(true)
  const [autoPunctuation, setAutoPunctuation] = useState(true)
  const [inputLanguage, setInputLanguage] = useState<'en' | 'hinglish'>('en')
  const [widgetPosition, setWidgetPosition] = useState<'center' | 'right'>('center')
  const [dictationKey, setDictationKey] = useState<'fn' | 'right-option'>('fn')
  const [activationMode, setActivationMode] = useState<'tap-toggle' | 'push-to-talk' | 'double-tap-push'>('tap-toggle')

  // Transcription engine — cloud (Groq) vs on-device (whisper.cpp)
  const [useCloudSTT, setUseCloudSTT] = useState(true)
  const [whisperModelReady, setWhisperModelReady] = useState(false)
  const [whisperDownloading, setWhisperDownloading] = useState(false)
  const [whisperProgress, setWhisperProgress] = useState(0)

  // Groq API key (BYO-key)
  const [groqKeyInput, setGroqKeyInput] = useState('')
  const [groqKeyMasked, setGroqKeyMasked] = useState<string | null>(null)
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyMsg, setKeyMsg] = useState<{ text: string; type: 'ok' | 'err' } | null>(null)

  // Groq usage (local estimated cost)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [usageWindow, setUsageWindow] = useState<'today' | 'month' | 'allTime'>('today')
  const [usageResetting, setUsageResetting] = useState(false)

  // System permissions (mic / accessibility) — live status with focus re-check
  const [micStatus, setMicStatus] = useState<string>('unknown')
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean>(false)
  const micGranted = micStatus === 'granted'

  const refreshPermissions = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([
        window.electronAPI.getMicPermissionStatus(),
        window.electronAPI.getAccessibilityStatus(),
      ])
      setMicStatus(m)
      setAccessibilityGranted(a)
    } catch { /* best-effort */ }
  }, [])

  useEffect(() => {
    refreshPermissions()
    const onFocus = () => refreshPermissions()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshPermissions])

  async function handleGrantMic() {
    const ok = await window.electronAPI.requestMicPermission()
    if (ok) { setMicStatus('granted'); return }
    const next = await window.electronAPI.getMicPermissionStatus()
    setMicStatus(next)
    if (next !== 'granted') window.electronAPI.openMicSettings()
  }

  async function handleGrantAccessibility() {
    const ok = await window.electronAPI.requestAccessibility()
    setAccessibilityGranted(ok)
    if (!ok) window.electronAPI.openAccessibilitySettings()
  }

  useEffect(() => {
    loadAudioDevices()
    // Load persisted settings
    window.electronAPI.getWidgetPosition().then((v: string) => {
      if (v === 'center' || v === 'right') setWidgetPosition(v)
    })
    window.electronAPI.getSoundFeedback().then((v: boolean) => {
      setSoundFeedback(v)
    })
    window.electronAPI.getInputLanguage().then((v: string) => {
      if (v === 'en' || v === 'hinglish') setInputLanguage(v)
    })
    window.electronAPI.getDictationKey().then((v: string) => {
      if (v === 'fn' || v === 'right-option') setDictationKey(v)
    })
    window.electronAPI.getActivationMode().then((v: string) => {
      if (v === 'tap-toggle' || v === 'push-to-talk' || v === 'double-tap-push') setActivationMode(v)
    })
    window.electronAPI.getGroqKeyStatus().then((s) => {
      setGroqKeyMasked(s.hasKey ? s.masked : null)
    })
    window.electronAPI.getUsage().then(setUsage).catch(() => {})
    window.electronAPI.getSTTProvider().then((v: string) => {
      setUseCloudSTT(v !== 'local')
    })
    window.electronAPI.getWhisperModelStatus().then(setWhisperModelReady).catch(() => {})
    window.electronAPI.onWhisperDownloadProgress((p: number) => setWhisperProgress(p))
    return () => {
      window.electronAPI.removeAllListeners('whisper:download-progress')
    }
  }, [])

  async function handleResetUsage() {
    if (usageResetting) return
    setUsageResetting(true)
    try {
      const fresh = await window.electronAPI.resetUsage()
      setUsage(fresh)
    } catch {
      /* ignore — best-effort */
    } finally {
      setUsageResetting(false)
    }
  }

  async function handleSaveKey() {
    const key = groqKeyInput.trim()
    if (!key || keyBusy) return
    setKeyBusy(true)
    setKeyMsg(null)
    try {
      const test = await window.electronAPI.testGroqKey(key)
      if (!test.ok) {
        setKeyMsg({ text: test.error || 'Invalid key', type: 'err' })
        return
      }
      const res = await window.electronAPI.setGroqKey(key)
      if (res.success) {
        setGroqKeyMasked(res.masked ?? null)
        setGroqKeyInput('')
        setKeyMsg({ text: 'Key saved securely.', type: 'ok' })
      } else {
        setKeyMsg({ text: res.error || 'Failed to save key', type: 'err' })
      }
    } catch {
      setKeyMsg({ text: 'Something went wrong', type: 'err' })
    } finally {
      setKeyBusy(false)
    }
  }

  function handleRemoveKey() {
    window.electronAPI.clearGroqKey()
    setGroqKeyMasked(null)
    setGroqKeyInput('')
    setKeyMsg(null)
  }

  async function loadAudioDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${d.deviceId.slice(0, 8)}` }))
      setAudioDevices(audioInputs)
      if (audioInputs.length > 0 && !selectedDevice) {
        setSelectedDevice(audioInputs[0].deviceId)
      }
    } catch (err) {
      console.error('Failed to enumerate audio devices:', err)
    }
  }

  function handleWidgetPositionChange(value: string) {
    const pos = value as 'center' | 'right'
    setWidgetPosition(pos)
    window.electronAPI.setWidgetPosition(pos)
  }

  function handleSoundFeedbackChange(value: boolean) {
    setSoundFeedback(value)
    window.electronAPI.setSoundFeedback(value)
  }

  function handleInputLanguageChange(value: string) {
    const lang = value as 'en' | 'hinglish'
    setInputLanguage(lang)
    window.electronAPI.setInputLanguage(lang)
  }

  function handleDictationKeyChange(value: string) {
    const key = value as 'fn' | 'right-option'
    setDictationKey(key)
    window.electronAPI.setDictationKey(key)
    onDictationKeyChange?.(key)
  }

  function handleActivationModeChange(value: string) {
    const mode = value as 'tap-toggle' | 'push-to-talk' | 'double-tap-push'
    setActivationMode(mode)
    window.electronAPI.setActivationMode(mode)
  }

  function handleCloudSTTChange(value: boolean) {
    setUseCloudSTT(value)
    window.electronAPI.setSTTProvider(value ? 'cloud' : 'local')
  }

  async function handleDownloadWhisper() {
    if (whisperDownloading) return
    setWhisperDownloading(true)
    setWhisperProgress(0)
    try {
      const res = await window.electronAPI.downloadWhisperModel()
      if (res.success) setWhisperModelReady(true)
    } catch { /* swallow — UI stays in idle state */ }
    finally {
      setWhisperDownloading(false)
    }
  }

  return (
    <div className="max-w-lg">
      <h2 className="font-display text-[22px] font-bold text-ink tracking-tight mb-6">Settings</h2>

      {/* ═══ Permissions ═══ */}
      <SectionHeader icon={<ShieldIcon />} title="Permissions" />
      <div className="bg-surface-2 border border-border rounded-2xl overflow-hidden mb-3 shadow-sm">
        <PermissionRow
          title="Microphone"
          description="So unmute can hear what you say. Required."
          granted={micGranted}
          statusText={micGranted ? 'Granted' : micStatus === 'denied' || micStatus === 'restricted' ? 'Denied' : 'Not granted'}
          primary={!micGranted ? { label: 'Grant', onClick: handleGrantMic } : null}
          secondary={micStatus === 'denied' || micStatus === 'restricted' ? { label: 'Open Settings', onClick: () => window.electronAPI.openMicSettings() } : null}
        />
        <PermissionRow
          title="Accessibility"
          description="Lets unmute detect your shortcut keys and paste at the cursor. Required."
          granted={accessibilityGranted}
          statusText={accessibilityGranted ? 'Granted' : 'Not granted'}
          primary={!accessibilityGranted ? { label: 'Grant', onClick: handleGrantAccessibility } : null}
          secondary={!accessibilityGranted ? { label: "I've enabled it", onClick: refreshPermissions } : null}
          divider
        />
        <div className="px-5 py-4 border-t border-border">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-warm-soft text-warm flex items-center justify-center shrink-0 mt-0.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h0M10 10h0M14 10h0M18 10h0M6 14h12"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-semibold text-ink">Free up the Fn key</p>
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-35">Recommended</span>
              </div>
              <p className="text-[12px] text-ink-60 leading-relaxed mt-1.5">
                By default macOS uses the <span className="font-mono text-ink">Fn</span> key to show emoji or trigger Apple's own Dictation. To use it for unmute, open Keyboard Settings and set <span className="font-semibold text-ink">"Press 🌐 key to"</span> → <span className="font-semibold text-ink">"Do Nothing"</span>.
              </p>
              <div className="mt-3">
                <button
                  onClick={() => window.electronAPI.openKeyboardSettings()}
                  className="px-3 py-1.5 rounded-full border border-border text-[11px] font-semibold text-ink-60 hover:bg-cream-mid hover:border-border-md transition-all"
                >
                  Open Keyboard Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Groq API Key */}
      <SectionHeader icon={<KeyIcon />} title="Groq API Key" />
      <div className="bg-surface-2 border border-border rounded-2xl overflow-hidden mb-3 shadow-sm">
        <div className="px-5 py-4">
          {groqKeyMasked ? (
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-[7px] h-[7px] rounded-full bg-green-500" />
                <span className="text-[13px] font-medium text-ink">Connected</span>
                <span className="text-[12px] text-ink-35 font-mono">{groqKeyMasked}</span>
              </div>
              <button
                onClick={handleRemoveKey}
                className="text-[12px] font-medium text-ink-60 hover:text-red-500 transition-colors px-2 py-1"
              >
                Remove
              </button>
            </div>
          ) : (
            <p className="text-[12px] text-ink-60 mb-3">
              unmute uses your own Groq key — it stays on this Mac, encrypted in the Keychain.
            </p>
          )}

          <div className="flex items-center gap-2">
            <input
              type="password"
              value={groqKeyInput}
              onChange={(e) => setGroqKeyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveKey() }}
              placeholder={groqKeyMasked ? 'Paste a new key to replace' : 'gsk_...'}
              spellCheck={false}
              autoComplete="off"
              className="flex-1 bg-cream-mid border border-border-md rounded-[10px] px-3.5 py-2 text-[12px] font-mono text-ink outline-none focus:border-ink/30 transition-colors"
            />
            <button
              onClick={handleSaveKey}
              disabled={!groqKeyInput.trim() || keyBusy}
              className="px-4 py-2 rounded-[10px] text-[12px] font-semibold bg-ink text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              {keyBusy ? 'Checking…' : 'Save'}
            </button>
          </div>

          <div className="flex items-center justify-between mt-2.5">
            <button
              onClick={() => window.electronAPI.openExternal('https://console.groq.com/keys')}
              className="text-[11px] text-ink-35 hover:text-ink transition-colors underline underline-offset-2"
            >
              Get a free API key →
            </button>
            {keyMsg && (
              <span className={`text-[11px] font-medium ${keyMsg.type === 'ok' ? 'text-green-600' : 'text-red-500'}`}>
                {keyMsg.text}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Usage ═══ */}
      <SectionHeader icon={<UsageIcon />} title="Usage" />
      <div className="bg-surface-2 border border-border rounded-2xl overflow-hidden mb-3 shadow-sm">
        <div className="px-5 py-4">
          {/* Window selector */}
          <div className="flex justify-center mb-4">
            <SegmentedControl
              options={[
                { value: 'today', label: 'Today' },
                { value: 'month', label: 'This month' },
                { value: 'allTime', label: 'All time' },
              ]}
              value={usageWindow}
              onChange={(v) => setUsageWindow(v as 'today' | 'month' | 'allTime')}
            />
          </div>

          {/* Selected-window estimated cost */}
          <div className="text-center mb-4">
            <p className="text-[34px] font-bold text-ink tabular-nums tracking-tight leading-none">
              {fmtUsd(usage?.[usageWindow].cost)}
            </p>
            <p className="text-[10px] font-medium text-ink-35 uppercase tracking-[0.1em] mt-1.5">
              Estimated spend
            </p>
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-2 gap-2.5">
            <UsageDetail
              label="Total tokens"
              value={fmtCount(usage ? usage[usageWindow].inputTokens + usage[usageWindow].outputTokens : undefined)}
            />
            <UsageDetail label="Duration" value={fmtDuration(usage?.[usageWindow].sttSeconds)} />
            <UsageDetail label="Input tokens" value={fmtCount(usage?.[usageWindow].inputTokens)} />
            <UsageDetail label="Output tokens" value={fmtCount(usage?.[usageWindow].outputTokens)} />
          </div>

          <div className="flex items-center justify-between mt-4">
            <p className="text-[11px] text-ink-35 leading-snug pr-3">
              Estimated from Groq pricing — actual charges may differ. Local
              transcription and other providers aren’t counted.
            </p>
            <button
              onClick={handleResetUsage}
              disabled={usageResetting}
              className="text-[11px] font-medium text-ink-60 hover:text-red-500 transition-colors px-2 py-1 whitespace-nowrap disabled:opacity-40"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* ═══ Dark Hero: Keyboard Shortcuts ═══ */}
      <div className="bg-ink rounded-[20px] mb-3 overflow-hidden shadow-lg relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.04)_0%,transparent_50%)] pointer-events-none" />
        <div className="px-6 pt-5">
          <div className="text-[9px] font-bold tracking-[0.12em] uppercase text-white/28 mb-1">⌨ Keyboard Shortcuts</div>
          <div className="text-[18px] font-extrabold tracking-tight text-white/90">Your triggers</div>
        </div>
        <div className="p-5 pt-4 flex flex-col gap-2.5">
          {/* Dictation */}
          <div className="px-4 py-3.5 bg-white/[0.055] border border-white/[0.08] rounded-[13px]">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-[13px] font-medium text-white/88 mb-0.5">Dictation trigger</h4>
                <p className="text-[11px] text-white/36">
                  {activationMode === 'tap-toggle' && 'Tap to start, tap again to stop'}
                  {activationMode === 'push-to-talk' && 'Hold to record, release to submit'}
                  {activationMode === 'double-tap-push' && 'Double-tap for hands-free, or hold for push-to-talk'}
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <MiniWave />
                <HeroKey>{dictationKey === 'fn' ? 'Fn' : 'Right Opt'}</HeroKey>
              </div>
            </div>
            {/* Dictation key selector */}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-white/44">Dictation key</span>
              <SegmentedControlDark
                options={[
                  { value: 'fn', label: 'Fn (Globe)' },
                  { value: 'right-option', label: 'Right Option' },
                ]}
                value={dictationKey}
                onChange={handleDictationKeyChange}
              />
            </div>
            {/* Activation mode selector */}
            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-[11px] text-white/44">Activation mode</span>
              <SegmentedControlDark
                options={[
                  { value: 'tap-toggle', label: 'Tap toggle' },
                  { value: 'push-to-talk', label: 'Push to talk' },
                  { value: 'double-tap-push', label: 'Dual mode' },
                ]}
                value={activationMode}
                onChange={handleActivationModeChange}
              />
            </div>
          </div>
          {/* Instruction */}
          <div className="flex items-center justify-between px-4 py-3.5 bg-white/[0.055] border border-white/[0.08] rounded-[13px] hover:bg-white/[0.085] transition-colors">
            <div>
              <h4 className="text-[13px] font-medium text-white/88 mb-0.5">Instruction trigger</h4>
              <p className="text-[11px] text-white/36">Tap to start, tap again to instruct AI</p>
            </div>
            <div className="flex items-center gap-2.5">
              <MiniWave />
              <HeroKey variant="red">Control</HeroKey>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Audio ═══ */}
      <SectionHeader icon={<MicIcon />} title="Audio" />
      <div className="bg-surface-2 border border-border rounded-2xl overflow-hidden mb-3 shadow-sm">
        <SettingRow label="Microphone" description="Select your input device">
          <div className="relative inline-flex items-center">
            <select
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
              className="appearance-none bg-cream-mid border border-border-md rounded-full px-3.5 py-2 pr-8 text-[12px] font-medium text-ink outline-none cursor-pointer shadow-sm min-w-[180px]"
            >
              {audioDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
            <span className="absolute right-3 text-[13px] text-ink-35 pointer-events-none">⌄</span>
          </div>
        </SettingRow>
      </div>

      {/* ═══ Behavior ═══ */}
      <SectionHeader icon={<BehaviorIcon />} title="Behavior" />
      <div className="bg-surface-2 border border-border rounded-2xl overflow-hidden mb-3 shadow-sm">
        <SettingRow
          label="Use Groq cloud transcription"
          description={
            useCloudSTT
              ? 'Fast cloud transcription via Groq. Requires API key + internet.'
              : whisperModelReady
                ? 'On-device whisper.cpp. Works offline, slower than cloud.'
                : 'On-device whisper.cpp — model not downloaded yet.'
          }
        >
          <Toggle checked={useCloudSTT} onChange={handleCloudSTTChange} />
        </SettingRow>
        {!useCloudSTT && !whisperModelReady && (
          <div className="px-4 pb-3 -mt-1 flex items-center gap-3">
            {whisperDownloading ? (
              <span className="text-[12px] text-ink-60">
                Downloading model{whisperProgress > 0 ? ` — ${Math.round(whisperProgress)}%` : '…'}
              </span>
            ) : (
              <button
                onClick={handleDownloadWhisper}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white hover:opacity-90 transition-opacity"
              >
                Download model (~75MB)
              </button>
            )}
          </div>
        )}
        <SettingRow label="Output mode" description="How output is delivered">
          <SegmentedControl
            options={[
              { value: 'paste', label: 'Paste at cursor' },
              { value: 'clipboard', label: 'Clipboard' },
            ]}
            value={outputMode}
            onChange={(v) => setOutputMode(v as 'paste' | 'clipboard')}
          />
        </SettingRow>
        <SettingRow label="Sound feedback" description="Play sounds on start / stop">
          <Toggle checked={soundFeedback} onChange={handleSoundFeedbackChange} />
        </SettingRow>
        <SettingRow label="Input language" description={inputLanguage === 'hinglish' ? "Hinglish mode \u2014 Hindi + English mix, output in Roman script" : "English \u2014 standard dictation"}>
          <SegmentedControl
            options={[
              { value: 'en', label: 'English' },
              { value: 'hinglish', label: 'Hinglish' },
            ]}
            value={inputLanguage}
            onChange={handleInputLanguageChange}
          />
        </SettingRow>
        <SettingRow label="Auto-punctuation" description="Add punctuation automatically">
          <Toggle checked={autoPunctuation} onChange={setAutoPunctuation} />
        </SettingRow>
        <SettingRow label="Launch at login" description="Start Unmute when you log in">
          <Toggle checked={launchAtLogin} onChange={setLaunchAtLogin} />
        </SettingRow>
      </div>

      {/* ═══ Appearance ═══ */}
      <SectionHeader icon={<AppearanceIcon />} title="Appearance" />
      <div className="bg-surface-2 border border-border rounded-2xl overflow-hidden mb-3 shadow-sm">
        <SettingRow label="Widget position" description="Where the pill appears on screen">
          <SegmentedControl
            options={[
              { value: 'center', label: 'Top center' },
              { value: 'right', label: 'Top right' },
            ]}
            value={widgetPosition}
            onChange={handleWidgetPositionChange}
          />
        </SettingRow>
      </div>

      {/* ═══ Help ═══ */}
      <SectionHeader icon={<BehaviorIcon />} title="Help" />
      <div className="bg-surface-2 border border-border rounded-2xl overflow-hidden mb-3 shadow-sm">
        <SettingRow label="Replay onboarding" description="Walk through the welcome and setup steps again">
          <button
            onClick={() => {
              localStorage.removeItem('unmute_onboarding_complete')
              location.reload()
            }}
            className="px-4 py-2 rounded-full border border-border text-[12px] font-semibold text-ink-60 hover:bg-cream-mid hover:border-border-md transition-all duration-200"
          >
            Replay
          </button>
        </SettingRow>
      </div>
    </div>
  )
}

/* ─── Sub-components ─── */

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2.5 mt-5">
      <span className="text-ink-35">{icon}</span>
      <h3 className="text-[9px] font-bold text-ink-35 uppercase tracking-[0.11em]">{title}</h3>
    </div>
  )
}

/** Format an estimated USD amount; tiny sub-cent totals show as "<$0.01". */
function fmtUsd(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n <= 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(2)
}

/** Compact count: 1234 → "1.2K", 1_200_000 → "1.2M". Undefined → "—". */
function fmtCount(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

/** Audio seconds → "Xs" / "X.X min" / "Xh Ym". Undefined → "—". */
function fmtDuration(seconds: number | undefined): string {
  if (seconds === undefined) return '—'
  if (seconds < 60) return Math.round(seconds) + 's'
  if (seconds < 3600) return (seconds / 60).toFixed(1).replace(/\.0$/, '') + ' min'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function UsageDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-cream-mid border border-border rounded-[12px] px-3.5 py-2.5 flex items-center justify-between">
      <span className="text-[11px] font-medium text-ink-60">{label}</span>
      <span className="text-[13px] font-bold text-ink tabular-nums tracking-tight">{value}</span>
    </div>
  )
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-border last:border-b-0">
      <div>
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <p className="text-[11px] text-ink-35 mt-0.5">{description}</p>
      </div>
      <div>{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (val: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-[38px] h-[22px] rounded-full transition-all duration-200 relative shrink-0 ${
        checked ? 'bg-ink' : 'bg-cream-dark'
      }`}
    >
      <div
        className={`w-[18px] h-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.18)] absolute top-[2px] transition-transform duration-200 ${
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  )
}

function SegmentedControl({ options, value, onChange }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex bg-cream-mid border border-border rounded-[9px] p-[3px] gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-120 ${
            value === opt.value
              ? 'bg-ink text-white shadow-sm'
              : 'text-ink-60 hover:text-ink'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function SegmentedControlDark({ options, value, onChange }: {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex bg-white/[0.06] border border-white/[0.08] rounded-[9px] p-[3px] gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all duration-120 ${
            value === opt.value
              ? 'bg-white/[0.14] text-white shadow-sm'
              : 'text-white/36 hover:text-white/60'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function HeroKey({ children, variant }: { children: React.ReactNode; variant?: 'red' }) {
  if (variant === 'red') {
    return (
      <span className="inline-flex items-center justify-center text-[12px] font-extrabold text-white rounded-[9px] px-3 py-1.5 min-h-[36px] min-w-[44px] select-none whitespace-nowrap bg-gradient-to-b from-[#F04040] to-[#C02020] border border-black/40 shadow-[0_4px_0_#7a1010,0_6px_14px_rgba(200,30,30,0.35),inset_0_1px_0_rgba(255,255,255,0.22)]">
        {children}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center justify-center text-[12px] font-extrabold text-white/90 rounded-[9px] px-3 py-1.5 min-h-[36px] min-w-[44px] select-none whitespace-nowrap bg-gradient-to-b from-white/[0.14] to-white/[0.06] border border-white/16 shadow-[0_4px_0_rgba(0,0,0,0.45),0_6px_14px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.18)]">
      {children}
    </span>
  )
}

function MiniWave() {
  const bars = [
    { d: '0.55s', h: '6px' },
    { d: '0.70s', h: '14px', delay: '0.1s' },
    { d: '0.60s', h: '10px', delay: '0.05s' },
    { d: '0.80s', h: '18px', delay: '0.15s' },
    { d: '0.65s', h: '8px', delay: '0.08s' },
    { d: '0.75s', h: '16px', delay: '0.12s' },
  ]
  return (
    <div className="flex items-center gap-[3px] h-[18px] opacity-30">
      {bars.map((bar, i) => (
        <div
          key={i}
          className="w-[3px] rounded-sm bg-white"
          style={{
            animation: `wv ${bar.d} ease-in-out infinite alternate`,
            animationDelay: bar.delay || '0s',
            height: '4px',
          }}
        />
      ))}
      <style>{`@keyframes wv { from { height: 4px; } to { height: var(--h, 14px); } }`}</style>
    </div>
  )
}

/* ─── Icons ─── */

function MicIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2a2.5 2.5 0 0 1 0 5M5.5 2a5 5 0 0 0 0 5M8 7v6M5 13h6" />
    </svg>
  )
}

function KeyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="5.5" r="3" />
      <path d="M7.6 7.6l5 5M11 11l1.5-1.5M13 13l1-1" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14.5s5.5-2.5 5.5-7V3.5L8 1.5 2.5 3.5V7.5c0 4.5 5.5 7 5.5 7z" />
      <polyline points="5.5 8 7 9.5 10.5 6" />
    </svg>
  )
}

/** Row inside the Permissions card — status pill + actions on the right. */
function PermissionRow({
  title, description, granted, statusText, primary, secondary, divider,
}: {
  title: string
  description: string
  granted: boolean
  statusText: string
  primary: { label: string; onClick: () => void } | null
  secondary: { label: string; onClick: () => void } | null
  divider?: boolean
}) {
  return (
    <div className={`px-5 py-4 flex items-start gap-3 ${divider ? 'border-t border-border' : ''}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${granted ? 'bg-success-soft text-success' : 'bg-ink-07 text-ink-35'}`}>
        {granted ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold text-ink">{title}</p>
          <span className={`text-[10px] font-bold uppercase tracking-wider ${granted ? 'text-success' : 'text-ink-35'}`}>{statusText}</span>
        </div>
        <p className="text-[12px] text-ink-60 leading-relaxed mt-1.5">{description}</p>
        {(primary || secondary) && (
          <div className="flex items-center gap-2 mt-3">
            {primary && (
              <button onClick={primary.onClick} className="px-3 py-1.5 rounded-full bg-ink text-white text-[11px] font-semibold hover:opacity-90 transition-opacity">
                {primary.label}
              </button>
            )}
            {secondary && (
              <button onClick={secondary.onClick} className="px-3 py-1.5 rounded-full border border-border text-[11px] font-semibold text-ink-60 hover:bg-cream-mid hover:border-border-md transition-all">
                {secondary.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function UsageIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1v14M11 4H6.5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4H5" />
    </svg>
  )
}

function BehaviorIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z" />
      <path d="M8 5v4l2 2" />
    </svg>
  )
}

function AppearanceIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="5" />
      <path d="M8 3V1M8 15v-2M3 8H1M15 8h-2" />
    </svg>
  )
}
