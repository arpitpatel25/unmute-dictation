import { app } from 'electron'
import path from 'path'
import fs from 'fs'

/**
 * Resolve the ffmpeg binary path.
 * In development: use the ffmpeg-static package from node_modules.
 * In packaged app: use the binary bundled via extraResources.
 */
export function getFFmpegPath(): string | null {
  const appPath = app.getAppPath()
  const candidates = [
    // Development: ffmpeg-static in node_modules.
    path.join(appPath, 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    // Packaged app: ffmpeg-static is asarUnpack'd next to the asar. A path
    // INSIDE app.asar reports as existing (asar fs shim) but cannot be spawned
    // — it fails with ENOTDIR — so we must use the .unpacked location.
    path.join(appPath.replace(/app\.asar$/, 'app.asar.unpacked'), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    path.join(process.resourcesPath || '', 'ffmpeg'),
    // Fallback: system ffmpeg
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
  ]

  for (const candidate of candidates) {
    // Skip any path still inside app.asar — existsSync lies for those, and
    // spawning them throws ENOTDIR.
    if (candidate.includes(`app.asar${path.sep}`)) continue
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  console.error('[ffmpeg] No ffmpeg binary found. Checked:', candidates)
  return null
}
