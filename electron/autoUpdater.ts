// ─── Auto-update wiring ───
// Checks GitHub Releases of the repo configured in package.json `build.publish`
// for a newer version, silently downloads it in the background, and installs
// on next quit. Hardened-runtime + notarization on the existing build means
// macOS Squirrel will accept the update without prompting the user.
//
// All failures are logged and swallowed — auto-update is best-effort and must
// never crash or block the running app.

import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

let initialised = false

function broadcastToWindows(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try { win.webContents.send(channel, ...args) } catch { /* window closed */ }
  }
}

/**
 * Tell electron-updater to install the downloaded update and relaunch.
 * Called from the renderer when the user clicks "Restart" on the in-app
 * update banner.
 */
export function quitAndInstall(): void {
  try { autoUpdater.quitAndInstall() } catch (err) {
    console.warn('[updater] quitAndInstall failed:', err instanceof Error ? err.message : err)
  }
}

export function setupAutoUpdater(): void {
  if (initialised) return
  initialised = true

  // Don't run in dev — electron-updater requires a packaged app with the
  // app-update.yml manifest, which only exists in builds.
  if (!app.isPackaged) {
    console.log('[updater] dev mode — auto-update disabled')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => console.log('[updater] checking…'))
  autoUpdater.on('update-available', (info) => console.log('[updater] update available:', info.version))
  autoUpdater.on('update-not-available', () => console.log('[updater] up to date'))
  autoUpdater.on('download-progress', (p) => {
    const pct = Math.round(p.percent)
    if (pct % 10 === 0) console.log(`[updater] downloading ${pct}%`)
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] downloaded ${info.version} — will install on next quit`)
    // Tell the UI so it can show a "Restart to update" banner. The user can
    // still ignore it — autoInstallOnAppQuit will pick it up on next quit.
    broadcastToWindows('updater:downloaded', info.version)
  })
  autoUpdater.on('error', (err) =>
    console.warn('[updater] error:', err instanceof Error ? err.message : err)
  )

  // First check soon after launch, then every 6 hours while the app is open.
  // Use checkForUpdates() (not …AndNotify) — we surface our own banner now.
  const kick = () => autoUpdater.checkForUpdates().catch((err) =>
    console.warn('[updater] check failed:', err instanceof Error ? err.message : err)
  )
  setTimeout(kick, 10_000) // give the UI a moment to settle
  setInterval(kick, RECHECK_INTERVAL_MS)
}
