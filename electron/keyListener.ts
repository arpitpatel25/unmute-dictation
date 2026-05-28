import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export type KeyEvent = 'fn-down' | 'fn-up' | 'caps-down' | 'caps-up' | 'right-option-down' | 'right-option-up' | 'option-space'

class KeyListener extends EventEmitter {
  private process: ChildProcess | null = null
  private restarting = false

  getBinaryPath(): string | null {
    // Check multiple locations (dev vs packaged)
    // In packaged app: binaries are in extraResources → Contents/Resources/bin/
    // In dev: binaries are in project root → resources/bin/
    const candidates = [
      // Packaged app: process.resourcesPath = .app/Contents/Resources
      path.join(process.resourcesPath || '', 'bin', 'globe-listener'),
      // Dev mode: relative to project root
      path.join(app.getAppPath(), 'resources', 'bin', 'globe-listener'),
      path.join(__dirname, '..', '..', 'resources', 'bin', 'globe-listener')
    ]

    for (const candidate of candidates) {
      console.log('[keyListener] Checking binary path:', candidate, '→', fs.existsSync(candidate) ? 'FOUND' : 'not found')
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    return null
  }

  start(): boolean {
    if (process.platform !== 'darwin') {
      console.log('[keyListener] Not macOS, skipping native key listener')
      return false
    }

    const binaryPath = this.getBinaryPath()
    if (!binaryPath) {
      console.error('[keyListener] Globe listener binary not found. Run: npm run compile:native')
      return false
    }

    // Ensure executable
    try {
      fs.chmodSync(binaryPath, 0o755)
    } catch {
      // Ignore chmod errors in packaged app
    }

    console.log('[keyListener] Starting globe listener:', binaryPath)

    this.process = spawn(binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let buffer = ''

    this.process.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        switch (trimmed) {
          case 'FN_DOWN':
            this.emit('key', 'fn-down' as KeyEvent)
            break
          case 'FN_UP':
            this.emit('key', 'fn-up' as KeyEvent)
            break
          case 'CAPS_DOWN':
            this.emit('key', 'caps-down' as KeyEvent)
            break
          case 'CAPS_UP':
            this.emit('key', 'caps-up' as KeyEvent)
            break
          case 'RIGHT_OPTION_DOWN':
            this.emit('key', 'right-option-down' as KeyEvent)
            break
          case 'RIGHT_OPTION_UP':
            this.emit('key', 'right-option-up' as KeyEvent)
            break
          case 'OPTION_SPACE':
            this.emit('key', 'option-space' as KeyEvent)
            break
          // PASTE_OK / COPY_OK are handled by sendCommand() listeners — ignore here
          case 'PASTE_OK':
          case 'COPY_OK':
            break
        }
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('[keyListener] stderr:', data.toString())
    })

    this.process.on('error', (err) => {
      console.error('[keyListener] Process error:', err.message)
      this.emit('error', err)
    })

    this.process.on('exit', (code) => {
      console.log('[keyListener] Process exited with code:', code)
      this.process = null
      // Auto-restart on unexpected exit (code null = killed, 0 = clean)
      if (!this.restarting && code !== 0 && code !== null) {
        this.restarting = true
        console.log('[keyListener] Will auto-restart in 2s...')
        setTimeout(() => {
          this.restarting = false
          this.start()
        }, 2000)
      }
    })

    // Handle EPIPE errors gracefully (happens when process is killed during write)
    this.process.stdout?.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EPIPE') return
      console.error('[keyListener] stdout error:', err.message)
    })
    this.process.stderr?.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EPIPE') return
      console.error('[keyListener] stderr error:', err.message)
    })

    return true
  }

  /**
   * Send a command to the globe-listener process via stdin.
   * Used for fast keystroke simulation (PASTE, COPY) without spawning
   * a new osascript process (~180ms → ~5ms).
   *
   * Returns a promise that resolves when the command is acknowledged
   * (PASTE_OK / COPY_OK) or rejects on timeout/error.
   */
  sendCommand(command: 'PASTE' | 'COPY'): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin || this.process.killed) {
        reject(new Error('Globe listener process not running'))
        return
      }

      const expectedResponse = `${command}_OK`
      const timeoutMs = 500

      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`${command} command timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      const onData = (data: Buffer) => {
        const lines = data.toString().split('\n')
        for (const line of lines) {
          if (line.trim() === expectedResponse) {
            cleanup()
            resolve()
            return
          }
        }
      }

      const cleanup = () => {
        clearTimeout(timeout)
        this.process?.stdout?.removeListener('data', onData)
      }

      // Listen for the response
      this.process.stdout?.on('data', onData)

      // Send the command
      this.process.stdin.write(command + '\n', (err) => {
        if (err) {
          cleanup()
          reject(err)
        }
      })
    })
  }

  /** Check if the globe-listener process is running and has stdin available. */
  isRunning(): boolean {
    return !!(this.process && !this.process.killed && this.process.stdin)
  }

  stop(): void {
    this.restarting = true
    if (this.process) {
      this.process.kill()
      this.process = null
    }
  }
}

export const keyListener = new KeyListener()
