import { app } from 'electron'
import path from 'path'
import fs from 'fs'

/**
 * Resolve the ffmpeg binary path.
 * In development: use the ffmpeg-static package from node_modules.
 * In packaged app: use the binary bundled via extraResources.
 */
export function getFFmpegPath(): string | null {
  const candidates = [
    // Development: ffmpeg-static package
    path.join(app.getAppPath(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
    // Packaged app: extraResources
    path.join(process.resourcesPath || '', 'ffmpeg'),
    // Fallback: system ffmpeg
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  console.error('[ffmpeg] No ffmpeg binary found. Checked:', candidates)
  return null
}
