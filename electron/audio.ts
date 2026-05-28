import { app } from 'electron'
import path from 'path'
import fs from 'fs'

const MAX_AUDIO_SESSIONS = 5

// Matches "<sessionId>-dictation-final" / "<sessionId>-instruction" / "<sessionId>-chunk-<n>" / "<sessionId>-final-chunk-<n>"
// sessionId itself is a UUID (8-4-4-4-12 hex).
const SESSION_ID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

function getAudioDir(): string {
  const dir = path.join(app.getPath('userData'), 'audio')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log('[audio] Created audio directory:', dir)
  }
  return dir
}

export function saveAudioFile(sessionId: string, buffer: Buffer): string {
  const audioDir = getAudioDir()
  const filePath = path.join(audioDir, `${sessionId}.webm`)

  console.log('[audio] Saving audio file:')
  console.log('[audio]   Path:', filePath)
  console.log('[audio]   Buffer size:', buffer.byteLength, 'bytes')

  fs.writeFileSync(filePath, buffer)

  // Verify the file was written
  const stat = fs.statSync(filePath)
  console.log('[audio]   Written file size:', stat.size, 'bytes')
  console.log('[audio]   File exists:', fs.existsSync(filePath))

  if (stat.size === 0) {
    console.error('[audio]   ⚠️ WARNING: Written file is 0 bytes!')
  }
  if (stat.size < 100) {
    console.warn('[audio]   ⚠️ WARNING: Audio file is very small (<100 bytes), likely too short to transcribe')
  }

  pruneAudioFiles(audioDir)
  return filePath
}

export function getAudioFilePath(sessionId: string): string | null {
  const filePath = path.join(getAudioDir(), `${sessionId}.webm`)
  const exists = fs.existsSync(filePath)
  if (exists) {
    const stat = fs.statSync(filePath)
    console.log('[audio] getAudioFilePath:', filePath, 'size:', stat.size)
  }
  return exists ? filePath : null
}

export function loadAudioFile(sessionId: string): Buffer | null {
  const filePath = getAudioFilePath(sessionId)
  if (!filePath) return null

  try {
    const buffer = fs.readFileSync(filePath)
    console.log('[audio] loadAudioFile:', filePath, 'size:', buffer.byteLength)
    return buffer
  } catch (err) {
    console.error('[audio] Failed to load audio file:', filePath, err)
    return null
  }
}

export function deleteAudioFile(sessionId: string): void {
  const filePath = path.join(getAudioDir(), `${sessionId}.webm`)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
    console.log('[audio] Deleted audio file:', filePath)
  }
}

export function clearAllAudioFiles(): void {
  const audioDir = path.join(app.getPath('userData'), 'audio')
  if (!fs.existsSync(audioDir)) return
  const files = fs.readdirSync(audioDir).filter((f) => f.endsWith('.webm'))
  for (const file of files) {
    fs.unlinkSync(path.join(audioDir, file))
  }
  console.log(`[audio] Cleared all audio files (${files.length} removed)`)
}

export function saveAudioChunk(
  sessionId: string,
  chunkIndex: number,
  buffer: Buffer,
  isFinal = false,
): string {
  const audioDir = getAudioDir()
  const tag = isFinal ? 'final-chunk' : 'chunk'
  // zero-pad so lexical sort == numeric sort, makes reassembly trivial
  const padded = String(chunkIndex).padStart(4, '0')
  const filePath = path.join(audioDir, `${sessionId}-${tag}-${padded}.webm`)
  fs.writeFileSync(filePath, buffer)
  console.log(`[audio] Saved ${tag} ${chunkIndex} (${buffer.byteLength} bytes) -> ${path.basename(filePath)}`)
  pruneAudioFiles(audioDir)
  return filePath
}

function pruneAudioFiles(audioDir: string): void {
  const files = fs.readdirSync(audioDir).filter((f) => f.endsWith('.webm'))

  // Group files by sessionId so we prune whole sessions, not individual chunks
  const sessions = new Map<string, { files: string[]; mtime: number }>()
  for (const f of files) {
    const m = f.match(SESSION_ID_RE)
    const sid = m ? m[1] : f // ungrouped files form their own "session" of 1
    const mtime = fs.statSync(path.join(audioDir, f)).mtimeMs
    const entry = sessions.get(sid)
    if (entry) {
      entry.files.push(f)
      if (mtime > entry.mtime) entry.mtime = mtime
    } else {
      sessions.set(sid, { files: [f], mtime })
    }
  }

  const sorted = [...sessions.entries()].sort((a, b) => a[1].mtime - b[1].mtime)
  while (sorted.length > MAX_AUDIO_SESSIONS) {
    const [sid, entry] = sorted.shift()!
    for (const name of entry.files) {
      fs.unlinkSync(path.join(audioDir, name))
    }
    console.log(`[audio] Pruned old session ${sid} (${entry.files.length} files)`)
  }
}
