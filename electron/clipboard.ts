import { clipboard, app } from 'electron'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import { keyListener } from './keyListener'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Get the path to the key-poster binary.
 * In packaged app: Contents/Resources/bin/key-poster
 * In dev: resources/bin/key-poster
 */
function getKeyPosterPath(): string | null {
  const candidates = [
    path.join(process.resourcesPath || '', 'bin', 'key-poster'),
    path.join(app.getAppPath(), 'resources', 'bin', 'key-poster'),
    path.join(__dirname, '..', '..', 'resources', 'bin', 'key-poster'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Simulate a keyboard shortcut. Three strategies (in priority order):
 *
 * 1. Globe-listener stdin (fastest ~5ms, sends CGEvent from globe-listener process)
 * 2. key-poster binary (fast ~15ms, spawns separate process with CGEvent)
 * 3. osascript fallback (slow ~180ms, spawns AppleScript process)
 *
 * In packaged apps, globe-listener's CGEvent may not have Accessibility permission
 * since it runs as a helper binary. key-poster and osascript spawn as child processes
 * of the main app and inherit its Accessibility grant.
 */
function simulateKeyCombo(key: string, modifier: string): Promise<void> {
  if (process.platform !== 'darwin') {
    return Promise.reject(new Error('Key simulation not implemented for this platform'))
  }

  const command = key === 'v' && modifier === 'command' ? 'PASTE' as const
    : key === 'c' && modifier === 'command' ? 'COPY' as const
    : null

  const keyPosterCmd = key === 'v' ? 'paste' : key === 'c' ? 'copy' : null

  // NOTE: Both globe-listener and key-poster use CGEvent.post() which fails
  // SILENTLY in packaged apps (event is dropped but no error is returned).
  // osascript via System Events is the only reliable method in packaged apps.
  // We try key-poster first (fast ~15ms) and verify it worked, falling back
  // to osascript (~180ms) if needed.

  // Use osascript for BOTH copy and paste — CGEvent via key-poster/globe-listener
  // silently drops events in packaged apps AND is unreliable for copy even in dev
  // (clipboard ends up empty despite key-poster reporting success).
  // osascript via System Events is the only reliable method.
  console.log(`[clipboard] Using osascript for ${key} (reliable path)`)
  return simulateViaOsascript(key, modifier)
}

function simulateViaKeyPoster(command: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!command) {
      reject(new Error('No key-poster command'))
      return
    }
    const binaryPath = getKeyPosterPath()
    if (!binaryPath) {
      reject(new Error('key-poster binary not found'))
      return
    }
    execFile(binaryPath, [command], (err) => {
      if (err) {
        reject(err)
      } else {
        console.log(`[clipboard] key-poster ${command} succeeded`)
        resolve()
      }
    })
  })
}

function simulateViaOsascript(key: string, modifier: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = `tell application "System Events" to keystroke "${key}" using ${modifier} down`
    // Use execFile to skip shell overhead (~10-20ms faster than exec)
    execFile('/usr/bin/osascript', ['-e', script], (err, _stdout, stderr) => {
      if (err) {
        console.error(`[clipboard] osascript error:`, err.message, stderr ? `stderr: ${stderr}` : '')
        reject(err)
      } else {
        console.log(`[clipboard] osascript ${key} succeeded`)
        resolve()
      }
    })
  })
}

/**
 * Try to capture selected text from the active application.
 *
 * Strategy:
 * 1. First, try simulating Cmd+C via globe-listener/osascript (requires Accessibility permission)
 * 2. If that fails, fall back to reading the current clipboard contents
 *    (user must have manually copied text with Cmd+C before triggering)
 *
 * @param useClipboardFallback If true, reads clipboard as fallback when osascript fails
 */
export async function captureSelectedText(useClipboardFallback: boolean = false): Promise<string | null> {
  try {
    // Save current clipboard content
    const savedClipboard = clipboard.readText()
    console.log('[clipboard] Current clipboard length:', savedClipboard.length)

    // Clear clipboard to detect if Cmd+C actually copies something new
    clipboard.writeText('')

    // Try to simulate Cmd+C
    try {
      await simulateKeyCombo('c', 'command')
      // Wait for clipboard to update
      await sleep(150)

      // Read the new clipboard content
      const selectedText = clipboard.readText()
      console.log('[clipboard] After Cmd+C, clipboard length:', selectedText.length, 'text:', selectedText ? JSON.stringify(selectedText.substring(0, 80)) : 'empty')

      // Restore original clipboard
      clipboard.writeText(savedClipboard)

      // If clipboard is still empty, nothing was selected
      if (!selectedText || selectedText.trim() === '') {
        console.log('[clipboard] No text was selected via Cmd+C')
        return null
      }

      return selectedText
    } catch {
      // Simulation failed — Accessibility not granted
      console.log('[clipboard] Cmd+C simulation failed (Accessibility permission needed)')

      // Restore clipboard (we cleared it above)
      clipboard.writeText(savedClipboard)

      // Fallback: use clipboard contents as context if requested
      if (useClipboardFallback && savedClipboard && savedClipboard.trim() !== '') {
        console.log('[clipboard] Using clipboard contents as context (fallback), length:', savedClipboard.length)
        console.log('[clipboard] Clipboard preview:', JSON.stringify(savedClipboard.substring(0, 100)))
        return savedClipboard
      }

      return null
    }
  } catch (err) {
    console.error('[clipboard] Failed to capture selected text:', err)
    return null
  }
}

/**
 * Ensure the output text has a leading and trailing space so it doesn't
 * collide with adjacent words when pasted inline. Skips padding if the
 * text already starts/ends with whitespace.
 */
function padOutput(text: string): string {
  if (!text) return text
  let padded = text
  if (!/^\s/.test(padded)) padded = ' ' + padded
  return padded
}

export async function injectOutput(text: string): Promise<void> {
  const padded = padOutput(text)
  // Always copy to clipboard first
  clipboard.writeText(padded)
  console.log('[clipboard] Output copied to clipboard (padded), length:', padded.length)

  // Try to simulate Cmd+V to auto-paste
  try {
    await simulateKeyCombo('v', 'command')
    console.log('[clipboard] Auto-paste via Cmd+V succeeded')
  } catch (err) {
    // Auto-paste failed — text is in clipboard, user can paste manually
    console.error('[clipboard] Auto-paste FAILED:', err instanceof Error ? err.message : err)
    console.log('[clipboard] Text is in clipboard, user can Cmd+V manually')
  }
}

export function copyToClipboard(text: string): void {
  const padded = padOutput(text)
  clipboard.writeText(padded)
  console.log('[clipboard] Text copied to clipboard (padded), length:', padded.length)
}
