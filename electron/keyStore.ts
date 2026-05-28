// ─── Secure API key storage (macOS Keychain via Electron safeStorage) ───
// The user's Groq API key is encrypted at rest with the OS keychain and never
// written in plaintext. Only the main process touches it; the renderer only
// ever sees whether a key is set and a masked preview.

import { app, safeStorage } from 'electron'
import path from 'path'
import fs from 'fs'

function keyFilePath(): string {
  return path.join(app.getPath('userData'), 'groq-key.enc')
}

let cached: string | null = null
let loaded = false

/** Load + decrypt the stored key into memory (once). */
function load(): void {
  if (loaded) return
  loaded = true
  try {
    const file = keyFilePath()
    if (!fs.existsSync(file)) return
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[keyStore] OS encryption unavailable — cannot read stored key')
      return
    }
    const encrypted = fs.readFileSync(file)
    cached = safeStorage.decryptString(encrypted)
  } catch (err) {
    console.error('[keyStore] Failed to load key:', err instanceof Error ? err.message : err)
    cached = null
  }
}

/** Returns the decrypted Groq API key, or null if none is set. */
export function getApiKey(): string | null {
  load()
  return cached
}

/** Whether a key is currently stored. */
export function hasApiKey(): boolean {
  return !!getApiKey()
}

/**
 * Encrypt + persist the key (or clear it when given an empty string).
 * Throws if OS encryption is unavailable.
 */
export function setApiKey(key: string): void {
  const trimmed = key.trim()
  if (!trimmed) {
    clearApiKey()
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption is unavailable — cannot store API key securely')
  }
  const encrypted = safeStorage.encryptString(trimmed)
  fs.writeFileSync(keyFilePath(), encrypted)
  cached = trimmed
  loaded = true
  console.log('[keyStore] API key saved (encrypted)')
}

/** Delete the stored key. */
export function clearApiKey(): void {
  try {
    const file = keyFilePath()
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch (err) {
    console.error('[keyStore] Failed to clear key:', err instanceof Error ? err.message : err)
  }
  cached = null
  loaded = true
}

/** A masked preview for the UI, e.g. "gsk_••••1234". Null if no key. */
export function getMaskedKey(): string | null {
  const key = getApiKey()
  if (!key) return null
  const prefix = key.startsWith('gsk_') ? 'gsk_' : key.slice(0, 4)
  const last4 = key.slice(-4)
  return `${prefix}••••${last4}`
}
