import { spawn, execSync, ChildProcess } from 'child_process'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'
import { getFFmpegPath } from './ffmpeg'

const SERVER_PORT = 18788
const SERVER_HOST = '127.0.0.1'

class FasterWhisperManager {
  private serverProcess: ChildProcess | null = null
  private serverReady = false
  private serverStarting = false

  /** Resolve the Python binary path (venv first, then system fallback) */
  getPythonPath(): string | null {
    const candidates = [
      // Venv in project resources (development)
      path.join(app.getAppPath(), 'resources', 'faster-whisper', 'venv', 'bin', 'python3'),
      // Venv relative to __dirname (development fallback)
      path.join(__dirname, '..', '..', 'resources', 'faster-whisper', 'venv', 'bin', 'python3'),
      // Packaged app
      path.join(process.resourcesPath || '', 'faster-whisper', 'venv', 'bin', 'python3'),
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    return null
  }

  /** Resolve the server.py script path */
  getServerScriptPath(): string | null {
    const candidates = [
      path.join(app.getAppPath(), 'resources', 'faster-whisper', 'server.py'),
      path.join(__dirname, '..', '..', 'resources', 'faster-whisper', 'server.py'),
      path.join(process.resourcesPath || '', 'faster-whisper', 'server.py'),
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    return null
  }

  /** Check if faster-whisper Python package is installed in the venv */
  isDependencyReady(): boolean {
    const python = this.getPythonPath()
    if (!python) return false
    try {
      execSync(`"${python}" -c "import faster_whisper"`, {
        timeout: 5000,
        stdio: 'ignore',
      })
      return true
    } catch {
      return false
    }
  }

  /** Check if server.py script exists */
  isScriptReady(): boolean {
    return this.getServerScriptPath() !== null
  }

  /** Check if everything is ready to run (deps + script) */
  isReady(): boolean {
    return this.isDependencyReady() && this.isScriptReady()
  }

  /** Check if the persistent server is running and ready */
  isServerRunning(): boolean {
    return this.serverReady && this.serverProcess !== null && !this.serverProcess.killed
  }

  /** Start the persistent faster-whisper server process */
  async startServer(): Promise<void> {
    if (this.isServerRunning()) {
      console.log('[faster-whisper] Server already running')
      return
    }

    if (this.serverStarting) {
      console.log('[faster-whisper] Server already starting...')
      return
    }

    const pythonPath = this.getPythonPath()
    if (!pythonPath) {
      console.error('[faster-whisper] Cannot start server — Python venv not found. Run: npm run setup:faster-whisper')
      throw new Error('Python venv not found')
    }

    const scriptPath = this.getServerScriptPath()
    if (!scriptPath) {
      console.error('[faster-whisper] Cannot start server — server.py not found')
      throw new Error('server.py not found')
    }

    const ffmpegPath = getFFmpegPath()
    if (!ffmpegPath) {
      console.error('[faster-whisper] Cannot start server — ffmpeg not found')
      throw new Error('ffmpeg not found')
    }

    this.serverStarting = true

    console.log('[faster-whisper] Starting server...')
    console.log('[faster-whisper]   Python:', pythonPath)
    console.log('[faster-whisper]   Script:', scriptPath)
    console.log('[faster-whisper]   FFmpeg:', ffmpegPath)
    console.log('[faster-whisper]   Port:', SERVER_PORT)

    const proc = spawn(pythonPath, [
      scriptPath,
      '--port', String(SERVER_PORT),
      '--host', SERVER_HOST,
      '--ffmpeg-path', ffmpegPath,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this.serverProcess = proc

    // Wait for the server to be ready by polling the HTTP endpoint
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false

        // 60s timeout — first run downloads the model (~75MB)
        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true
            reject(new Error('faster-whisper server startup timed out (60s)'))
          }
        }, 60_000)

        // Forward stdout for debugging
        proc.stdout?.on('data', (data: Buffer) => {
          const line = data.toString().trim()
          if (line) console.log('[faster-whisper:stdout]', line)
        })

        // Forward stderr for debugging
        proc.stderr?.on('data', (data: Buffer) => {
          const line = data.toString().trim()
          if (line) console.log('[faster-whisper:stderr]', line)
        })

        proc.on('error', (err) => {
          if (!settled) {
            settled = true
            clearTimeout(timeout)
            this.serverStarting = false
            reject(err)
          }
        })

        proc.on('exit', (code) => {
          if (!settled) {
            settled = true
            clearTimeout(timeout)
            this.serverReady = false
            this.serverStarting = false
            this.serverProcess = null
            reject(new Error(`faster-whisper server exited during startup with code ${code}`))
          } else {
            console.log('[faster-whisper] Server exited unexpectedly with code', code)
            this.serverReady = false
            this.serverProcess = null
          }
        })

        // Poll HTTP endpoint every 500ms until it responds
        const poll = () => {
          if (settled) return

          const req = http.get(`http://${SERVER_HOST}:${SERVER_PORT}/`, (res) => {
            res.resume()
            if (!settled) {
              settled = true
              clearTimeout(timeout)
              this.serverReady = true
              this.serverStarting = false
              console.log('[faster-whisper] Server ready on port', SERVER_PORT)
              resolve()
            }
          })

          req.on('error', () => {
            if (!settled) setTimeout(poll, 500)
          })

          req.setTimeout(2000, () => {
            req.destroy()
            if (!settled) setTimeout(poll, 500)
          })
        }

        // Start polling after a brief delay (give Python time to start)
        setTimeout(poll, 1000)
      })
    } catch (err) {
      this.serverStarting = false
      this.serverReady = false
      try { proc.kill() } catch {}
      this.serverProcess = null
      console.error('[faster-whisper] Server startup failed:', err instanceof Error ? err.message : err)
      throw err
    }
  }

  /** Stop the persistent server. Call on app quit. */
  stopServer(): void {
    if (this.serverProcess) {
      console.log('[faster-whisper] Stopping server...')
      this.serverProcess.kill('SIGTERM')
      this.serverProcess = null
      this.serverReady = false
    }
  }

  /** Transcribe audio buffer via the faster-whisper server */
  async transcribe(audioBuffer: Buffer): Promise<string> {
    // If server is running, use it
    if (this.isServerRunning()) {
      return this.transcribeViaServer(audioBuffer)
    }

    // Server not running — try to start it
    console.log('[faster-whisper] Server not running, attempting to start...')
    await this.startServer()
    return this.transcribeViaServer(audioBuffer)
  }

  /** Send audio to the faster-whisper server via HTTP POST */
  private async transcribeViaServer(audioBuffer: Buffer): Promise<string> {
    const t0 = Date.now()

    // Build multipart/form-data manually (same pattern as whisper.ts)
    const boundary = '----FasterWhisperBoundary' + Date.now()
    const parts: Buffer[] = []

    // File field
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
      `Content-Type: audio/webm\r\n\r\n`
    ))
    parts.push(audioBuffer instanceof Buffer ? audioBuffer : Buffer.from(audioBuffer))
    parts.push(Buffer.from('\r\n'))

    // End boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`))

    const body = Buffer.concat(parts)

    const transcript = await new Promise<string>((resolve, reject) => {
      const req = http.request({
        hostname: SERVER_HOST,
        port: SERVER_PORT,
        path: '/inference',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
        timeout: 30_000,
      }, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`faster-whisper server HTTP ${res.statusCode}: ${data.slice(0, 200)}`))
            return
          }
          try {
            const json = JSON.parse(data)
            resolve((json.text || '').trim())
          } catch {
            resolve(data.trim())
          }
        })
      })

      req.on('error', (err) => {
        reject(new Error(`faster-whisper server request failed: ${err.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('faster-whisper server request timed out (30s)'))
      })

      req.write(body)
      req.end()
    })

    const totalMs = Date.now() - t0
    console.log(`[faster-whisper] server transcribe: ${totalMs}ms`)

    return transcript
  }
}

export const fasterWhisperManager = new FasterWhisperManager()
