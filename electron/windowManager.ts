import { BrowserWindow, screen, shell, app } from 'electron'
import path from 'path'

const isProduction = app.isPackaged

let mainWindow: BrowserWindow | null = null
let hudWindow: BrowserWindow | null = null
let hideTimeout: ReturnType<typeof setTimeout> | null = null

// Resolves once the widget renderer has mounted and registered its IPC
// listeners. showHUD() awaits this so the window never becomes visible
// before the React tree can paint the active state — which would otherwise
// show a transparent (invisible) panel while recording proceeds.
let hudReadyResolve: (() => void) | null = null
let hudReadyPromise: Promise<void> = new Promise<void>((resolve) => {
  hudReadyResolve = resolve
})

export function markHUDReady(): void {
  if (hudReadyResolve) {
    hudReadyResolve()
    hudReadyResolve = null
  }
}

function resetHUDReady(): void {
  if (hudReadyResolve) return
  hudReadyPromise = new Promise<void>((resolve) => {
    hudReadyResolve = resolve
  })
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** Kept as getWidgetWindow for backward compat (sessionManager's sendToWidget uses this) */
export function getWidgetWindow(): BrowserWindow | null {
  return hudWindow
}

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 700,
    minHeight: 500,
    show: false,
    backgroundColor: '#FAF9F6',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !isProduction,
    }
  })

  // Prevent external URLs (OAuth, links) from navigating away from the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow file:// and dev server navigation, block everything else (OAuth URLs, etc.)
    if (url.startsWith('http://localhost') || url.startsWith('file://')) return
    event.preventDefault()
    shell.openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

export function showMainWindow(): void {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
}

/* ===============================
   HUD WINDOW — Drop-down from top

   A 380×120 panel that appears from the top-center of the screen
   when recording starts. Hidden by default. No macOS clamping
   issues at the top of the screen.

   Show/hide is controlled by the main process (sessionManager).
   Entry/exit animations handled by CSS in the renderer.
================================ */

const HUD_WIDTH = 520
// Slightly taller canvas than the pill itself so the error pill (multi-line)
// has room to grow without resizing the window. The pill anchors to the top
// of the canvas; empty area is transparent and click-through.
const HUD_HEIGHT = 140

let hudPosition: 'center' | 'right' = 'center'

export function setHUDPosition(position: 'center' | 'right'): void {
  hudPosition = position
  // If HUD exists and is visible, reposition immediately
  if (hudWindow?.isVisible()) {
    hudWindow.setBounds(getHUDBounds())
  }
}

function getHUDBounds() {
  const display = screen.getPrimaryDisplay()
  const { workArea } = display

  let x: number
  if (hudPosition === 'right') {
    x = workArea.x + workArea.width - HUD_WIDTH - 12 // 12px from right edge
  } else {
    x = workArea.x + Math.round((workArea.width - HUD_WIDTH) / 2) // center
  }
  const y = workArea.y + 6 // 6px below top of workArea (which is already below menu bar)

  return { x, y, width: HUD_WIDTH, height: HUD_HEIGHT }
}

export function createHUDWindow(): BrowserWindow {
  const { x, y, width, height } = getHUDBounds()

  hudWindow = new BrowserWindow({
    width,
    height,
    x,
    y,

    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    type: 'panel',
    alwaysOnTop: true,

    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !isProduction,
    }
  })

  hudWindow.setAlwaysOnTop(true, 'floating')
  hudWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  })
  hudWindow.setFullScreenable(false)

  // Re-position when display changes (resolution, external monitor)
  screen.on('display-metrics-changed', () => {
    if (!hudWindow || !hudWindow.isVisible()) return
    const bounds = getHUDBounds()
    hudWindow.setBounds(bounds)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    hudWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#/widget`)
  } else {
    hudWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: '/widget'
    })
  }

  hudWindow.on('closed', () => {
    hudWindow = null
  })

  // Reset the ready promise on every reload (dev HMR, crash recovery) so the
  // next showHUD() waits for the fresh renderer to re-register its listeners.
  hudWindow.webContents.on('did-start-loading', resetHUDReady)

  return hudWindow
}

/** Show the HUD — called when recording starts.
 *  Awaits renderer readiness so the panel never appears blank on cold start. */
export async function showHUD(): Promise<void> {
  await hudReadyPromise
  if (!hudWindow) return

  // Cancel any pending hide animation
  if (hideTimeout) {
    clearTimeout(hideTimeout)
    hideTimeout = null
  }

  // Recalculate position in case display changed
  const bounds = getHUDBounds()
  hudWindow.setBounds(bounds)
  hudWindow.setIgnoreMouseEvents(false)
  hudWindow.setFocusable(true)
  hudWindow.showInactive() // Show without stealing focus from user's app

  // Force to front — showInactive() alone can sometimes leave the window behind
  // other always-on-top windows (e.g. macOS Stage Manager, certain full-screen apps)
  hudWindow.setAlwaysOnTop(true, 'floating')
  hudWindow.moveTop()
}

/** Hide the HUD — called after output/error/cancel dismiss */
export function hideHUD(): void {
  if (!hudWindow) return

  // Small delay to allow exit animation in renderer
  hideTimeout = setTimeout(() => {
    if (!hudWindow) return
    hudWindow.hide()
    hudWindow.setFocusable(false)
    hideTimeout = null
  }, 220) // Matches hud-exit animation duration (200ms + buffer)
}

// Keep old name as alias for createHUDWindow (used by main.ts)
export const createWidgetWindow = createHUDWindow
