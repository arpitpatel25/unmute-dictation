// ─── Local LLM Server Manager ───
// Persistent llama-server singleton for offline text transformation and Quick Chat.
// Same pattern as whisper.ts — spawns binary, polls health, stays alive for app lifetime.

import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'

const MODEL_URL = 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf'
const MODEL_FILENAME = 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf'
const SERVER_PORT = 18789
const SERVER_HOST = '127.0.0.1'

type ProgressCallback = (progress: number) => void

export interface ChatMessage {
  role: string
  content: string
}

export interface ChatOptions {
  temperature?: number
  max_tokens?: number
}

export interface ChatStreamCallbacks {
  onToken: (token: string) => void
  onDone: (fullResponse: string) => void
  onError: (error: string) => void
}

class LocalLLMManager {
  private modelsDir: string | null = null
  private downloading = false
  private serverProcess: ChildProcess | null = null
  private serverReady = false
  private serverStarting = false

  private getModelsDir(): string {
    if (!this.modelsDir) {
      this.modelsDir = path.join(app.getPath('userData'), 'models')
      if (!fs.existsSync(this.modelsDir)) {
        fs.mkdirSync(this.modelsDir, { recursive: true })
      }
    }
    return this.modelsDir
  }

  /** Resolve the llama-server binary path */
  getServerBinaryPath(): string | null {
    const candidates = [
      path.join(app.getAppPath(), 'resources', 'bin', 'llama-server'),
      path.join(process.resourcesPath || '', 'bin', 'llama-server'),
      path.join(__dirname, '..', '..', 'resources', 'bin', 'llama-server'),
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    console.error('[local-llm] llama-server binary not found. Run: npm run compile:llama')
    return null
  }

  /** Get the model file path */
  getModelPath(): string {
    return path.join(this.getModelsDir(), MODEL_FILENAME)
  }

  /** Check if model is downloaded and ready (at least 1GB for a Q4_K_M GGUF) */
  isModelReady(): boolean {
    const modelPath = this.getModelPath()
    if (!fs.existsSync(modelPath)) return false
    const stat = fs.statSync(modelPath)
    return stat.size > 1_000_000_000
  }

  /** Check if llama-server binary is available */
  isBinaryReady(): boolean {
    return this.getServerBinaryPath() !== null
  }

  /** Check if the persistent server is running and ready */
  isServerRunning(): boolean {
    return this.serverReady && this.serverProcess !== null && !this.serverProcess.killed
  }

  /** Start the persistent llama-server process. Call once at app startup. */
  async startServer(): Promise<void> {
    if (this.isServerRunning()) {
      console.log('[local-llm] Server already running')
      return
    }

    if (this.serverStarting) {
      console.log('[local-llm] Server already starting...')
      return
    }

    const serverBinary = this.getServerBinaryPath()
    if (!serverBinary) {
      console.error('[local-llm] Cannot start server — binary not found')
      return
    }

    if (!this.isModelReady()) {
      console.error('[local-llm] Cannot start server — model not downloaded')
      return
    }

    this.serverStarting = true
    const modelPath = this.getModelPath()
    const binDir = path.dirname(serverBinary)
    const libDir = path.join(binDir, '..', 'lib')

    console.log('[local-llm] Starting persistent llama-server...')
    console.log('[local-llm]   Binary:', serverBinary)
    console.log('[local-llm]   Model:', modelPath)
    console.log('[local-llm]   Port:', SERVER_PORT)

    const proc = spawn(serverBinary, [
      '-m', modelPath,
      '--host', SERVER_HOST,
      '--port', String(SERVER_PORT),
      '-ngl', '99',           // Offload all layers to Metal GPU
      '-c', '4096',           // Context window
      '-t', '4',              // CPU threads
      '-fa', 'on',            // Flash attention (Metal optimization)
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DYLD_LIBRARY_PATH: libDir,
      }
    })

    this.serverProcess = proc

    // Wait for the server to be ready by polling the HTTP health endpoint
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false

        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true
            reject(new Error('llama-server startup timed out (60s)'))
          }
        }, 60_000) // 60s timeout — GPU model loading is slower

        // Log stderr during startup for debugging
        proc.stderr?.on('data', (chunk: Buffer) => {
          const line = chunk.toString().trim()
          if (line) console.log('[local-llm:stderr]', line)
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
            reject(new Error(`llama-server exited during startup with code ${code}`))
          } else {
            console.log('[local-llm] Server exited unexpectedly with code', code)
            this.serverReady = false
            this.serverProcess = null
          }
        })

        // Poll /health endpoint every 500ms until it responds with status "ok"
        const poll = () => {
          if (settled) return

          const req = http.get(`http://${SERVER_HOST}:${SERVER_PORT}/health`, (res) => {
            let data = ''
            res.on('data', (chunk: Buffer) => { data += chunk.toString() })
            res.on('end', () => {
              if (settled) return
              try {
                const json = JSON.parse(data)
                if (json.status === 'ok') {
                  settled = true
                  clearTimeout(timeout)
                  this.serverReady = true
                  this.serverStarting = false
                  console.log('[local-llm] Server ready on port', SERVER_PORT)
                  resolve()
                } else {
                  // Model still loading
                  setTimeout(poll, 500)
                }
              } catch {
                // Health endpoint returned non-JSON — retry
                setTimeout(poll, 500)
              }
            })
          })

          req.on('error', () => {
            if (!settled) setTimeout(poll, 500)
          })

          req.setTimeout(2000, () => {
            req.destroy()
            if (!settled) setTimeout(poll, 500)
          })
        }

        // Start polling after a brief delay
        setTimeout(poll, 1000)
      })
    } catch (err) {
      this.serverStarting = false
      this.serverReady = false
      try { proc.kill() } catch {}
      this.serverProcess = null
      console.error('[local-llm] Server startup failed:', err instanceof Error ? err.message : err)
      throw err
    }
  }

  /** Stop the persistent server. Call on app quit. */
  stopServer(): void {
    if (this.serverProcess) {
      console.log('[local-llm] Stopping server...')
      this.serverProcess.kill('SIGTERM')
      this.serverProcess = null
      this.serverReady = false
    }
  }

  /** Download the model from HuggingFace with progress callback */
  async downloadModel(onProgress?: ProgressCallback): Promise<void> {
    if (this.downloading) {
      console.log('[local-llm] Model download already in progress')
      return
    }

    if (this.isModelReady()) {
      console.log('[local-llm] Model already downloaded:', this.getModelPath())
      onProgress?.(100)
      return
    }

    this.downloading = true
    const modelPath = this.getModelPath()
    const tempPath = modelPath + '.tmp'

    console.log('[local-llm] Downloading model from:', MODEL_URL)
    console.log('[local-llm] Saving to:', modelPath)

    try {
      await new Promise<void>((resolve, reject) => {
        const download = (url: string, redirectCount = 0) => {
          if (redirectCount > 5) {
            reject(new Error('Too many redirects'))
            return
          }

          const protocol = url.startsWith('https') ? https : require('http')
          protocol.get(url, (res: any) => {
            // Follow redirects (HuggingFace uses CDN redirects)
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
              const redirectUrl = res.headers.location
              console.log('[local-llm] Redirecting to:', redirectUrl?.substring(0, 80))
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
                console.log('[local-llm] Model download complete:', modelPath)
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
      console.error('[local-llm] Model download failed:', err instanceof Error ? err.message : err)
      try { fs.unlinkSync(tempPath) } catch {}
      throw err
    } finally {
      this.downloading = false
    }
  }

  /**
   * Non-streaming chat completion. Sends messages to the local llama-server
   * via its OpenAI-compatible /v1/chat/completions endpoint.
   */
  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
    signal?: AbortSignal
  ): Promise<string> {
    if (!this.isServerRunning()) {
      console.log('[local-llm] Server not running, attempting to start...')
      await this.startServer()
    }

    const t0 = Date.now()
    const body = JSON.stringify({
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.max_tokens ?? 2048,
      stream: false,
    })

    const response = await new Promise<string>((resolve, reject) => {
      const req = http.request({
        hostname: SERVER_HOST,
        port: SERVER_PORT,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 60_000,
      }, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`llama-server HTTP ${res.statusCode}: ${data.slice(0, 300)}`))
            return
          }
          try {
            const json = JSON.parse(data)
            const content = json.choices?.[0]?.message?.content || ''
            resolve(content.trim())
          } catch {
            reject(new Error('Failed to parse llama-server response'))
          }
        })
      })

      req.on('error', (err) => {
        reject(new Error(`llama-server request failed: ${err.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('llama-server request timed out (60s)'))
      })

      if (signal) {
        signal.addEventListener('abort', () => {
          req.destroy()
          reject(new Error('Request aborted'))
        }, { once: true })
      }

      req.write(body)
      req.end()
    })

    const totalMs = Date.now() - t0
    console.log(`[local-llm] ⏱ chat: ${totalMs}ms | response: ${response.length} chars`)

    return response
  }

  /**
   * Streaming chat completion. Sends messages to the local llama-server
   * and parses SSE deltas, calling onToken for each token.
   */
  async chatStream(
    messages: ChatMessage[],
    options: ChatOptions = {},
    callbacks: ChatStreamCallbacks,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.isServerRunning()) {
      console.log('[local-llm] Server not running, attempting to start...')
      await this.startServer()
    }

    const t0 = Date.now()
    const body = JSON.stringify({
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.max_tokens ?? 1024,
      stream: true,
    })

    return new Promise<void>((resolve, reject) => {
      const req = http.request({
        hostname: SERVER_HOST,
        port: SERVER_PORT,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 120_000,
      }, (res) => {
        if (res.statusCode !== 200) {
          let errData = ''
          res.on('data', (chunk: Buffer) => { errData += chunk.toString() })
          res.on('end', () => {
            const msg = `llama-server HTTP ${res.statusCode}: ${errData.slice(0, 300)}`
            callbacks.onError(msg)
            reject(new Error(msg))
          })
          return
        }

        let buffer = ''
        let fullContent = ''

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) {
                fullContent += delta
                callbacks.onToken(delta)
              }
            } catch {
              // Skip unparseable SSE chunks
            }
          }
        })

        res.on('end', () => {
          const totalMs = Date.now() - t0
          console.log(`[local-llm] ⏱ chatStream: ${totalMs}ms | tokens: ${fullContent.length} chars`)
          callbacks.onDone(fullContent)
          resolve()
        })

        res.on('error', (err) => {
          callbacks.onError(err.message)
          reject(err)
        })
      })

      req.on('error', (err) => {
        callbacks.onError(err.message)
        reject(new Error(`llama-server stream request failed: ${err.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        const msg = 'llama-server stream request timed out (120s)'
        callbacks.onError(msg)
        reject(new Error(msg))
      })

      if (signal) {
        signal.addEventListener('abort', () => {
          req.destroy()
          reject(new Error('Stream aborted'))
        }, { once: true })
      }

      req.write(body)
      req.end()
    })
  }
}

export const localLLMManager = new LocalLLMManager()
