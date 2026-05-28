// ─── Centralized Error Logger ───
// Broadcasts errors to the renderer's Developer tab (last error display).
// Keeps an in-memory list of recent errors (no disk persistence).

import { BrowserWindow } from 'electron'

export interface ErrorEntry {
  source: string
  message: string
  timestamp: string
}

const MAX_ERRORS = 50
const recentErrors: ErrorEntry[] = []

// Reference to the main window — set once during init
let mainWindowGetter: (() => BrowserWindow | null) | null = null

export function initErrorLogger(getMainWindow: () => BrowserWindow | null): void {
  mainWindowGetter = getMainWindow
}

export function broadcastError(source: string, message: string): void {
  const entry: ErrorEntry = {
    source,
    message,
    timestamp: new Date().toISOString()
  }

  // Store in memory
  recentErrors.unshift(entry)
  if (recentErrors.length > MAX_ERRORS) {
    recentErrors.length = MAX_ERRORS
  }

  console.error(`[error-log] [${source}] ${message}`)

  // Send to renderer
  const mainWin = mainWindowGetter?.()
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('dev:error-log', entry)
  }
}

export function getRecentErrors(): ErrorEntry[] {
  return recentErrors
}
