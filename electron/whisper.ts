import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import { LOCAL_STT_IDLE_SHUTDOWN_MS } from './config'

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin'
const MODEL_FILENAME = 'ggml-tiny.en.bin'
const SERVER_PORT = 18787
const SERVER_HOST = '127.0.0.1'

type ProgressCallback = (progress: number) => void

class WhisperManager {
  private modelsDir: string | null = null
  private downloading = false
  private serverProcess: ChildProcess | null = null
  private serverReady = false
  private serverStarting = false
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  /** Whether the on-device fallback can run right now (binary + model present). */
  isAvailable(): boolean {
    return this.isBinaryReady() && this.isModelReady()
  }

  /** Reset the idle-shutdown timer — called after each transcription. */
  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      if (this.isServerRunning()) {
        console.log('[whisper] Idle timeout — shutting down on-device server to free memory')
        this.stopServer()
      }
    }, LOCAL_STT_IDLE_SHUTDOWN_MS)
  }

  private getModelsDir(): string {
    if (!this.modelsDir) {
      this.modelsDir = path.join(app.getPath('userData'), 'models')
      if (!fs.existsSync(this.modelsDir)) {
        fs.mkdirSync(this.modelsDir, { recursive: true })
      }
    }
    return this.modelsDir
  }

  /** Resolve the whisper-server binary path */
  getServerBinaryPath(): string | null {
    const candidates = [
      path.join(app.getAppPath(), 'resources', 'bin', 'whisper-server'),
      path.join(process.resourcesPath || '', 'bin', 'whisper-server'),
      path.join(__dirname, '..', '..', 'resources', 'bin', 'whisper-server'),
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    console.error('[whisper] whisper-server binary not found. Run: npm run compile:whisper')
    return null
  }

  /** Resolve the whisper-cli binary path (fallback) */
  getBinaryPath(): string | null {
    const candidates = [
      path.join(app.getAppPath(), 'resources', 'bin', 'whisper-cli'),
      path.join(process.resourcesPath || '', 'bin', 'whisper-cli'),
      path.join(__dirname, '..', '..', 'resources', 'bin', 'whisper-cli'),
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    return null
  }

  /** Get the model file path */
  getModelPath(): string {
    return path.join(this.getModelsDir(), MODEL_FILENAME)
  }

  /** Check if model is downloaded and ready */
  isModelReady(): boolean {
    const modelPath = this.getModelPath()
    if (!fs.existsSync(modelPath)) return false
    const stat = fs.statSync(modelPath)
    return stat.size > 10_000_000 // At least 10MB
  }

  /** Check if whisper-server binary is available */
  isBinaryReady(): boolean {
    return this.getServerBinaryPath() !== null || this.getBinaryPath() !== null
  }

  /** Check if the persistent server is running and ready */
  isServerRunning(): boolean {
    return this.serverReady && this.serverProcess !== null && !this.serverProcess.killed
  }

  /** Start the persistent whisper-server process. Call once at app startup. */
  async startServer(): Promise<void> {
    if (this.isServerRunning()) {
      console.log('[whisper] Server already running')
      return
    }

    if (this.serverStarting) {
      console.log('[whisper] Server already starting...')
      return
    }

    const serverBinary = this.getServerBinaryPath()
    if (!serverBinary) {
      console.error('[whisper] Cannot start server — binary not found')
      return
    }

    if (!this.isModelReady()) {
      console.error('[whisper] Cannot start server — model not downloaded')
      return
    }

    this.serverStarting = true
    const modelPath = this.getModelPath()
    const binDir = path.dirname(serverBinary)
    const libDir = path.join(binDir, '..', 'lib')
    const tmpDir = app.getPath('temp')

    console.log('[whisper] Starting persistent whisper-server...')
    console.log('[whisper]   Binary:', serverBinary)
    console.log('[whisper]   Model:', modelPath)
    console.log('[whisper]   Port:', SERVER_PORT)

    const proc = spawn(serverBinary, [
      '-m', modelPath,
      '--host', SERVER_HOST,
      '--port', String(SERVER_PORT),
      '--convert',             // Auto-convert WebM→WAV via ffmpeg
      '--tmp-dir', tmpDir,     // Temp dir for ffmpeg conversions
      '--no-timestamps',       // Clean text output
      '-t', '4',               // 4 threads
      '-l', 'en',              // English
      '-bs', '1',              // Greedy decoding
      '-bo', '1',              // Best-of 1
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DYLD_LIBRARY_PATH: libDir,
      }
    })

    this.serverProcess = proc

    // Wait for the server to be ready by polling the HTTP endpoint
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false // true once promise is resolved or rejected

        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true
            reject(new Error('whisper-server startup timed out (15s)'))
          }
        }, 15_000)

        // Silently consume stderr during startup
        proc.stderr?.on('data', () => {})

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
            // Exit during startup — reject the promise
            settled = true
            clearTimeout(timeout)
            this.serverReady = false
            this.serverStarting = false
            this.serverProcess = null
            reject(new Error(`whisper-server exited during startup with code ${code}`))
          } else {
            // Exit after startup (unexpected crash) — just clean up state
            console.log('[whisper] Server exited unexpectedly with code', code)
            this.serverReady = false
            this.serverProcess = null
          }
        })

        // Poll HTTP endpoint every 300ms until it responds
        const poll = () => {
          if (settled) return

          const req = http.get(`http://${SERVER_HOST}:${SERVER_PORT}/`, (res) => {
            res.resume() // Drain the response
            if (!settled) {
              settled = true
              clearTimeout(timeout)
              this.serverReady = true
              this.serverStarting = false
              console.log('[whisper] Server ready on port', SERVER_PORT)
              resolve()
            }
          })

          req.on('error', () => {
            // Server not ready yet — retry
            if (!settled) setTimeout(poll, 300)
          })

          req.setTimeout(1000, () => {
            req.destroy()
            if (!settled) setTimeout(poll, 300)
          })
        }

        // Start polling after a brief delay (give process time to start)
        setTimeout(poll, 500)
      })
    } catch (err) {
      this.serverStarting = false
      this.serverReady = false
      // Kill process if it's still running after startup failure
      try { proc.kill() } catch {}
      this.serverProcess = null
      console.error('[whisper] Server startup failed:', err instanceof Error ? err.message : err)
      throw err
    }
  }

  /** Stop the persistent server. Call on app quit. */
  stopServer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.serverProcess) {
      console.log('[whisper] Stopping server...')
      this.serverProcess.kill('SIGTERM')
      this.serverProcess = null
      this.serverReady = false
    }
  }

  /** Download the model from HuggingFace with progress callback */
  async downloadModel(onProgress?: ProgressCallback): Promise<void> {
    if (this.downloading) {
      console.log('[whisper] Model download already in progress')
      return
    }

    if (this.isModelReady()) {
      console.log('[whisper] Model already downloaded:', this.getModelPath())
      onProgress?.(100)
      return
    }

    this.downloading = true
    const modelPath = this.getModelPath()
    const tempPath = modelPath + '.tmp'

    console.log('[whisper] Downloading model from:', MODEL_URL)
    console.log('[whisper] Saving to:', modelPath)

    try {
      await new Promise<void>((resolve, reject) => {
        const download = (url: string, redirectCount = 0) => {
          if (redirectCount > 5) {
            reject(new Error('Too many redirects'))
            return
          }

          const protocol = url.startsWith('https') ? https : require('http')
          protocol.get(url, (res: any) => {
            // Follow redirects
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
              const redirectUrl = res.headers.location
              console.log('[whisper] Redirecting to:', redirectUrl)
              download(redirectUrl, redirectCount + 1)
              return
            }

            if (res.statusCode !== 200) {
              reject(new Error(`Download failed: HTTP ${res.statusCode}`))
              return
            }

            const totalBytes = parseInt(res.headers['content-length'] || '0', 10)
            let downloadedBytes = 0

            const file = fs.createWriteStream(tempPath)

            res.on('data', (chunk: Buffer) => {
              downloadedBytes += chunk.length
              file.write(chunk)
              if (totalBytes > 0) {
                const progress = Math.round((downloadedBytes / totalBytes) * 100)
                onProgress?.(progress)
              }
            })

            res.on('end', () => {
              file.end()
              file.on('finish', () => {
                fs.renameSync(tempPath, modelPath)
                console.log('[whisper] Model download complete:', modelPath)
                onProgress?.(100)
                resolve()
              })
            })

            res.on('error', (err: Error) => {
              file.destroy()
              try { fs.unlinkSync(tempPath) } catch {}
              reject(err)
            })
          }).on('error', (err: Error) => {
            reject(err)
          })
        }

        download(MODEL_URL)
      })
    } catch (err) {
      console.error('[whisper] Model download failed:', err instanceof Error ? err.message : err)
      try { fs.unlinkSync(tempPath) } catch {}
      throw err
    } finally {
      this.downloading = false
    }
  }

  /**
   * Transcribe audio using the persistent whisper-server.
   * Sends the raw WebM/Opus buffer directly — server handles conversion via --convert.
   */
  async transcribe(audioBuffer: Buffer): Promise<string> {
    // Keep the server alive while in active use; idle timer kills it later
    this.touchIdle()

    // If server is running, use it (fast path — no model loading)
    if (this.isServerRunning()) {
      return this.transcribeViaServer(audioBuffer)
    }

    // Server not running — try to start it
    console.log('[whisper] Server not running, attempting to start...')
    try {
      await this.startServer()
      return this.transcribeViaServer(audioBuffer)
    } catch {
      console.warn('[whisper] Server failed to start, falling back to whisper-cli')
      return this.transcribeViaCLI(audioBuffer)
    }
  }

  /** Send audio to the persistent whisper-server via HTTP POST */
  private async transcribeViaServer(audioBuffer: Buffer): Promise<string> {
    const t0 = Date.now()

    // Build multipart/form-data manually (Node.js doesn't have FormData with Blob in older versions)
    const boundary = '----WhisperBoundary' + Date.now()
    const parts: Buffer[] = []

    // File field
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
      `Content-Type: audio/webm\r\n\r\n`
    ))
    parts.push(audioBuffer instanceof Buffer ? audioBuffer : Buffer.from(audioBuffer))
    parts.push(Buffer.from('\r\n'))

    // response_format field
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
      `json\r\n`
    ))

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
            reject(new Error(`whisper-server HTTP ${res.statusCode}: ${data.slice(0, 200)}`))
            return
          }
          try {
            const json = JSON.parse(data)
            resolve((json.text || '').trim())
          } catch {
            // Fallback: try to extract text directly
            resolve(data.trim())
          }
        })
      })

      req.on('error', (err) => {
        reject(new Error(`whisper-server request failed: ${err.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('whisper-server request timed out (30s)'))
      })

      req.write(body)
      req.end()
    })

    const totalMs = Date.now() - t0
    console.log(`[whisper] ⏱ server transcribe: ${totalMs}ms`)

    return transcript
  }

  /** Fallback: spawn whisper-cli for a single transcription (used if server fails) */
  private async transcribeViaCLI(audioBuffer: Buffer): Promise<string> {
    const binaryPath = this.getBinaryPath()
    if (!binaryPath) {
      throw new Error('whisper-cli binary not found. Run: npm run compile:whisper')
    }

    if (!this.isModelReady()) {
      throw new Error('Whisper model not downloaded yet')
    }

    const modelPath = this.getModelPath()
    const { getFFmpegPath } = await import('./ffmpeg')
    const ffmpegPath = getFFmpegPath()
    if (!ffmpegPath) {
      throw new Error('ffmpeg binary not found')
    }

    // Convert WebM to WAV
    const tempDir = app.getPath('temp')
    const inputPath = path.join(tempDir, `whisper-input-${Date.now()}.webm`)
    const wavPath = path.join(tempDir, `whisper-output-${Date.now()}.wav`)

    const t0 = Date.now()
    fs.writeFileSync(inputPath, audioBuffer)

    try {
      // ffmpeg conversion
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ffmpegPath, [
          '-i', inputPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', wavPath
        ], { stdio: ['ignore', 'pipe', 'pipe'] })

        let stderr = ''
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg error: ${stderr.slice(-200)}`)))
        proc.on('error', reject)
      })

      // whisper-cli inference
      const binDir = path.dirname(binaryPath)
      const libDir = path.join(binDir, '..', 'lib')

      const transcript = await new Promise<string>((resolve, reject) => {
        const proc = spawn(binaryPath, [
          '-m', modelPath, '-f', wavPath,
          '--no-timestamps', '--no-prints', '-l', 'en', '-t', '4', '-bs', '1', '-bo', '1',
        ], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, DYLD_LIBRARY_PATH: libDir }
        })

        let stdout = ''
        let stderr = ''
        proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        proc.on('exit', (code) => {
          if (code === 0) resolve(stdout.trim())
          else reject(new Error(`whisper-cli error: ${stderr.slice(-300)}`))
        })
        proc.on('error', reject)
        setTimeout(() => { proc.kill(); reject(new Error('whisper-cli timed out')) }, 30_000)
      })

      console.log(`[whisper] ⏱ CLI fallback: ${Date.now() - t0}ms`)
      return transcript
    } finally {
      try { fs.unlinkSync(inputPath) } catch {}
      try { fs.unlinkSync(wavPath) } catch {}
    }
  }
}

export const whisperManager = new WhisperManager()
