import { EventEmitter } from 'events'
import { keyListener, KeyEvent } from './keyListener'

export type SessionMode = 'dictation' | 'instruction'
export type KeyboardEvent =
  | { type: 'session-start'; mode: SessionMode }
  | { type: 'session-stop'; mode: SessionMode }
  | { type: 'chain-start'; mode: SessionMode }
  | { type: 'chain-expired' }
  | { type: 'quick-chat-toggle' }

export type DictationKey = 'fn' | 'right-option'
export type ActivationMode = 'tap-toggle' | 'push-to-talk' | 'double-tap-push'

// Double-tap-push state machine states
type DualModeState = 'idle' | 'held' | 'awaiting-second' | 'push-recording' | 'hands-free'

class KeyboardManager extends EventEmitter {
  private dictationActive = false
  private instructionActive = false
  private chainTimer: NodeJS.Timeout | null = null
  private chainWindowMs = 2000
  private lastToggleTime = 0
  private readonly DEBOUNCE_MS = 300

  // Option+Space debounce for Quick Chat
  private lastOptionSpaceTime = 0
  private readonly OPTION_SPACE_DEBOUNCE_MS = 400

  // ─── Configurable dictation key + activation mode ───
  private dictationKey: DictationKey = 'fn'
  private activationMode: ActivationMode = 'tap-toggle'

  // Right Option buffering (resolves conflict with Option+Space)
  private rightOptionBuffer: NodeJS.Timeout | null = null
  private readonly RIGHT_OPTION_BUFFER_MS = 150

  // Double-tap-push (dual mode) state
  private dualState: DualModeState = 'idle'
  private dualHoldTimer: NodeJS.Timeout | null = null
  private dualDoubleTapTimer: NodeJS.Timeout | null = null
  private readonly DUAL_HOLD_MS = 400
  private readonly DUAL_DOUBLE_TAP_MS = 400

  start(): void {
    keyListener.on('key', (event: KeyEvent) => this.handleKey(event))
    const started = keyListener.start()
    if (started) {
      console.log('[keyboard] Key listener started')
    } else {
      console.warn('[keyboard] Key listener failed to start — hotkeys will not work')
    }
  }

  stop(): void {
    this.clearChainTimer()
    this.clearRightOptionBuffer()
    this.clearDualTimers()
    keyListener.stop()
  }

  /** Reset internal state — call when session ends externally (cancel, Escape, processing complete).
   *  This prevents stale dictationActive/instructionActive flags from causing ghost toggles. */
  resetState(): void {
    console.log('[keyboard] State RESET (was dictationActive:', this.dictationActive, 'instructionActive:', this.instructionActive, ')')
    this.dictationActive = false
    this.instructionActive = false
    this.clearChainTimer()
    this._chainPending = false
    this._chainMode = null
    this.clearRightOptionBuffer()
    this.clearDualTimers()
    this.dualState = 'idle'
  }

  setChainWindow(ms: number): void {
    this.chainWindowMs = ms
  }

  setDictationKey(key: DictationKey): void {
    console.log('[keyboard] Dictation key set to:', key)
    this.dictationKey = key
  }

  getDictationKey(): DictationKey {
    return this.dictationKey
  }

  setActivationMode(mode: ActivationMode): void {
    console.log('[keyboard] Activation mode set to:', mode)
    this.activationMode = mode
    // Reset dual-mode state when switching modes
    this.clearDualTimers()
    this.dualState = 'idle'
  }

  getActivationMode(): ActivationMode {
    return this.activationMode
  }

  handleKey(event: KeyEvent): void {
    console.log('[keyboard] Raw key event:', event, '| dictationActive:', this.dictationActive, '| instructionActive:', this.instructionActive)
    switch (event) {
      case 'fn-down':
        if (this.dictationKey === 'fn') {
          this.handleDictationKeyDown()
        }
        break
      case 'fn-up':
        if (this.dictationKey === 'fn') {
          this.handleDictationKeyUp()
        }
        break
      case 'right-option-down':
        if (this.dictationKey === 'right-option') {
          // Buffer right-option-down to resolve conflict with Option+Space
          this.clearRightOptionBuffer()
          this.rightOptionBuffer = setTimeout(() => {
            this.rightOptionBuffer = null
            this.handleDictationKeyDown()
          }, this.RIGHT_OPTION_BUFFER_MS)
        }
        break
      case 'right-option-up':
        if (this.dictationKey === 'right-option') {
          if (this.rightOptionBuffer) {
            // Buffer hasn't fired yet — still could be Option+Space
            // Let the buffer expire naturally or be cancelled by option-space
            // But we need to handle key-up for push-to-talk modes
            // Store that key-up happened during buffer
            this.clearRightOptionBuffer()
            // Key was released before buffer expired — this was a very quick tap
            // For tap-toggle this would be a down+up quickly, treat as tap
            this.handleDictationKeyDown()
            // Immediately follow with key-up for push-to-talk
            this.handleDictationKeyUp()
          } else {
            this.handleDictationKeyUp()
          }
        }
        break
      case 'caps-down':
      case 'caps-up':
        // Caps Lock is a toggle key — macOS alternates between CAPS_DOWN and CAPS_UP
        // on each physical press (reflecting LED state, not press/release).
        // So both events represent a physical key press → treat both as toggle.
        this.handleInstructionToggle()
        break
      case 'option-space':
        // Cancel any pending right-option buffer — Option+Space takes priority
        this.clearRightOptionBuffer()
        this.handleOptionSpace()
        break
    }
  }

  // ─── Dictation key-down/up dispatchers ───
  // Route to the correct activation mode handler

  private handleDictationKeyDown(): void {
    switch (this.activationMode) {
      case 'tap-toggle':
        this.handleTapToggleDown()
        break
      case 'push-to-talk':
        this.handlePushToTalkDown()
        break
      case 'double-tap-push':
        this.handleDualModeDown()
        break
    }
  }

  private handleDictationKeyUp(): void {
    switch (this.activationMode) {
      case 'tap-toggle':
        // Tap-toggle ignores key-up
        break
      case 'push-to-talk':
        this.handlePushToTalkUp()
        break
      case 'double-tap-push':
        this.handleDualModeUp()
        break
    }
  }

  // ─── Tap-toggle mode (existing behavior) ───

  private handleTapToggleDown(): void {
    const now = Date.now()
    if (!this.dictationActive && now - this.lastToggleTime < this.DEBOUNCE_MS) {
      console.log('[keyboard] Dictation toggle DEBOUNCED (too fast)')
      return
    }
    this.lastToggleTime = now

    if (this.dictationActive) {
      this.stopDictation()
    } else {
      this.startDictation()
    }
  }

  // ─── Push-to-talk mode ───

  private handlePushToTalkDown(): void {
    const now = Date.now()
    if (this.dictationActive) return // Already recording
    if (now - this.lastToggleTime < this.DEBOUNCE_MS) {
      console.log('[keyboard] Push-to-talk DEBOUNCED (too fast)')
      return
    }
    this.lastToggleTime = now
    this.startDictation()
  }

  private handlePushToTalkUp(): void {
    if (this.dictationActive) {
      this.stopDictation()
    }
  }

  // ─── Double-tap-push (dual) mode state machine ───
  // idle → key-down → held (start 400ms hold timer)
  //   held + timer expires → push-recording (startDictation, release to stop)
  //   held + key-up before timer → awaiting-second (start 400ms double-tap window)
  //     awaiting-second + key-down → hands-free (startDictation, tap to stop)
  //     awaiting-second + timer expires → idle (single tap = no-op)
  //   push-recording + key-up → stopDictation → idle
  //   hands-free + key-down → stopDictation → idle

  private handleDualModeDown(): void {
    const now = Date.now()

    switch (this.dualState) {
      case 'idle': {
        if (now - this.lastToggleTime < this.DEBOUNCE_MS) {
          console.log('[keyboard] Dual mode DEBOUNCED (too fast)')
          return
        }
        this.lastToggleTime = now
        this.dualState = 'held'
        console.log('[keyboard] Dual mode: idle → held')
        this.dualHoldTimer = setTimeout(() => {
          this.dualHoldTimer = null
          if (this.dualState === 'held') {
            // Hold timer expired — this is a push-to-talk hold
            this.dualState = 'push-recording'
            console.log('[keyboard] Dual mode: held → push-recording (hold expired, starting dictation)')
            this.startDictation()
          }
        }, this.DUAL_HOLD_MS)
        break
      }
      case 'awaiting-second': {
        // Second tap arrived within double-tap window → hands-free mode
        this.clearDualTimers()
        this.dualState = 'hands-free'
        console.log('[keyboard] Dual mode: awaiting-second → hands-free (double-tap, starting dictation)')
        this.startDictation()
        break
      }
      case 'hands-free': {
        // Tap to stop in hands-free mode
        console.log('[keyboard] Dual mode: hands-free → idle (tap to stop)')
        this.dualState = 'idle'
        this.stopDictation()
        break
      }
      default:
        break
    }
  }

  private handleDualModeUp(): void {
    switch (this.dualState) {
      case 'held': {
        // Key released before hold timer — transition to awaiting-second
        this.clearDualTimers()
        this.dualState = 'awaiting-second'
        console.log('[keyboard] Dual mode: held → awaiting-second')
        this.dualDoubleTapTimer = setTimeout(() => {
          this.dualDoubleTapTimer = null
          if (this.dualState === 'awaiting-second') {
            // No second tap arrived — single tap = no-op
            console.log('[keyboard] Dual mode: awaiting-second → idle (double-tap window expired)')
            this.dualState = 'idle'
          }
        }, this.DUAL_DOUBLE_TAP_MS)
        break
      }
      case 'push-recording': {
        // Release to stop in push-to-talk sub-mode
        console.log('[keyboard] Dual mode: push-recording → idle (released, stopping dictation)')
        this.dualState = 'idle'
        this.stopDictation()
        break
      }
      case 'hands-free':
        // Ignore key-up in hands-free mode (stop happens on next key-down)
        break
      default:
        break
    }
  }

  private clearDualTimers(): void {
    if (this.dualHoldTimer) {
      clearTimeout(this.dualHoldTimer)
      this.dualHoldTimer = null
    }
    if (this.dualDoubleTapTimer) {
      clearTimeout(this.dualDoubleTapTimer)
      this.dualDoubleTapTimer = null
    }
  }

  // ─── Shared dictation start/stop helpers ───
  // Contains all the chain logic, used by all activation modes

  private startDictation(): void {
    // If instruction is active, this is a DIRECT chain from instruction → dictation
    if (this.instructionActive) {
      this.instructionActive = false
      console.log('[keyboard] Instruction STOPPED (direct chain to dictation)')
      this.emit('keyboard', { type: 'session-stop', mode: 'instruction' } as KeyboardEvent)

      // Direct chain — don't use timer, just start dictation as chain
      this.dictationActive = true
      console.log('[keyboard] Dictation CHAIN-START (direct)')
      this.emit('keyboard', { type: 'chain-start', mode: 'dictation' } as KeyboardEvent)
      return
    }

    // Clear any pending chain timer
    this.clearChainTimer()

    const chainResult = this.wasChainPending('dictation')
    if (chainResult === 'chain') {
      // Cross-mode chain: instruction stopped, now dictation pressed within 2s
      this.dictationActive = true
      console.log('[keyboard] Dictation CHAIN-START')
      this.emit('keyboard', { type: 'chain-start', mode: 'dictation' } as KeyboardEvent)
    } else if (chainResult === 'same-mode-restart') {
      // Same-mode re-press during chain window — just process immediately (expire chain)
      console.log('[keyboard] Same-mode re-press — expiring chain immediately (process now)')
      this.emit('keyboard', { type: 'chain-expired' } as KeyboardEvent)
    } else {
      // Fresh start — no chain was pending
      this.dictationActive = true
      console.log('[keyboard] Dictation SESSION-START')
      this.emit('keyboard', { type: 'session-start', mode: 'dictation' } as KeyboardEvent)
    }
  }

  private stopDictation(): void {
    this.dictationActive = false
    console.log('[keyboard] Dictation STOPPED')
    this.emit('keyboard', { type: 'session-stop', mode: 'dictation' } as KeyboardEvent)

    // Process immediately — emit chain-expired to trigger processSession()
    console.log('[keyboard] Dictation done — processing immediately (no chain wait)')
    this.emit('keyboard', { type: 'chain-expired' } as KeyboardEvent)
  }

  // ─── Right Option buffer ───

  private clearRightOptionBuffer(): void {
    if (this.rightOptionBuffer) {
      clearTimeout(this.rightOptionBuffer)
      this.rightOptionBuffer = null
    }
  }

  // ─── Instruction toggle (unchanged) ───

  private handleInstructionToggle(): void {
    const now = Date.now()
    if (now - this.lastToggleTime < this.DEBOUNCE_MS) {
      console.log('[keyboard] Instruction toggle DEBOUNCED (too fast)')
      return
    }
    this.lastToggleTime = now

    if (this.instructionActive) {
      // Stop instruction
      this.instructionActive = false
      console.log('[keyboard] Instruction STOPPED')
      this.emit('keyboard', { type: 'session-stop', mode: 'instruction' } as KeyboardEvent)

      // Process immediately
      console.log('[keyboard] Instruction done — processing immediately (no chain wait)')
      this.emit('keyboard', { type: 'chain-expired' } as KeyboardEvent)
    } else {
      // If dictation is active, this is a DIRECT chain from dictation → instruction
      if (this.dictationActive) {
        this.dictationActive = false
        console.log('[keyboard] Dictation STOPPED (direct chain to instruction)')
        this.emit('keyboard', { type: 'session-stop', mode: 'dictation' } as KeyboardEvent)

        // Direct chain — start instruction as chain
        this.instructionActive = true
        console.log('[keyboard] Instruction CHAIN-START (direct)')
        this.emit('keyboard', { type: 'chain-start', mode: 'instruction' } as KeyboardEvent)
        return
      }

      // Clear any pending chain timer
      this.clearChainTimer()

      const chainResult = this.wasChainPending('instruction')
      if (chainResult === 'chain') {
        // Cross-mode chain: dictation stopped, now instruction pressed within 2s
        this.instructionActive = true
        console.log('[keyboard] Instruction CHAIN-START')
        this.emit('keyboard', { type: 'chain-start', mode: 'instruction' } as KeyboardEvent)
      } else if (chainResult === 'same-mode-restart') {
        // Same-mode re-press during chain window — just process immediately
        console.log('[keyboard] Same-mode re-press — expiring chain immediately (process now)')
        this.emit('keyboard', { type: 'chain-expired' } as KeyboardEvent)
      } else {
        // Fresh start
        this.instructionActive = true
        console.log('[keyboard] Instruction SESSION-START')
        this.emit('keyboard', { type: 'session-start', mode: 'instruction' } as KeyboardEvent)
      }
    }
  }

  // ─── Option+Space (Quick Chat — unchanged) ───

  private handleOptionSpace(): void {
    const now = Date.now()
    if (now - this.lastOptionSpaceTime < this.OPTION_SPACE_DEBOUNCE_MS) {
      console.log('[keyboard] Option+Space DEBOUNCED (too fast)')
      return
    }
    this.lastOptionSpaceTime = now

    // If dictation or instruction is active, ignore (don't interfere with recording)
    if (this.dictationActive || this.instructionActive) {
      console.log('[keyboard] Option+Space ignored — recording is active')
      return
    }

    console.log('[keyboard] Option+Space detected — Quick Chat toggle')
    this.emit('keyboard', { type: 'quick-chat-toggle' } as KeyboardEvent)
  }

  // ─── Chain timer logic (unchanged) ───

  private _chainPending = false
  // Track which mode started the chain, so same-mode "chains" are treated as new sessions
  private _chainMode: SessionMode | null = null

  private startChainTimer(mode: SessionMode): void {
    this.clearChainTimer()
    this._chainPending = true
    this._chainMode = mode
    this.chainTimer = setTimeout(() => {
      this._chainPending = false
      this._chainMode = null
      this.chainTimer = null
      this.emit('keyboard', { type: 'chain-expired' } as KeyboardEvent)
    }, this.chainWindowMs)
  }

  private clearChainTimer(): void {
    if (this.chainTimer) {
      clearTimeout(this.chainTimer)
      this.chainTimer = null
    }
  }

  /**
   * Check if a chain was pending and what kind of transition this is.
   * Returns:
   *  - 'none': no chain was pending — start fresh session
   *  - 'chain': cross-mode chain (e.g. dictation → instruction) — chain into same session
   *  - 'same-mode-restart': same-mode re-press (e.g. dictation → dictation) — process old, start new
   */
  private wasChainPending(newMode: SessionMode): 'none' | 'chain' | 'same-mode-restart' {
    const was = this._chainPending
    const prevMode = this._chainMode
    this._chainPending = false
    this._chainMode = null

    if (!was) return 'none'

    // Same mode → NOT a chain. Caller should process old session + start new one atomically.
    if (prevMode === newMode) {
      console.log('[keyboard] Same-mode re-press during chain window (', newMode, '→', newMode, ')')
      return 'same-mode-restart'
    }

    // Cross-mode → real chain
    return 'chain'
  }
}

export const keyboardManager = new KeyboardManager()
